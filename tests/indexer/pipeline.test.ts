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
});
