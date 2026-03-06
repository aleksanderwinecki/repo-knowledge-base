import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { indexAllRepos, indexSingleRepo } from '../../src/indexer/pipeline.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let dbPath: string;
let tmpDir: string;

/**
 * Create a git-initialized repo with the given files.
 * Returns the repo path.
 */
function createGitRepo(
  name: string,
  files: Record<string, string>,
): string {
  const repoDir = path.join(tmpDir, 'repos', name);
  fs.mkdirSync(repoDir, { recursive: true });

  // Initialize git repo
  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });

  // Write files
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  // Initial commit
  execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: repoDir, stdio: 'pipe' });

  return repoDir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-pipeline-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('indexSingleRepo', () => {
  it('indexes an Elixir repo with modules', () => {
    const repoDir = createGitRepo('booking-service', {
      'mix.exs': 'defmodule BookingService.MixProject do\nend',
      'lib/booking.ex': `
defmodule BookingService.Booking do
  @moduledoc "Handles bookings"
  def create(attrs), do: :ok
end
`,
      'lib/payment.ex': `
defmodule BookingService.Payment do
  def charge(amount), do: :ok
end
`,
    });

    const stats = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    expect(stats.modules).toBe(2);
    expect(stats.protos).toBe(0);

    // Verify repo was persisted
    const repo = db.prepare('SELECT * FROM repos WHERE name = ?').get('booking-service') as {
      name: string;
      description: string | null;
    };
    expect(repo).toBeDefined();
    expect(repo.name).toBe('booking-service');

    // Verify modules were persisted
    const modules = db
      .prepare('SELECT name FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?)')
      .all('booking-service') as { name: string }[];
    expect(modules).toHaveLength(2);
    const names = modules.map((m) => m.name).sort();
    expect(names).toEqual(['BookingService.Booking', 'BookingService.Payment']);
  });

  it('indexes proto files and creates events', () => {
    const repoDir = createGitRepo('events-service', {
      'mix.exs': 'defmodule Events.MixProject do\nend',
      'proto/booking.proto': `
syntax = "proto3";
package booking;

message BookingCreated {
  string id = 1;
  string guest_name = 2;
}

message BookingCancelled {
  string id = 1;
}
`,
    });

    const stats = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    expect(stats.protos).toBe(2);

    // Verify events were persisted
    const events = db
      .prepare('SELECT name FROM events WHERE repo_id = (SELECT id FROM repos WHERE name = ?)')
      .all('events-service') as { name: string }[];
    expect(events).toHaveLength(2);
    const eventNames = events.map((e) => e.name).sort();
    expect(eventNames).toEqual(['BookingCancelled', 'BookingCreated']);
  });

  it('indexes a repo with both modules and protos', () => {
    const repoDir = createGitRepo('full-service', {
      'mix.exs': 'defmodule Full.MixProject do\nend',
      'lib/handler.ex': `
defmodule Full.Handler do
  def create(attrs), do: :ok
end
`,
      'proto/events.proto': `
message FullEvent {
  string id = 1;
}
`,
    });

    const stats = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    expect(stats.modules).toBe(1);
    expect(stats.protos).toBe(1);
  });

  it('records last_indexed_commit', () => {
    const repoDir = createGitRepo('commit-check', {
      'mix.exs': 'defmodule CommitCheck.MixProject do\nend',
    });

    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    const repo = db.prepare('SELECT last_indexed_commit FROM repos WHERE name = ?').get('commit-check') as {
      last_indexed_commit: string | null;
    };
    expect(repo.last_indexed_commit).toBeTruthy();
    expect(repo.last_indexed_commit).toHaveLength(40); // Full SHA
  });

  it('handles repo with no Elixir or proto files', () => {
    const repoDir = createGitRepo('plain-repo', {
      'package.json': '{"name": "plain-repo"}',
      'src/index.ts': 'console.log("hello");',
    });

    const stats = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    expect(stats.modules).toBe(0);
    expect(stats.protos).toBe(0);
    expect(stats.events).toBe(0);
  });
});

describe('indexAllRepos', () => {
  it('indexes all discovered repos', () => {
    const rootDir = path.join(tmpDir, 'repos');
    fs.mkdirSync(rootDir, { recursive: true });

    createGitRepo('repo-a', {
      'mix.exs': 'defmodule A.MixProject do\nend',
      'lib/a.ex': 'defmodule A do\nend',
    });

    createGitRepo('repo-b', {
      'mix.exs': 'defmodule B.MixProject do\nend',
      'lib/b.ex': 'defmodule B do\nend',
    });

    const results = indexAllRepos(db, { force: true, rootDir });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  it('skips repos with unchanged commit', () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = createGitRepo('skip-test', {
      'mix.exs': 'defmodule SkipTest.MixProject do\nend',
    });

    // First index
    indexAllRepos(db, { force: true, rootDir });

    // Second index without force should skip
    const results = indexAllRepos(db, { force: false, rootDir });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(results[0].skipReason).toBe('no new commits');
  });

  it('re-indexes when commit changes', () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = createGitRepo('reindex-test', {
      'mix.exs': 'defmodule Reindex.MixProject do\nend',
      'lib/a.ex': 'defmodule A do\nend',
    });

    // First index
    indexAllRepos(db, { force: true, rootDir });

    // Add a new file and commit
    fs.writeFileSync(path.join(repoDir, 'lib', 'b.ex'), 'defmodule B do\nend');
    execSync('git add -A && git commit -m "add b"', { cwd: repoDir, stdio: 'pipe' });

    // Second index without force should re-index (commit changed)
    const results = indexAllRepos(db, { force: false, rootDir });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
  });

  it('force flag bypasses skip check', () => {
    const rootDir = path.join(tmpDir, 'repos');
    createGitRepo('force-test', {
      'mix.exs': 'defmodule Force.MixProject do\nend',
    });

    // First index
    indexAllRepos(db, { force: true, rootDir });

    // Second index with force should re-index
    const results = indexAllRepos(db, { force: true, rootDir });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
  });

  it('isolates errors per repo (IDX-07)', () => {
    const rootDir = path.join(tmpDir, 'repos');

    // Create two valid repos
    createGitRepo('good-repo', {
      'mix.exs': 'defmodule Good.MixProject do\nend',
      'lib/good.ex': 'defmodule Good do\nend',
    });

    createGitRepo('another-repo', {
      'mix.exs': 'defmodule Another.MixProject do\nend',
      'lib/another.ex': 'defmodule Another do\nend',
    });

    // Make one repo unreadable by removing its contents after discovery setup
    // We'll delete the repo dir and replace it with a file to cause errors
    const anotherDir = path.join(rootDir, 'another-repo');
    fs.rmSync(anotherDir, { recursive: true, force: true });
    // Create a file where a directory is expected — scanner will still find it via .git check
    // but indexSingleRepo will fail because repoPath is now invalid
    fs.writeFileSync(anotherDir, 'not-a-directory');

    const results = indexAllRepos(db, { force: true, rootDir });

    // The pipeline should complete without crashing — that's the key IDX-07 guarantee
    // good-repo should succeed; another-repo should either error or not be discovered
    const goodResult = results.find((r) => r.repo === 'good-repo');
    expect(goodResult).toBeDefined();
    expect(goodResult!.status).toBe('success');

    // Verify the entire run completed (didn't crash mid-way)
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for root with no repos', () => {
    const emptyDir = path.join(tmpDir, 'empty-root');
    fs.mkdirSync(emptyDir, { recursive: true });

    const results = indexAllRepos(db, { force: true, rootDir: emptyDir });
    expect(results).toHaveLength(0);
  });

  it('skips repo with no main or master branch', () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = path.join(rootDir, 'no-default-branch');
    fs.mkdirSync(repoDir, { recursive: true });

    execSync('git init', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git checkout -b develop', { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'mix.exs'), 'defmodule Dev.MixProject do\nend');
    execSync('git add -A && git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });

    const results = indexAllRepos(db, { force: true, rootDir });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(results[0].skipReason).toContain('no main or master branch');
  });

  it('indexes from main branch content, not feature branch', () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = createGitRepo('branch-test', {
      'mix.exs': 'defmodule BranchTest.MixProject do\nend',
      'lib/main_mod.ex': 'defmodule MainMod do\nend',
    });

    // Rename default branch to main (createGitRepo might use master)
    try { execSync('git branch -m master main', { cwd: repoDir, stdio: 'pipe' }); } catch { /* already main */ }

    // Create feature branch with additional module
    execSync('git checkout -b feature/new', { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'lib', 'feature_mod.ex'), 'defmodule FeatureMod do\nend');
    execSync('git add -A && git commit -m "feature"', { cwd: repoDir, stdio: 'pipe' });

    // Index while on feature branch
    const stats = indexSingleRepo(db, repoDir, { force: true, rootDir });

    // Should only have the main-branch module
    expect(stats.modules).toBe(1);

    const modules = db
      .prepare('SELECT name FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?)')
      .all('branch-test') as { name: string }[];
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('MainMod');
  });

  it('populates default_branch in repos table', () => {
    const repoDir = createGitRepo('branch-col-test', {
      'mix.exs': 'defmodule BranchCol.MixProject do\nend',
    });

    // Ensure it has a main branch
    try { execSync('git branch -m master main', { cwd: repoDir, stdio: 'pipe' }); } catch { /* already main */ }

    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    const row = db.prepare('SELECT default_branch FROM repos WHERE name = ?').get('branch-col-test') as {
      default_branch: string | null;
    };
    expect(row.default_branch).toBe('main');
  });

  it('handles detached HEAD state', () => {
    const repoDir = createGitRepo('detached-head', {
      'mix.exs': 'defmodule Detached.MixProject do\nend',
      'lib/mod.ex': 'defmodule DetachedMod do\nend',
    });

    // Ensure main branch exists
    try { execSync('git branch -m master main', { cwd: repoDir, stdio: 'pipe' }); } catch { /* already main */ }

    // Detach HEAD
    const sha = execSync('git rev-parse HEAD', { cwd: repoDir, encoding: 'utf-8' }).trim();
    execSync(`git checkout ${sha}`, { cwd: repoDir, stdio: 'pipe' });

    const stats = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });
    expect(stats.modules).toBe(1);
  });

  it('skip check compares against branch commit, not HEAD', () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = createGitRepo('skip-branch-check', {
      'mix.exs': 'defmodule SkipBranch.MixProject do\nend',
    });

    // Ensure main branch
    try { execSync('git branch -m master main', { cwd: repoDir, stdio: 'pipe' }); } catch { /* already main */ }

    // First index
    indexAllRepos(db, { force: true, rootDir });

    // Create feature branch with new commit (HEAD changes but main doesn't)
    execSync('git checkout -b feature/x', { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'new.txt'), 'feature');
    execSync('git add -A && git commit -m "feature"', { cwd: repoDir, stdio: 'pipe' });

    // Re-index without force -- should skip because main hasn't changed
    const results = indexAllRepos(db, { force: false, rootDir });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(results[0].skipReason).toBe('no new commits');
  });
});

describe('surgical indexing', () => {
  /**
   * Helper: get default branch name for a repo (main or master).
   */
  function getDefaultBranch(repoDir: string): string {
    try {
      execSync('git rev-parse --verify refs/heads/main', { cwd: repoDir, stdio: 'pipe' });
      return 'main';
    } catch {
      return 'master';
    }
  }

  /**
   * Helper: ensure repo uses 'main' as default branch.
   */
  function ensureMainBranch(repoDir: string): void {
    try { execSync('git branch -m master main', { cwd: repoDir, stdio: 'pipe' }); } catch { /* already main */ }
  }

  it('uses surgical mode when a single file is modified', () => {
    const repoDir = createGitRepo('surgical-modify', {
      'mix.exs': 'defmodule SurgicalModify.MixProject do\nend',
      'lib/alpha.ex': `
defmodule SurgicalModify.Alpha do
  @moduledoc "Alpha module"
  def run, do: :ok
end
`,
      'lib/beta.ex': `
defmodule SurgicalModify.Beta do
  @moduledoc "Beta module"
  def run, do: :ok
end
`,
    });

    ensureMainBranch(repoDir);

    // Full index first
    const firstResult = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });
    expect(firstResult.mode).toBe('full');
    expect(firstResult.modules).toBe(2);

    // Modify one file and commit on main
    fs.writeFileSync(path.join(repoDir, 'lib', 'alpha.ex'), `
defmodule SurgicalModify.AlphaRenamed do
  @moduledoc "Alpha renamed"
  def run, do: :ok
end
`);
    execSync('git add -A && git commit -m "rename alpha"', { cwd: repoDir, stdio: 'pipe' });

    // Re-index without force -> should use surgical mode
    const result = indexSingleRepo(db, repoDir, { force: false, rootDir: tmpDir });
    expect(result.mode).toBe('surgical');

    // Beta should survive untouched, Alpha should be renamed
    const modules = db
      .prepare('SELECT name FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?)')
      .all('surgical-modify') as { name: string }[];
    const names = modules.map(m => m.name).sort();
    expect(names).toEqual(['SurgicalModify.AlphaRenamed', 'SurgicalModify.Beta']);
  });

  it('uses surgical mode when a file is added', () => {
    const repoDir = createGitRepo('surgical-add', {
      'mix.exs': 'defmodule SurgicalAdd.MixProject do\nend',
      'lib/existing.ex': `
defmodule SurgicalAdd.Existing do
  def run, do: :ok
end
`,
    });

    ensureMainBranch(repoDir);

    // Full index first
    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    // Add new file and commit
    fs.writeFileSync(path.join(repoDir, 'lib', 'new_mod.ex'), `
defmodule SurgicalAdd.NewMod do
  @moduledoc "New module"
  def run, do: :ok
end
`);
    execSync('git add -A && git commit -m "add new"', { cwd: repoDir, stdio: 'pipe' });

    const result = indexSingleRepo(db, repoDir, { force: false, rootDir: tmpDir });
    expect(result.mode).toBe('surgical');

    const modules = db
      .prepare('SELECT name FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?)')
      .all('surgical-add') as { name: string }[];
    expect(modules).toHaveLength(2);
    const names = modules.map(m => m.name).sort();
    expect(names).toEqual(['SurgicalAdd.Existing', 'SurgicalAdd.NewMod']);
  });

  it('uses surgical mode when a file is deleted', () => {
    const repoDir = createGitRepo('surgical-delete', {
      'mix.exs': 'defmodule SurgicalDelete.MixProject do\nend',
      'lib/keep.ex': `
defmodule SurgicalDelete.Keep do
  def run, do: :ok
end
`,
      'lib/remove.ex': `
defmodule SurgicalDelete.Remove do
  def run, do: :ok
end
`,
    });

    ensureMainBranch(repoDir);

    // Full index first
    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    const modulesBefore = db
      .prepare('SELECT name FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?)')
      .all('surgical-delete') as { name: string }[];
    expect(modulesBefore).toHaveLength(2);

    // Delete one file and commit
    fs.unlinkSync(path.join(repoDir, 'lib', 'remove.ex'));
    execSync('git add -A && git commit -m "remove file"', { cwd: repoDir, stdio: 'pipe' });

    const result = indexSingleRepo(db, repoDir, { force: false, rootDir: tmpDir });
    expect(result.mode).toBe('surgical');

    const modulesAfter = db
      .prepare('SELECT name FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?)')
      .all('surgical-delete') as { name: string }[];
    expect(modulesAfter).toHaveLength(1);
    expect(modulesAfter[0].name).toBe('SurgicalDelete.Keep');
  });

  it('produces identical results to full re-index (equivalence)', () => {
    const repoDir = createGitRepo('surgical-equiv', {
      'mix.exs': 'defmodule SurgicalEquiv.MixProject do\nend',
      'lib/mod_a.ex': `
defmodule SurgicalEquiv.ModA do
  @moduledoc "Module A"
  def run, do: :ok
end
`,
      'lib/mod_b.ex': `
defmodule SurgicalEquiv.ModB do
  @moduledoc "Module B"
  def run, do: :ok
end
`,
    });

    ensureMainBranch(repoDir);

    // Full index first
    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    // Modify one file
    fs.writeFileSync(path.join(repoDir, 'lib', 'mod_a.ex'), `
defmodule SurgicalEquiv.ModAv2 do
  @moduledoc "Module A v2"
  def run, do: :ok
end
`);
    execSync('git add -A && git commit -m "update mod_a"', { cwd: repoDir, stdio: 'pipe' });

    // Surgical re-index
    const surgicalResult = indexSingleRepo(db, repoDir, { force: false, rootDir: tmpDir });
    expect(surgicalResult.mode).toBe('surgical');

    // Snapshot surgical state
    const surgicalModules = db
      .prepare('SELECT name FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?) ORDER BY name')
      .all('surgical-equiv') as { name: string }[];
    const surgicalEvents = db
      .prepare('SELECT name FROM events WHERE repo_id = (SELECT id FROM repos WHERE name = ?) ORDER BY name')
      .all('surgical-equiv') as { name: string }[];

    // Full re-index
    const fullResult = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });
    expect(fullResult.mode).toBe('full');

    // Snapshot full state
    const fullModules = db
      .prepare('SELECT name FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?) ORDER BY name')
      .all('surgical-equiv') as { name: string }[];
    const fullEvents = db
      .prepare('SELECT name FROM events WHERE repo_id = (SELECT id FROM repos WHERE name = ?) ORDER BY name')
      .all('surgical-equiv') as { name: string }[];

    // Compare
    expect(surgicalModules).toEqual(fullModules);
    expect(surgicalEvents).toEqual(fullEvents);
  });

  it('falls back to full mode for unreachable commit', () => {
    const repoDir = createGitRepo('surgical-unreachable', {
      'mix.exs': 'defmodule SurgicalUnreachable.MixProject do\nend',
      'lib/mod.ex': `
defmodule SurgicalUnreachable.Mod do
  def run, do: :ok
end
`,
    });

    ensureMainBranch(repoDir);

    // Full index first
    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    // Overwrite last_indexed_commit with a fake SHA
    db.prepare("UPDATE repos SET last_indexed_commit = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' WHERE name = 'surgical-unreachable'").run();

    // Make a new commit so it doesn't skip
    fs.writeFileSync(path.join(repoDir, 'lib', 'mod.ex'), `
defmodule SurgicalUnreachable.Mod do
  def run_v2, do: :ok
end
`);
    execSync('git add -A && git commit -m "update"', { cwd: repoDir, stdio: 'pipe' });

    // Re-index without force -- should fallback to full because commit is unreachable
    const result = indexSingleRepo(db, repoDir, { force: false, rootDir: tmpDir });
    expect(result.mode).toBe('full');
  });

  it('falls back to full mode for large diff (>200 files or >50% changed)', () => {
    // Create repo with many files
    const files: Record<string, string> = {
      'mix.exs': 'defmodule LargeDiff.MixProject do\nend',
    };
    // Create 10 modules so we can trigger the >50% rule with 6 changes
    for (let i = 0; i < 10; i++) {
      files[`lib/mod_${i}.ex`] = `defmodule LargeDiff.Mod${i} do\n  def run, do: :ok\nend`;
    }

    const repoDir = createGitRepo('surgical-large-diff', files);
    ensureMainBranch(repoDir);

    // Full index first
    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    // Modify 6 of 10 files (>50%) and commit
    for (let i = 0; i < 6; i++) {
      fs.writeFileSync(path.join(repoDir, `lib/mod_${i}.ex`), `defmodule LargeDiff.Mod${i}v2 do\n  def run, do: :ok\nend`);
    }
    execSync('git add -A && git commit -m "bulk update"', { cwd: repoDir, stdio: 'pipe' });

    const result = indexSingleRepo(db, repoDir, { force: false, rootDir: tmpDir });
    expect(result.mode).toBe('full');
  });

  it('force flag always uses full mode', () => {
    const repoDir = createGitRepo('surgical-force', {
      'mix.exs': 'defmodule SurgicalForce.MixProject do\nend',
      'lib/mod.ex': `
defmodule SurgicalForce.Mod do
  def run, do: :ok
end
`,
    });

    ensureMainBranch(repoDir);

    // Full index first
    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    // Modify and commit
    fs.writeFileSync(path.join(repoDir, 'lib', 'mod.ex'), `
defmodule SurgicalForce.Mod do
  def run_v2, do: :ok
end
`);
    execSync('git add -A && git commit -m "update"', { cwd: repoDir, stdio: 'pipe' });

    // Re-index WITH force -> should be full mode, not surgical
    const result = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });
    expect(result.mode).toBe('full');
  });

  it('first index of a new repo uses full mode', () => {
    const repoDir = createGitRepo('surgical-first', {
      'mix.exs': 'defmodule SurgicalFirst.MixProject do\nend',
      'lib/mod.ex': `
defmodule SurgicalFirst.Mod do
  def run, do: :ok
end
`,
    });

    ensureMainBranch(repoDir);

    const result = indexSingleRepo(db, repoDir, { force: false, rootDir: tmpDir });
    expect(result.mode).toBe('full');
  });

  it('skipped repos have mode="skipped" in indexAllRepos result', () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = createGitRepo('surgical-skip-mode', {
      'mix.exs': 'defmodule SurgicalSkipMode.MixProject do\nend',
    });

    ensureMainBranch(repoDir);

    // First index
    indexAllRepos(db, { force: true, rootDir });

    // Second index without force -- should skip
    const results = indexAllRepos(db, { force: false, rootDir });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(results[0].mode).toBe('skipped');
  });

  it('successful repos have mode in indexAllRepos result', () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = createGitRepo('surgical-mode-report', {
      'mix.exs': 'defmodule SurgicalModeReport.MixProject do\nend',
      'lib/mod.ex': `
defmodule SurgicalModeReport.Mod do
  def run, do: :ok
end
`,
    });

    ensureMainBranch(repoDir);

    // Full index
    const results = indexAllRepos(db, { force: true, rootDir });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
    expect(results[0].mode).toBe('full');
  });

  it('recalculates edges after surgical update using ALL files', () => {
    const repoDir = createGitRepo('surgical-edges', {
      'mix.exs': 'defmodule SurgicalEdges.MixProject do\nend',
      'proto/events.proto': `
syntax = "proto3";
package test;

message TestEvent {
  string id = 1;
}
`,
      'lib/handler.ex': `
defmodule SurgicalEdges.Handler do
  def handle_event(%TestEvent{} = event), do: event
end
`,
    });

    ensureMainBranch(repoDir);

    // Full index first
    const firstResult = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });
    expect(firstResult.events).toBeGreaterThan(0);

    // Capture edge count after full
    const repoRow = db.prepare("SELECT id FROM repos WHERE name = 'surgical-edges'").get() as { id: number };
    const edgesAfterFull = db
      .prepare("SELECT COUNT(*) as cnt FROM edges WHERE source_type = 'repo' AND source_id = ?")
      .get(repoRow.id) as { cnt: number };

    // Modify the handler (not the proto) and commit
    fs.writeFileSync(path.join(repoDir, 'lib', 'handler.ex'), `
defmodule SurgicalEdges.Handler do
  @moduledoc "Updated handler"
  def handle_event(%TestEvent{} = event), do: event
end
`);
    execSync('git add -A && git commit -m "update handler"', { cwd: repoDir, stdio: 'pipe' });

    // Surgical re-index
    const result = indexSingleRepo(db, repoDir, { force: false, rootDir: tmpDir });
    expect(result.mode).toBe('surgical');

    // Edges should still be present (re-derived from ALL files, not just changed)
    const edgesAfterSurgical = db
      .prepare("SELECT COUNT(*) as cnt FROM edges WHERE source_type = 'repo' AND source_id = ?")
      .get(repoRow.id) as { cnt: number };
    expect(edgesAfterSurgical.cnt).toBe(edgesAfterFull.cnt);
  });
});
