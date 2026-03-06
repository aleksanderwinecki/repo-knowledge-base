import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';

// Mock git and pipeline modules before importing sync
vi.mock('../../src/indexer/git.js', () => ({
  getCurrentCommit: vi.fn(),
}));
vi.mock('../../src/indexer/pipeline.js', () => ({
  indexSingleRepo: vi.fn(() => ({ modules: 0, protos: 0, events: 0 })),
}));

import { checkAndSyncRepos } from '../../src/mcp/sync.js';
import { getCurrentCommit } from '../../src/indexer/git.js';
import { indexSingleRepo } from '../../src/indexer/pipeline.js';

const mockedGetCurrentCommit = vi.mocked(getCurrentCommit);
const mockedIndexSingleRepo = vi.mocked(indexSingleRepo);

let db: Database.Database;
let dbPath: string;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-sync-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
  vi.clearAllMocks();
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Insert a test repo row directly */
function insertRepo(
  name: string,
  repoPath: string,
  lastCommit: string | null,
): void {
  db.prepare(
    'INSERT INTO repos (name, path, last_indexed_commit) VALUES (?, ?, ?)',
  ).run(name, repoPath, lastCommit);
}

describe('checkAndSyncRepos', () => {
  it('returns 0 synced when no repos are stale', () => {
    // Repo exists with commit abc, HEAD is still abc
    insertRepo('fresh-repo', tmpDir, 'abc123');
    mockedGetCurrentCommit.mockReturnValue('abc123');

    const result = checkAndSyncRepos(db, ['fresh-repo']);

    expect(result.synced).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(mockedIndexSingleRepo).not.toHaveBeenCalled();
  });

  it('re-indexes 2 stale repos and returns synced count of 2', () => {
    insertRepo('repo-a', tmpDir, 'old-a');
    insertRepo('repo-b', tmpDir, 'old-b');

    mockedGetCurrentCommit.mockImplementation((repoPath: string) => {
      // Both repos have new commits
      return 'new-commit';
    });

    const result = checkAndSyncRepos(db, ['repo-a', 'repo-b']);

    expect(result.synced).toHaveLength(2);
    expect(result.synced).toContain('repo-a');
    expect(result.synced).toContain('repo-b');
    expect(mockedIndexSingleRepo).toHaveBeenCalledTimes(2);
  });

  it('caps re-indexing at 3 repos when 5 are stale', () => {
    for (let i = 0; i < 5; i++) {
      insertRepo(`repo-${i}`, tmpDir, `old-${i}`);
    }
    mockedGetCurrentCommit.mockReturnValue('new-commit');

    const repoNames = Array.from({ length: 5 }, (_, i) => `repo-${i}`);
    const result = checkAndSyncRepos(db, repoNames);

    expect(result.synced).toHaveLength(3);
    expect(result.skipped).toHaveLength(2);
    expect(mockedIndexSingleRepo).toHaveBeenCalledTimes(3);
  });

  it('skips repos whose path no longer exists on disk', () => {
    const fakePath = '/nonexistent/path/to/repo';
    insertRepo('gone-repo', fakePath, 'old-commit');
    mockedGetCurrentCommit.mockReturnValue('new-commit');

    const result = checkAndSyncRepos(db, ['gone-repo']);

    expect(result.synced).toHaveLength(0);
    expect(mockedIndexSingleRepo).not.toHaveBeenCalled();
  });

  it('skips repos not found in database', () => {
    mockedGetCurrentCommit.mockReturnValue('some-commit');

    const result = checkAndSyncRepos(db, ['unknown-repo']);

    expect(result.synced).toHaveLength(0);
    expect(mockedIndexSingleRepo).not.toHaveBeenCalled();
  });

  it('returns object with synced and skipped arrays', () => {
    insertRepo('repo-a', tmpDir, 'old');
    mockedGetCurrentCommit.mockReturnValue('new');

    const result = checkAndSyncRepos(db, ['repo-a']);

    expect(result).toHaveProperty('synced');
    expect(result).toHaveProperty('skipped');
    expect(Array.isArray(result.synced)).toBe(true);
    expect(Array.isArray(result.skipped)).toBe(true);
  });
});
