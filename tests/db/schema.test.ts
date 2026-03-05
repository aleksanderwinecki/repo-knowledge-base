import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import type Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';

function tmpDbPath(name: string): string {
  return path.join(os.tmpdir(), `rkb-schema-${name}-${Date.now()}.db`);
}

describe('schema', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath('test');
    db = openDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase(db);
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('creates all expected tables', () => {
    const tables = db.pragma('table_list') as Array<{ name: string; type: string }>;
    const tableNames = tables.map((t) => t.name).filter((n) => !n.startsWith('sqlite_'));

    expect(tableNames).toContain('repos');
    expect(tableNames).toContain('files');
    expect(tableNames).toContain('modules');
    expect(tableNames).toContain('services');
    expect(tableNames).toContain('events');
    expect(tableNames).toContain('edges');
  });

  it('repos table has correct columns', () => {
    const columns = db.pragma('table_info(repos)') as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('name');
    expect(colNames).toContain('path');
    expect(colNames).toContain('description');
    expect(colNames).toContain('last_indexed_commit');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
  });

  it('edges table has correct columns', () => {
    const columns = db.pragma('table_info(edges)') as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('source_type');
    expect(colNames).toContain('source_id');
    expect(colNames).toContain('target_type');
    expect(colNames).toContain('target_id');
    expect(colNames).toContain('relationship_type');
    expect(colNames).toContain('source_file');
    expect(colNames).toContain('created_at');
  });

  it('edges table has correct indexes', () => {
    const indexes = db.pragma('index_list(edges)') as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_edges_source');
    expect(indexNames).toContain('idx_edges_target');
    expect(indexNames).toContain('idx_edges_relationship');
  });

  it('foreign key cascade deletes', () => {
    // Insert a repo
    db.prepare("INSERT INTO repos (name, path) VALUES ('cascade-test', '/tmp/cascade')").run();
    const repo = db.prepare("SELECT id FROM repos WHERE name = 'cascade-test'").get() as {
      id: number;
    };

    // Insert a file referencing the repo
    db.prepare('INSERT INTO files (repo_id, path) VALUES (?, ?)').run(repo.id, 'src/main.ts');
    const filesBefore = db
      .prepare('SELECT COUNT(*) as count FROM files WHERE repo_id = ?')
      .get(repo.id) as { count: number };
    expect(filesBefore.count).toBe(1);

    // Delete the repo — file should cascade
    db.prepare('DELETE FROM repos WHERE id = ?').run(repo.id);
    const filesAfter = db
      .prepare('SELECT COUNT(*) as count FROM files WHERE repo_id = ?')
      .get(repo.id) as { count: number };
    expect(filesAfter.count).toBe(0);
  });

  it('unique constraints enforced', () => {
    db.prepare("INSERT INTO repos (name, path) VALUES ('unique-test', '/tmp/a')").run();

    expect(() => {
      db.prepare("INSERT INTO repos (name, path) VALUES ('unique-test', '/tmp/b')").run();
    }).toThrow();
  });

  it('last_indexed_commit stores git SHA', () => {
    const sha = 'abc123def456789';
    db.prepare(
      "INSERT INTO repos (name, path, last_indexed_commit) VALUES ('sha-test', '/tmp/sha', ?)",
    ).run(sha);

    const row = db.prepare("SELECT last_indexed_commit FROM repos WHERE name = 'sha-test'").get() as {
      last_indexed_commit: string;
    };
    expect(row.last_indexed_commit).toBe(sha);
  });

  it('edges table supports graph-like queries', () => {
    // Insert two services
    db.prepare("INSERT INTO repos (name, path) VALUES ('graph-repo', '/tmp/graph')").run();
    const repo = db.prepare("SELECT id FROM repos WHERE name = 'graph-repo'").get() as {
      id: number;
    };

    db.prepare("INSERT INTO services (repo_id, name) VALUES (?, 'service-a')").run(repo.id);
    db.prepare("INSERT INTO services (repo_id, name) VALUES (?, 'service-b')").run(repo.id);

    const svcA = db.prepare("SELECT id FROM services WHERE name = 'service-a'").get() as {
      id: number;
    };
    const svcB = db.prepare("SELECT id FROM services WHERE name = 'service-b'").get() as {
      id: number;
    };

    // Insert an edge
    db.prepare(`
      INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file)
      VALUES ('service', ?, 'service', ?, 'calls_grpc', 'src/client.ts')
    `).run(svcA.id, svcB.id);

    // Query with recursive CTE (1 hop from service-a)
    const results = db
      .prepare(
        `
      WITH RECURSIVE reachable(entity_type, entity_id, depth) AS (
        SELECT 'service', id, 0 FROM services WHERE name = 'service-a'
        UNION ALL
        SELECT e.target_type, e.target_id, r.depth + 1
        FROM edges e
        JOIN reachable r ON e.source_type = r.entity_type AND e.source_id = r.entity_id
        WHERE r.depth < 2
      )
      SELECT DISTINCT entity_type, entity_id, depth FROM reachable WHERE depth > 0
    `,
      )
      .all() as Array<{ entity_type: string; entity_id: number; depth: number }>;

    expect(results.length).toBe(1);
    expect(results[0].entity_type).toBe('service');
    expect(results[0].entity_id).toBe(svcB.id);
    expect(results[0].depth).toBe(1);
  });

  it('schema version is set', () => {
    const version = db.pragma('user_version', { simple: true });
    expect(version).toBe(1);
  });

  it('idempotent initialization', () => {
    // Opening a second connection to the same db should not throw
    const db2 = openDatabase(dbPath);
    const version = db2.pragma('user_version', { simple: true });
    expect(version).toBe(1);
    closeDatabase(db2);
  });
});
