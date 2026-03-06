import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { persistRepoData } from '../../src/indexer/writer.js';
import {
  detectDeletedRepos,
  pruneDeletedRepos,
  flagStaleFacts,
} from '../../src/mcp/hygiene.js';

let db: Database.Database;
let dbPath: string;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-hygiene-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('detectDeletedRepos', () => {
  it('returns names of repos whose path does not exist on disk', () => {
    // Insert a repo with a nonexistent path
    db.prepare(
      'INSERT INTO repos (name, path, last_indexed_commit) VALUES (?, ?, ?)',
    ).run('deleted-repo', '/nonexistent/path/deleted-repo', 'abc123');

    const deleted = detectDeletedRepos(db);

    expect(deleted).toContain('deleted-repo');
  });

  it('returns empty array when all repos exist', () => {
    // Insert a repo that points to an existing directory (tmpDir)
    db.prepare(
      'INSERT INTO repos (name, path, last_indexed_commit) VALUES (?, ?, ?)',
    ).run('existing-repo', tmpDir, 'abc123');

    const deleted = detectDeletedRepos(db);

    expect(deleted).toEqual([]);
  });
});

describe('pruneDeletedRepos', () => {
  it('removes repo and all related entities from database', () => {
    // Insert a repo with modules, events, etc.
    persistRepoData(db, {
      metadata: {
        name: 'doomed-repo',
        path: '/nonexistent/doomed-repo',
        description: 'About to be pruned',
        techStack: ['elixir'],
        keyFiles: ['mix.exs'],
        currentCommit: 'abc123',
      },
      modules: [
        {
          name: 'DoomedModule',
          type: 'module',
          filePath: 'lib/doomed.ex',
          summary: 'This module will be pruned',
        },
      ],
      events: [
        {
          name: 'DoomedEvent',
          schemaDefinition: 'message DoomedEvent {}',
          sourceFile: 'proto/doomed.proto',
        },
      ],
    });

    // Verify data exists
    const repoBefore = db
      .prepare("SELECT id FROM repos WHERE name = 'doomed-repo'")
      .get() as { id: number } | undefined;
    expect(repoBefore).toBeDefined();

    const modulesBefore = db
      .prepare('SELECT COUNT(*) as count FROM modules WHERE repo_id = ?')
      .get(repoBefore!.id) as { count: number };
    expect(modulesBefore.count).toBeGreaterThan(0);

    // Prune
    pruneDeletedRepos(db, ['doomed-repo']);

    // Verify everything is gone
    const repoAfter = db
      .prepare("SELECT id FROM repos WHERE name = 'doomed-repo'")
      .get();
    expect(repoAfter).toBeUndefined();

    const modulesAfter = db
      .prepare('SELECT COUNT(*) as count FROM modules WHERE repo_id = ?')
      .get(repoBefore!.id) as { count: number };
    expect(modulesAfter.count).toBe(0);

    const eventsAfter = db
      .prepare('SELECT COUNT(*) as count FROM events WHERE repo_id = ?')
      .get(repoBefore!.id) as { count: number };
    expect(eventsAfter.count).toBe(0);
  });

  it('is idempotent - calling twice with same name does not error', () => {
    db.prepare(
      'INSERT INTO repos (name, path, last_indexed_commit) VALUES (?, ?, ?)',
    ).run('already-gone', '/nonexistent/already-gone', 'abc');

    pruneDeletedRepos(db, ['already-gone']);
    // Second call should not throw
    expect(() => pruneDeletedRepos(db, ['already-gone'])).not.toThrow();
  });
});

describe('flagStaleFacts', () => {
  it('returns learned facts older than N days with repo association', () => {
    // Insert a fact with an old timestamp
    db.prepare(
      "INSERT INTO learned_facts (content, repo, created_at) VALUES (?, ?, datetime('now', '-100 days'))",
    ).run('Old fact about auth', 'auth-service');

    // Insert a recent fact
    db.prepare(
      "INSERT INTO learned_facts (content, repo, created_at) VALUES (?, ?, datetime('now'))",
    ).run('Fresh fact', 'new-service');

    const stale = flagStaleFacts(db, 90);

    expect(stale).toHaveLength(1);
    expect(stale[0].content).toBe('Old fact about auth');
    expect(stale[0].repo).toBe('auth-service');
  });

  it('does NOT delete any facts', () => {
    db.prepare(
      "INSERT INTO learned_facts (content, repo, created_at) VALUES (?, ?, datetime('now', '-200 days'))",
    ).run('Very old fact', null);

    const before = db
      .prepare('SELECT COUNT(*) as count FROM learned_facts')
      .get() as { count: number };

    flagStaleFacts(db, 90);

    const after = db
      .prepare('SELECT COUNT(*) as count FROM learned_facts')
      .get() as { count: number };

    expect(after.count).toBe(before.count);
  });

  it('defaults to 90 days when maxAgeDays not specified', () => {
    // Insert a fact at 89 days old (should NOT be flagged)
    db.prepare(
      "INSERT INTO learned_facts (content, repo, created_at) VALUES (?, ?, datetime('now', '-89 days'))",
    ).run('Not quite stale', null);

    // Insert a fact at 91 days old (should be flagged)
    db.prepare(
      "INSERT INTO learned_facts (content, repo, created_at) VALUES (?, ?, datetime('now', '-91 days'))",
    ).run('Actually stale', null);

    const stale = flagStaleFacts(db);

    expect(stale).toHaveLength(1);
    expect(stale[0].content).toBe('Actually stale');
  });
});
