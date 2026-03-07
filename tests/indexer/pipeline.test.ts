import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { indexAllRepos, indexSingleRepo } from '../../src/indexer/pipeline.js';
import { search, parseCompositeType } from '../../src/db/fts.js';
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
  it('indexes all discovered repos', async () => {
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

    const results = await indexAllRepos(db, { force: true, rootDir });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  it('skips repos with unchanged commit', async () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = createGitRepo('skip-test', {
      'mix.exs': 'defmodule SkipTest.MixProject do\nend',
    });

    // First index
    await indexAllRepos(db, { force: true, rootDir });

    // Second index without force should skip
    const results = await indexAllRepos(db, { force: false, rootDir });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(results[0].skipReason).toBe('no new commits');
  });

  it('re-indexes when commit changes', async () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = createGitRepo('reindex-test', {
      'mix.exs': 'defmodule Reindex.MixProject do\nend',
      'lib/a.ex': 'defmodule A do\nend',
    });

    // First index
    await indexAllRepos(db, { force: true, rootDir });

    // Add a new file and commit
    fs.writeFileSync(path.join(repoDir, 'lib', 'b.ex'), 'defmodule B do\nend');
    execSync('git add -A && git commit -m "add b"', { cwd: repoDir, stdio: 'pipe' });

    // Second index without force should re-index (commit changed)
    const results = await indexAllRepos(db, { force: false, rootDir });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
  });

  it('force flag bypasses skip check', async () => {
    const rootDir = path.join(tmpDir, 'repos');
    createGitRepo('force-test', {
      'mix.exs': 'defmodule Force.MixProject do\nend',
    });

    // First index
    await indexAllRepos(db, { force: true, rootDir });

    // Second index with force should re-index
    const results = await indexAllRepos(db, { force: true, rootDir });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('success');
  });

  it('isolates errors per repo (IDX-07)', async () => {
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

    const results = await indexAllRepos(db, { force: true, rootDir });

    // The pipeline should complete without crashing — that's the key IDX-07 guarantee
    // good-repo should succeed; another-repo should either error or not be discovered
    const goodResult = results.find((r) => r.repo === 'good-repo');
    expect(goodResult).toBeDefined();
    expect(goodResult!.status).toBe('success');

    // Verify the entire run completed (didn't crash mid-way)
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for root with no repos', async () => {
    const emptyDir = path.join(tmpDir, 'empty-root');
    fs.mkdirSync(emptyDir, { recursive: true });

    const results = await indexAllRepos(db, { force: true, rootDir: emptyDir });
    expect(results).toHaveLength(0);
  });

  it('skips repo with no main or master branch', async () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = path.join(rootDir, 'no-default-branch');
    fs.mkdirSync(repoDir, { recursive: true });

    execSync('git init', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git checkout -b develop', { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'mix.exs'), 'defmodule Dev.MixProject do\nend');
    execSync('git add -A && git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });

    const results = await indexAllRepos(db, { force: true, rootDir });
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

  it('skip check compares against branch commit, not HEAD', async () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = createGitRepo('skip-branch-check', {
      'mix.exs': 'defmodule SkipBranch.MixProject do\nend',
    });

    // Ensure main branch
    try { execSync('git branch -m master main', { cwd: repoDir, stdio: 'pipe' }); } catch { /* already main */ }

    // First index
    await indexAllRepos(db, { force: true, rootDir });

    // Create feature branch with new commit (HEAD changes but main doesn't)
    execSync('git checkout -b feature/x', { cwd: repoDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(repoDir, 'new.txt'), 'feature');
    execSync('git add -A && git commit -m "feature"', { cwd: repoDir, stdio: 'pipe' });

    // Re-index without force -- should skip because main hasn't changed
    const results = await indexAllRepos(db, { force: false, rootDir });
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

  it('skipped repos have mode="skipped" in indexAllRepos result', async () => {
    const rootDir = path.join(tmpDir, 'repos');
    const repoDir = createGitRepo('surgical-skip-mode', {
      'mix.exs': 'defmodule SurgicalSkipMode.MixProject do\nend',
    });

    ensureMainBranch(repoDir);

    // First index
    await indexAllRepos(db, { force: true, rootDir });

    // Second index without force -- should skip
    const results = await indexAllRepos(db, { force: false, rootDir });
    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('skipped');
    expect(results[0].mode).toBe('skipped');
  });

  it('successful repos have mode in indexAllRepos result', async () => {
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
    const results = await indexAllRepos(db, { force: true, rootDir });
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

describe('new extractor wiring', () => {
  function ensureMainBranch(repoDir: string): void {
    try { execSync('git branch -m master main', { cwd: repoDir, stdio: 'pipe' }); } catch { /* already main */ }
  }

  it('persists gRPC services from proto definitions to services table', () => {
    const repoDir = createGitRepo('grpc-service', {
      'mix.exs': 'defmodule GrpcService.MixProject do\nend',
      'proto/booking.proto': `
syntax = "proto3";
package booking.v1;

service BookingService {
  rpc CreateBooking (CreateBookingRequest) returns (CreateBookingResponse);
  rpc CancelBooking (CancelBookingRequest) returns (CancelBookingResponse);
}

message CreateBookingRequest { string id = 1; }
message CreateBookingResponse { string id = 1; }
message CancelBookingRequest { string id = 1; }
message CancelBookingResponse { string id = 1; }
`,
    });

    const stats = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    expect(stats.services).toBeGreaterThan(0);

    const services = db
      .prepare("SELECT name, description, service_type FROM services WHERE repo_id = (SELECT id FROM repos WHERE name = ?)")
      .all('grpc-service') as { name: string; description: string | null; service_type: string }[];
    expect(services).toHaveLength(1);
    expect(services[0].name).toBe('BookingService');
    expect(services[0].service_type).toBe('grpc');
    expect(services[0].description).toContain('CreateBooking');
    expect(services[0].description).toContain('CancelBooking');
  });

  it('creates modules from GraphQL SDL files with graphql_ type prefix', () => {
    const repoDir = createGitRepo('graphql-service', {
      'mix.exs': 'defmodule GraphqlService.MixProject do\nend',
      'schema.graphql': `
type Booking {
  id: ID!
  guestName: String!
}

input CreateBookingInput {
  guestName: String!
}

enum BookingStatus {
  PENDING
  CONFIRMED
  CANCELLED
}
`,
    });

    const stats = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    expect(stats.graphqlTypes).toBeGreaterThan(0);

    const modules = db
      .prepare("SELECT name, type FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?) AND type LIKE 'graphql_%'")
      .all('graphql-service') as { name: string; type: string }[];
    expect(modules).toHaveLength(3);
    const types = modules.map(m => m.type).sort();
    expect(types).toEqual(['graphql_enum', 'graphql_input', 'graphql_type']);
    const names = modules.map(m => m.name).sort();
    expect(names).toEqual(['Booking', 'BookingStatus', 'CreateBookingInput']);
  });

  it('populates modules.table_name and modules.schema_fields for Ecto schemas', () => {
    const repoDir = createGitRepo('ecto-service', {
      'mix.exs': 'defmodule EctoService.MixProject do\nend',
      'lib/booking.ex': `
defmodule EctoService.Booking do
  use Ecto.Schema

  schema "bookings" do
    field :guest_name, :string
    field :status, :string
    belongs_to :user, EctoService.User
    timestamps()
  end
end
`,
    });

    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    const mod = db
      .prepare("SELECT name, table_name, schema_fields FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?) AND table_name IS NOT NULL")
      .get('ecto-service') as { name: string; table_name: string; schema_fields: string } | undefined;
    expect(mod).toBeDefined();
    expect(mod!.table_name).toBe('bookings');
    expect(mod!.schema_fields).toBeTruthy();
    const fields = JSON.parse(mod!.schema_fields);
    expect(fields).toContainEqual({ name: 'guest_name', type: 'string' });
    expect(fields).toContainEqual({ name: 'status', type: 'string' });
  });

  it('creates Absinthe type modules with absinthe_ type prefix', () => {
    const repoDir = createGitRepo('absinthe-service', {
      'mix.exs': 'defmodule AbsintheService.MixProject do\nend',
      'lib/schema.ex': `
defmodule AbsintheService.Schema do
  use Absinthe.Schema

  query do
    field :bookings, list_of(:booking) do
      resolve(&AbsintheService.Resolvers.list_bookings/3)
    end
  end

  object :booking do
    field :id, :id
    field :guest_name, :string
  end

  input_object :booking_input do
    field :guest_name, non_null(:string)
  end
end
`,
    });

    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    const modules = db
      .prepare("SELECT name, type FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?) AND type LIKE 'absinthe_%'")
      .all('absinthe-service') as { name: string; type: string }[];
    expect(modules.length).toBeGreaterThanOrEqual(3);
    const types = modules.map(m => m.type).sort();
    expect(types).toContain('absinthe_object');
    expect(types).toContain('absinthe_input_object');
    expect(types).toContain('absinthe_query');
  });

  it('creates calls_grpc edges from repo to services when gRPC stubs detected', () => {
    const repoDir = createGitRepo('grpc-caller', {
      'mix.exs': 'defmodule GrpcCaller.MixProject do\nend',
      'proto/booking.proto': `
syntax = "proto3";
service BookingService {
  rpc CreateBooking (CreateBookingRequest) returns (CreateBookingResponse);
}
message CreateBookingRequest { string id = 1; }
message CreateBookingResponse { string id = 1; }
`,
      'lib/client.ex': `
defmodule GrpcCaller.BookingClient do
  use RpcClient.Client,
    service: Rpc.Booking.V1.BookingService,
    stub: Rpc.Booking.V1.BookingService.Stub
end
`,
    });

    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    const edges = db
      .prepare("SELECT relationship_type FROM edges WHERE relationship_type = 'calls_grpc'")
      .all() as { relationship_type: string }[];
    expect(edges.length).toBeGreaterThan(0);
  });

  it('creates Ecto association edges between modules', () => {
    const repoDir = createGitRepo('ecto-assoc', {
      'mix.exs': 'defmodule EctoAssoc.MixProject do\nend',
      'lib/booking.ex': `
defmodule EctoAssoc.Booking do
  use Ecto.Schema

  schema "bookings" do
    field :title, :string
    belongs_to :user, EctoAssoc.User
    has_many :items, EctoAssoc.Item
  end
end
`,
      'lib/user.ex': `
defmodule EctoAssoc.User do
  use Ecto.Schema

  schema "users" do
    field :name, :string
    has_many :bookings, EctoAssoc.Booking
  end
end
`,
      'lib/item.ex': `
defmodule EctoAssoc.Item do
  use Ecto.Schema

  schema "items" do
    field :label, :string
    belongs_to :booking, EctoAssoc.Booking
  end
end
`,
    });

    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    const edges = db
      .prepare("SELECT relationship_type, source_type, target_type FROM edges WHERE relationship_type IN ('belongs_to', 'has_many', 'has_one', 'many_to_many')")
      .all() as { relationship_type: string; source_type: string; target_type: string }[];
    expect(edges.length).toBeGreaterThanOrEqual(3);
    expect(edges.every(e => e.source_type === 'module' && e.target_type === 'module')).toBe(true);

    // Check specific belongs_to edge: Booking -> User
    const belongsToEdges = edges.filter(e => e.relationship_type === 'belongs_to');
    expect(belongsToEdges.length).toBeGreaterThan(0);
  });

  it('surgical mode includes services in wipe-and-reinsert', () => {
    const repoDir = createGitRepo('surgical-svc', {
      'mix.exs': 'defmodule SurgicalSvc.MixProject do\nend',
      'proto/svc.proto': `
syntax = "proto3";
service TestService {
  rpc DoThing (DoThingRequest) returns (DoThingResponse);
}
message DoThingRequest { string id = 1; }
message DoThingResponse { string id = 1; }
`,
      'lib/handler.ex': `
defmodule SurgicalSvc.Handler do
  def run, do: :ok
end
`,
    });

    ensureMainBranch(repoDir);

    // Full index first
    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    // Verify service exists
    const servicesBefore = db
      .prepare("SELECT name FROM services WHERE repo_id = (SELECT id FROM repos WHERE name = ?)")
      .all('surgical-svc') as { name: string }[];
    expect(servicesBefore).toHaveLength(1);

    // Modify handler only and commit
    fs.writeFileSync(path.join(repoDir, 'lib', 'handler.ex'), `
defmodule SurgicalSvc.Handler do
  @moduledoc "Updated"
  def run, do: :ok
end
`);
    execSync('git add -A && git commit -m "update handler"', { cwd: repoDir, stdio: 'pipe' });

    // Surgical re-index
    const result = indexSingleRepo(db, repoDir, { force: false, rootDir: tmpDir });
    expect(result.mode).toBe('surgical');

    // Services should survive surgical mode (wipe-and-reinsert)
    const servicesAfter = db
      .prepare("SELECT name FROM services WHERE repo_id = (SELECT id FROM repos WHERE name = ?)")
      .all('surgical-svc') as { name: string }[];
    expect(servicesAfter).toHaveLength(1);
    expect(servicesAfter[0].name).toBe('TestService');
  });

  it('surgical mode handles GraphQL modules', () => {
    const repoDir = createGitRepo('surgical-gql', {
      'mix.exs': 'defmodule SurgicalGql.MixProject do\nend',
      'schema.graphql': `
type Booking {
  id: ID!
}
`,
      'lib/mod.ex': `
defmodule SurgicalGql.Mod do
  def run, do: :ok
end
`,
    });

    ensureMainBranch(repoDir);

    // Full index first
    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    const gqlModsBefore = db
      .prepare("SELECT name FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?) AND type LIKE 'graphql_%'")
      .all('surgical-gql') as { name: string }[];
    expect(gqlModsBefore).toHaveLength(1);

    // Modify Elixir module only
    fs.writeFileSync(path.join(repoDir, 'lib', 'mod.ex'), `
defmodule SurgicalGql.Mod do
  @moduledoc "Updated"
  def run, do: :ok
end
`);
    execSync('git add -A && git commit -m "update mod"', { cwd: repoDir, stdio: 'pipe' });

    const result = indexSingleRepo(db, repoDir, { force: false, rootDir: tmpDir });
    expect(result.mode).toBe('surgical');

    // GraphQL modules should survive (unchanged file not in changedSet)
    const gqlModsAfter = db
      .prepare("SELECT name FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?) AND type LIKE 'graphql_%'")
      .all('surgical-gql') as { name: string }[];
    expect(gqlModsAfter).toHaveLength(1);
  });

  it('surgical mode handles Ecto fields', () => {
    const repoDir = createGitRepo('surgical-ecto', {
      'mix.exs': 'defmodule SurgicalEcto.MixProject do\nend',
      'lib/schema.ex': `
defmodule SurgicalEcto.Booking do
  use Ecto.Schema

  schema "bookings" do
    field :title, :string
  end
end
`,
      'lib/other.ex': `
defmodule SurgicalEcto.Other do
  def run, do: :ok
end
`,
    });

    ensureMainBranch(repoDir);

    // Full index
    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    const ectoBefore = db
      .prepare("SELECT table_name, schema_fields FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?) AND table_name IS NOT NULL")
      .get('surgical-ecto') as { table_name: string; schema_fields: string } | undefined;
    expect(ectoBefore).toBeDefined();
    expect(ectoBefore!.table_name).toBe('bookings');

    // Modify other file only
    fs.writeFileSync(path.join(repoDir, 'lib', 'other.ex'), `
defmodule SurgicalEcto.Other do
  @moduledoc "Updated"
  def run, do: :ok
end
`);
    execSync('git add -A && git commit -m "update other"', { cwd: repoDir, stdio: 'pipe' });

    const result = indexSingleRepo(db, repoDir, { force: false, rootDir: tmpDir });
    expect(result.mode).toBe('surgical');

    // Ecto schema should survive with table_name and schema_fields
    const ectoAfter = db
      .prepare("SELECT table_name, schema_fields FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?) AND table_name IS NOT NULL")
      .get('surgical-ecto') as { table_name: string; schema_fields: string } | undefined;
    expect(ectoAfter).toBeDefined();
    expect(ectoAfter!.table_name).toBe('bookings');
    expect(ectoAfter!.schema_fields).toBeTruthy();
  });
});

describe('end-to-end search integration', () => {
  it('all new extractor data is searchable via FTS', () => {
    const repoDir = createGitRepo('e2e-search', {
      'mix.exs': 'defmodule E2eSearch.MixProject do\nend',
      'proto/booking.proto': `
syntax = "proto3";
package booking.v1;

service BookingService {
  rpc CreateBooking (CreateBookingRequest) returns (CreateBookingResponse);
  rpc CancelBooking (CancelBookingRequest) returns (CancelBookingResponse);
}

message CreateBookingRequest { string id = 1; }
message CreateBookingResponse { string id = 1; }
message CancelBookingRequest { string id = 1; }
message CancelBookingResponse { string id = 1; }
`,
      'schema.graphql': `
type Reservation {
  id: ID!
  guestName: String!
  status: ReservationStatus!
}

enum ReservationStatus {
  PENDING
  CONFIRMED
}
`,
      'lib/appointment.ex': `
defmodule E2eSearch.Appointment do
  use Ecto.Schema

  schema "appointments" do
    field :title, :string
    field :duration, :integer
    belongs_to :client, E2eSearch.Client
  end
end
`,
      'lib/client.ex': `
defmodule E2eSearch.Client do
  use Ecto.Schema

  schema "clients" do
    field :name, :string
    has_many :appointments, E2eSearch.Appointment
  end
end
`,
      'lib/schema.ex': `
defmodule E2eSearch.Schema do
  use Absinthe.Schema

  query do
    field :appointments, list_of(:appointment)
  end

  object :appointment do
    field :id, :id
    field :title, :string
  end
end
`,
    });

    indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

    // Verify gRPC services
    const grpcServices = db
      .prepare("SELECT * FROM services WHERE service_type = 'grpc'")
      .all() as { name: string; description: string }[];
    expect(grpcServices).toHaveLength(1);
    expect(grpcServices[0].name).toBe('BookingService');

    // Verify Ecto schema modules with table_name and schema_fields
    const ectoModules = db
      .prepare("SELECT * FROM modules WHERE table_name IS NOT NULL")
      .all() as { name: string; table_name: string; schema_fields: string }[];
    expect(ectoModules.length).toBeGreaterThanOrEqual(2);
    const appointmentMod = ectoModules.find(m => m.table_name === 'appointments');
    expect(appointmentMod).toBeDefined();
    expect(JSON.parse(appointmentMod!.schema_fields)).toContainEqual({ name: 'title', type: 'string' });

    // Verify GraphQL type modules
    const gqlModules = db
      .prepare("SELECT * FROM modules WHERE type LIKE 'graphql_%'")
      .all() as { name: string; type: string }[];
    expect(gqlModules.length).toBeGreaterThanOrEqual(2);
    const gqlNames = gqlModules.map(m => m.name).sort();
    expect(gqlNames).toContain('Reservation');
    expect(gqlNames).toContain('ReservationStatus');

    // Verify Absinthe type modules
    const absintheModules = db
      .prepare("SELECT * FROM modules WHERE type LIKE 'absinthe_%'")
      .all() as { name: string; type: string }[];
    expect(absintheModules.length).toBeGreaterThanOrEqual(2);
    expect(absintheModules.map(m => m.type)).toContain('absinthe_object');
    expect(absintheModules.map(m => m.type)).toContain('absinthe_query');

    // Verify Ecto association edges
    const assocEdges = db
      .prepare("SELECT relationship_type FROM edges WHERE relationship_type IN ('belongs_to', 'has_many')")
      .all() as { relationship_type: string }[];
    expect(assocEdges.length).toBeGreaterThanOrEqual(2);

    // FTS: search for table name returns the Ecto schema module
    const tableResults = search(db, 'appointments');
    expect(tableResults.length).toBeGreaterThan(0);
    const moduleResult = tableResults.find(r => parseCompositeType(r.entityType as string).entityType === 'module');
    expect(moduleResult).toBeDefined();

    // FTS: search for gRPC service name returns the service
    const serviceResults = search(db, 'BookingService');
    expect(serviceResults.length).toBeGreaterThan(0);
    const serviceResult = serviceResults.find(r => parseCompositeType(r.entityType as string).entityType === 'service');
    expect(serviceResult).toBeDefined();
  });
});

describe('parallel indexing', () => {
  let savedConcurrency: string | undefined;

  beforeEach(() => {
    savedConcurrency = process.env.KB_CONCURRENCY;
  });

  afterEach(() => {
    if (savedConcurrency === undefined) delete process.env.KB_CONCURRENCY;
    else process.env.KB_CONCURRENCY = savedConcurrency;
  });

  function ensureMainBranch(repoDir: string): void {
    try { execSync('git branch -m master main', { cwd: repoDir, stdio: 'pipe' }); } catch { /* already main */ }
  }

  it('produces identical DB state for sequential (KB_CONCURRENCY=1) and parallel (KB_CONCURRENCY=3) runs', async () => {
    const rootDir = path.join(tmpDir, 'repos');

    // Create 3 repos: repo-a (2 Elixir modules), repo-b (1 proto with 2 messages), repo-c (1 module + 1 proto message)
    const repoA = createGitRepo('repo-a', {
      'mix.exs': 'defmodule RepoA.MixProject do\nend',
      'lib/alpha.ex': `
defmodule RepoA.Alpha do
  @moduledoc "Alpha module"
  def run, do: :ok
end
`,
      'lib/beta.ex': `
defmodule RepoA.Beta do
  @moduledoc "Beta module"
  def run, do: :ok
end
`,
    });
    ensureMainBranch(repoA);

    const repoB = createGitRepo('repo-b', {
      'mix.exs': 'defmodule RepoB.MixProject do\nend',
      'proto/events.proto': `
syntax = "proto3";
package test;

message EventOne {
  string id = 1;
}

message EventTwo {
  string name = 1;
}
`,
    });
    ensureMainBranch(repoB);

    const repoC = createGitRepo('repo-c', {
      'mix.exs': 'defmodule RepoC.MixProject do\nend',
      'lib/gamma.ex': `
defmodule RepoC.Gamma do
  @moduledoc "Gamma module"
  def run, do: :ok
end
`,
      'proto/msg.proto': `
syntax = "proto3";
package test;

message SingleMsg {
  string id = 1;
}
`,
    });
    ensureMainBranch(repoC);

    // Sequential run: KB_CONCURRENCY=1
    process.env.KB_CONCURRENCY = '1';
    await indexAllRepos(db, { force: true, rootDir });

    // Snapshot sequential state
    const seqModules = db.prepare('SELECT name FROM modules ORDER BY name').all() as { name: string }[];
    const seqEvents = db.prepare('SELECT name FROM events ORDER BY name').all() as { name: string }[];
    const seqRepos = db.prepare('SELECT name FROM repos ORDER BY name').all() as { name: string }[];

    // Reset DB: close and reopen
    closeDatabase(db);
    fs.unlinkSync(dbPath);
    db = openDatabase(dbPath);

    // Parallel run: KB_CONCURRENCY=3
    process.env.KB_CONCURRENCY = '3';
    await indexAllRepos(db, { force: true, rootDir });

    // Snapshot parallel state
    const parModules = db.prepare('SELECT name FROM modules ORDER BY name').all() as { name: string }[];
    const parEvents = db.prepare('SELECT name FROM events ORDER BY name').all() as { name: string }[];
    const parRepos = db.prepare('SELECT name FROM repos ORDER BY name').all() as { name: string }[];

    // Compare: identical DB state
    expect(parModules).toEqual(seqModules);
    expect(parEvents).toEqual(seqEvents);
    expect(parRepos).toEqual(seqRepos);
  });

  it('isolates errors: failed repo does not prevent others from succeeding', async () => {
    const rootDir = path.join(tmpDir, 'repos');

    // Create 3 repos
    const goodA = createGitRepo('good-a', {
      'mix.exs': 'defmodule GoodA.MixProject do\nend',
      'lib/mod.ex': `
defmodule GoodA.Mod do
  @moduledoc "Good A module"
  def run, do: :ok
end
`,
    });
    ensureMainBranch(goodA);

    const goodB = createGitRepo('good-b', {
      'mix.exs': 'defmodule GoodB.MixProject do\nend',
      'lib/mod.ex': `
defmodule GoodB.Mod do
  @moduledoc "Good B module"
  def run, do: :ok
end
`,
    });
    ensureMainBranch(goodB);

    const badRepo = createGitRepo('bad-repo', {
      'mix.exs': 'defmodule BadRepo.MixProject do\nend',
      'lib/mod.ex': `
defmodule BadRepo.Mod do
  def run, do: :ok
end
`,
    });
    ensureMainBranch(badRepo);

    // Sabotage bad-repo: replace repo directory with a file after discovery
    // This makes it past scanner (has .git check) but causes extraction to fail.
    // We destroy the dir and create a file in its place.
    fs.rmSync(badRepo, { recursive: true, force: true });
    fs.writeFileSync(badRepo, 'not-a-directory');

    process.env.KB_CONCURRENCY = '3';
    const results = await indexAllRepos(db, { force: true, rootDir });

    // The pipeline should not crash -- all repos get a result
    expect(results.length).toBeGreaterThanOrEqual(2);

    // good-a and good-b should succeed
    const goodAResult = results.find(r => r.repo === 'good-a');
    const goodBResult = results.find(r => r.repo === 'good-b');
    expect(goodAResult).toBeDefined();
    expect(goodAResult!.status).toBe('success');
    expect(goodBResult).toBeDefined();
    expect(goodBResult!.status).toBe('success');

    // Verify good repos' modules are actually in the DB
    const modules = db.prepare('SELECT name FROM modules ORDER BY name').all() as { name: string }[];
    expect(modules.map(m => m.name)).toContain('GoodA.Mod');
    expect(modules.map(m => m.name)).toContain('GoodB.Mod');
  });

  it('works with KB_CONCURRENCY=1 (sequential fallback)', async () => {
    const rootDir = path.join(tmpDir, 'repos');

    const repoX = createGitRepo('seq-x', {
      'mix.exs': 'defmodule SeqX.MixProject do\nend',
      'lib/mod.ex': `
defmodule SeqX.Mod do
  def run, do: :ok
end
`,
    });
    ensureMainBranch(repoX);

    const repoY = createGitRepo('seq-y', {
      'mix.exs': 'defmodule SeqY.MixProject do\nend',
      'lib/mod.ex': `
defmodule SeqY.Mod do
  def run, do: :ok
end
`,
    });
    ensureMainBranch(repoY);

    process.env.KB_CONCURRENCY = '1';
    const results = await indexAllRepos(db, { force: true, rootDir });

    const successes = results.filter(r => r.status === 'success');
    expect(successes).toHaveLength(2);

    const modules = db.prepare('SELECT name FROM modules ORDER BY name').all() as { name: string }[];
    expect(modules.map(m => m.name)).toContain('SeqX.Mod');
    expect(modules.map(m => m.name)).toContain('SeqY.Mod');
  });

  it('works with default concurrency (no KB_CONCURRENCY set)', async () => {
    const rootDir = path.join(tmpDir, 'repos');

    delete process.env.KB_CONCURRENCY;

    const repoP = createGitRepo('def-p', {
      'mix.exs': 'defmodule DefP.MixProject do\nend',
      'lib/mod.ex': `
defmodule DefP.Mod do
  def run, do: :ok
end
`,
    });
    ensureMainBranch(repoP);

    const repoQ = createGitRepo('def-q', {
      'mix.exs': 'defmodule DefQ.MixProject do\nend',
      'lib/mod.ex': `
defmodule DefQ.Mod do
  def run, do: :ok
end
`,
    });
    ensureMainBranch(repoQ);

    const results = await indexAllRepos(db, { force: true, rootDir });

    const successes = results.filter(r => r.status === 'success');
    expect(successes).toHaveLength(2);
  });

  it('returns a Promise that resolves to IndexResult[]', async () => {
    const rootDir = path.join(tmpDir, 'repos');

    createGitRepo('async-check', {
      'mix.exs': 'defmodule AsyncCheck.MixProject do\nend',
      'lib/mod.ex': `
defmodule AsyncCheck.Mod do
  def run, do: :ok
end
`,
    });

    const promise = indexAllRepos(db, { force: true, rootDir });
    expect(promise).toBeInstanceOf(Promise);

    const results = await promise;
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(1);
    expect(results[0].status).toBeDefined();
    expect(results[0].repo).toBeDefined();
  });
});
