import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { extractElixirModules, parseElixirFile } from '../../src/indexer/elixir.js';

let tmpDir: string;

function setupMockElixirRepo(files: Record<string, string>): string {
  const repoDir = path.join(tmpDir, 'test-repo');
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return repoDir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-elixir-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseElixirFile', () => {
  it('extracts defmodule name', () => {
    const content = `
defmodule MyApp.Booking do
  def hello, do: :world
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('MyApp.Booking');
  });

  it('extracts @moduledoc from heredoc', () => {
    const content = `
defmodule MyApp.Booking do
  @moduledoc """
  Handles bookings for the platform.
  """

  def create(attrs), do: :ok
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules[0].moduledoc).toBe('Handles bookings for the platform.');
  });

  it('extracts @moduledoc from single-line string', () => {
    const content = `
defmodule MyApp.Simple do
  @moduledoc "A simple module"
  def run, do: :ok
end
`;
    const modules = parseElixirFile('lib/simple.ex', content);
    expect(modules[0].moduledoc).toBe('A simple module');
  });

  it('handles @moduledoc false', () => {
    const content = `
defmodule MyApp.Internal do
  @moduledoc false
  def secret, do: :hidden
end
`;
    const modules = parseElixirFile('lib/internal.ex', content);
    expect(modules[0].moduledoc).toBeNull();
  });

  it('extracts public function signatures', () => {
    const content = `
defmodule MyApp.Booking do
  def create(attrs), do: :ok
  def cancel(id, reason), do: :ok
  def list(), do: []
  defp validate(attrs), do: :ok
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules[0].functions).toContain('create/1');
    expect(modules[0].functions).toContain('cancel/2');
    expect(modules[0].functions).toContain('list/0');
  });

  it('ignores private functions (defp)', () => {
    const content = `
defmodule MyApp.Booking do
  def public_fn(x), do: x
  defp private_fn(x), do: x
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules[0].functions).toContain('public_fn/1');
    expect(modules[0].functions).not.toContain('private_fn/1');
  });

  it('classifies context modules', () => {
    const content = `defmodule BookingContext do\nend`;
    const modules = parseElixirFile('lib/booking_context.ex', content);
    expect(modules[0].type).toBe('context');
  });

  it('classifies command modules', () => {
    const content = `defmodule BookingContext.Commands.CreateBooking do\nend`;
    const modules = parseElixirFile('lib/commands/create.ex', content);
    expect(modules[0].type).toBe('command');
  });

  it('classifies query modules', () => {
    const content = `defmodule BookingContext.Queries.GetSlots do\nend`;
    const modules = parseElixirFile('lib/queries/get_slots.ex', content);
    expect(modules[0].type).toBe('query');
  });

  it('detects Ecto schema with table name', () => {
    const content = `
defmodule MyApp.Booking do
  use Ecto.Schema

  schema "bookings" do
    field :name, :string
    timestamps()
  end
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules[0].type).toBe('schema');
    expect(modules[0].tableName).toBe('bookings');
  });

  it('handles multiple modules in one file', () => {
    const content = `
defmodule MyApp.ModuleA do
  @moduledoc "Module A"
  def a, do: :a
end

defmodule MyApp.ModuleB do
  @moduledoc "Module B"
  def b, do: :b
end
`;
    const modules = parseElixirFile('lib/multi.ex', content);
    expect(modules).toHaveLength(2);
    expect(modules[0].name).toBe('MyApp.ModuleA');
    expect(modules[1].name).toBe('MyApp.ModuleB');
  });

  it('deduplicates multi-clause functions', () => {
    const content = `
defmodule MyApp.Handler do
  def handle(:ok), do: :ok
  def handle(:error), do: :error
  def handle(_other), do: :unknown
end
`;
    const modules = parseElixirFile('lib/handler.ex', content);
    const handleFns = modules[0].functions.filter((f) => f.startsWith('handle/'));
    expect(handleFns).toHaveLength(1);
    expect(handleFns[0]).toBe('handle/1');
  });
});

describe('extractElixirModules (branch-aware)', () => {
  function setupGitElixirRepo(files: Record<string, string>): string {
    const repoDir = path.join(tmpDir, 'git-elixir-repo');
    fs.mkdirSync(repoDir, { recursive: true });

    const { execSync } = require('child_process');
    execSync('git init', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git checkout -b main', { cwd: repoDir, stdio: 'pipe' });

    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(repoDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: repoDir, stdio: 'pipe' });

    return repoDir;
  }

  it('finds modules from git branch in lib/ directory', () => {
    const repoDir = setupGitElixirRepo({
      'lib/booking.ex': `defmodule MyApp.Booking do\n  def create(x), do: x\nend`,
    });

    const modules = extractElixirModules(repoDir, 'main');
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('MyApp.Booking');
  });

  it('finds modules from git branch in apps/ umbrella structure', () => {
    const repoDir = setupGitElixirRepo({
      'apps/booking/lib/booking.ex': `defmodule Booking do\nend`,
      'apps/payments/lib/payments.ex': `defmodule Payments do\nend`,
    });

    const modules = extractElixirModules(repoDir, 'main');
    expect(modules).toHaveLength(2);
  });

  it('returns empty for branch with no lib/ files', () => {
    const repoDir = setupGitElixirRepo({
      'README.md': '# Hello',
    });

    const modules = extractElixirModules(repoDir, 'main');
    expect(modules).toHaveLength(0);
  });

  it('reads from main branch, ignoring feature branch files', () => {
    const repoDir = setupGitElixirRepo({
      'lib/main_module.ex': `defmodule MainModule do\nend`,
    });

    const { execSync } = require('child_process');
    // Create feature branch with additional module
    execSync('git checkout -b feature/new', { cwd: repoDir, stdio: 'pipe' });
    const featurePath = path.join(repoDir, 'lib', 'feature_module.ex');
    fs.writeFileSync(featurePath, `defmodule FeatureModule do\nend`);
    execSync('git add -A && git commit -m "feature"', { cwd: repoDir, stdio: 'pipe' });

    // Extracting from main should only see MainModule
    const modules = extractElixirModules(repoDir, 'main');
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('MainModule');
  });
});
