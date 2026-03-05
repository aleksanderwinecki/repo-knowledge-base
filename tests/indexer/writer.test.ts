import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { search } from '../../src/db/fts.js';
import {
  persistRepoData,
  clearRepoEntities,
} from '../../src/indexer/writer.js';
import type { RepoMetadata } from '../../src/indexer/metadata.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let dbPath: string;

function makeMetadata(overrides: Partial<RepoMetadata> = {}): RepoMetadata {
  return {
    name: 'test-repo',
    path: '/tmp/test-repo',
    description: 'A test repository',
    techStack: ['elixir', 'phoenix'],
    keyFiles: ['README.md', 'mix.exs', 'lib/'],
    currentCommit: 'abc123def456abc123def456abc123def456abc1',
    ...overrides,
  };
}

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-writer-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  const dir = path.dirname(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('persistRepoData', () => {
  it('inserts repo into database', () => {
    const metadata = makeMetadata();
    const result = persistRepoData(db, { metadata });

    expect(result.repoId).toBeGreaterThan(0);

    const row = db.prepare('SELECT * FROM repos WHERE id = ?').get(result.repoId) as {
      name: string;
      description: string;
      last_indexed_commit: string;
    };
    expect(row.name).toBe('test-repo');
    expect(row.description).toBe('A test repository');
    expect(row.last_indexed_commit).toBe('abc123def456abc123def456abc123def456abc1');
  });

  it('updates existing repo on re-index', () => {
    const metadata1 = makeMetadata({ description: 'Version 1' });
    persistRepoData(db, { metadata: metadata1 });

    const metadata2 = makeMetadata({ description: 'Version 2' });
    persistRepoData(db, { metadata: metadata2 });

    const rows = db.prepare('SELECT * FROM repos WHERE name = ?').all('test-repo');
    expect(rows).toHaveLength(1);
    expect((rows[0] as { description: string }).description).toBe('Version 2');
  });

  it('indexes repo in FTS', () => {
    const metadata = makeMetadata({ name: 'booking-service', description: 'Handles hotel bookings' });
    persistRepoData(db, { metadata });

    const results = search(db, 'booking');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entityType).toBe('repo');
    expect(results[0].name).toContain('booking');
  });

  it('persists modules with FTS indexing', () => {
    const metadata = makeMetadata();
    const modules = [
      { name: 'BookingContext', type: 'context', filePath: 'lib/booking_context.ex', summary: 'Handles bookings' },
      { name: 'PaymentService', type: 'module', filePath: 'lib/payment_service.ex', summary: null },
    ];

    persistRepoData(db, { metadata, modules });

    const moduleRows = db.prepare('SELECT * FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = ?)').all('test-repo');
    expect(moduleRows).toHaveLength(2);

    // Check FTS
    const results = search(db, 'booking');
    const moduleResults = results.filter(r => r.entityType === 'module');
    expect(moduleResults.length).toBeGreaterThan(0);
  });

  it('persists events with FTS indexing', () => {
    const metadata = makeMetadata();
    const events = [
      { name: 'BookingCreated', schemaDefinition: 'message BookingCreated { string id = 1; }', sourceFile: 'proto/booking.proto' },
    ];

    persistRepoData(db, { metadata, events });

    const eventRows = db.prepare('SELECT * FROM events WHERE repo_id = (SELECT id FROM repos WHERE name = ?)').all('test-repo');
    expect(eventRows).toHaveLength(1);

    // Check FTS
    const results = search(db, 'booking created');
    const eventResults = results.filter(r => r.entityType === 'event');
    expect(eventResults.length).toBeGreaterThan(0);
  });

  it('persists edges', () => {
    const metadata = makeMetadata();
    const edges = [
      {
        sourceType: 'service',
        sourceId: 1,
        targetType: 'event',
        targetId: 1,
        relationshipType: 'produces_event',
        sourceFile: 'proto/booking.proto',
      },
    ];

    persistRepoData(db, { metadata, edges });

    const edgeRows = db.prepare('SELECT * FROM edges').all();
    expect(edgeRows).toHaveLength(1);
  });
});

describe('clearRepoEntities', () => {
  it('removes all entities for a repo', () => {
    const metadata = makeMetadata();
    const modules = [
      { name: 'TestModule', type: 'module', filePath: 'lib/test.ex', summary: 'test' },
    ];
    const { repoId } = persistRepoData(db, { metadata, modules });

    // Verify data exists
    expect(
      (db.prepare('SELECT COUNT(*) as count FROM modules WHERE repo_id = ?').get(repoId) as { count: number }).count,
    ).toBe(1);

    clearRepoEntities(db, repoId);

    // Verify modules cleared
    expect(
      (db.prepare('SELECT COUNT(*) as count FROM modules WHERE repo_id = ?').get(repoId) as { count: number }).count,
    ).toBe(0);
  });

  it('removes FTS entries when clearing', () => {
    const metadata = makeMetadata({ name: 'fts-test-repo', description: 'Unique FTS description' });
    const modules = [
      { name: 'UniqueFtsModule', type: 'module', filePath: 'lib/unique.ex', summary: 'Unique module for FTS test' },
    ];
    const { repoId } = persistRepoData(db, { metadata, modules });

    // Verify FTS has entries
    expect(search(db, 'unique fts').length).toBeGreaterThan(0);

    clearRepoEntities(db, repoId);

    // FTS entries should be gone
    const results = search(db, 'unique fts module');
    expect(results.filter(r => r.entityType === 'module')).toHaveLength(0);
  });
});

describe('persistRepoData atomicity', () => {
  it('is atomic - full transaction on success', () => {
    const metadata = makeMetadata();
    const modules = [
      { name: 'Module1', type: 'module', filePath: 'lib/m1.ex', summary: null },
      { name: 'Module2', type: 'module', filePath: 'lib/m2.ex', summary: null },
    ];

    persistRepoData(db, { metadata, modules });

    // Both modules should exist
    const count = (db.prepare('SELECT COUNT(*) as count FROM modules').get() as { count: number }).count;
    expect(count).toBe(2);
  });

  it('clears old data on re-persist', () => {
    const metadata = makeMetadata();

    // First persist with 3 modules
    persistRepoData(db, {
      metadata,
      modules: [
        { name: 'A', type: 'module', filePath: 'lib/a.ex', summary: null },
        { name: 'B', type: 'module', filePath: 'lib/b.ex', summary: null },
        { name: 'C', type: 'module', filePath: 'lib/c.ex', summary: null },
      ],
    });

    // Re-persist with only 1 module
    persistRepoData(db, {
      metadata,
      modules: [
        { name: 'D', type: 'module', filePath: 'lib/d.ex', summary: null },
      ],
    });

    // Only the new module should exist
    const modules = db.prepare('SELECT name FROM modules').all() as { name: string }[];
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('D');
  });
});
