import { describe, it, expect, afterEach } from 'vitest';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { loadVecExtension, isVecAvailable } from '../../src/db/vec.js';
import { clearRepoEmbeddings } from '../../src/indexer/writer.js';
import { runMigrations, setVersion } from '../../src/db/migrations.js';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';

function tmpDbPath(name: string): string {
  return path.join(os.tmpdir(), `rkb-vec-${name}-${Date.now()}.db`);
}

describe('sqlite-vec extension loading', () => {
  let db: Database.Database;
  let dbPath: string;

  afterEach(() => {
    if (db?.open) closeDatabase(db);
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('loadVecExtension returns true and isVecAvailable returns true', () => {
    dbPath = tmpDbPath('load');
    db = new BetterSqlite3(dbPath);
    const result = loadVecExtension(db);
    expect(result).toBe(true);
    expect(isVecAvailable()).toBe(true);
  });

  it('openDatabase succeeds and loads sqlite-vec', () => {
    dbPath = tmpDbPath('open');
    db = openDatabase(dbPath);
    expect(isVecAvailable()).toBe(true);
  });

  it('vec_version() returns a version string after loading', () => {
    dbPath = tmpDbPath('version');
    db = new BetterSqlite3(dbPath);
    loadVecExtension(db);
    const version = db.prepare('SELECT vec_version()').pluck().get() as string;
    expect(version).toBeTruthy();
    expect(typeof version).toBe('string');
  });
});

describe('V8 migration - vec0 table', () => {
  let db: Database.Database;
  let dbPath: string;

  afterEach(() => {
    if (db?.open) closeDatabase(db);
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('entity_embeddings table exists after openDatabase', () => {
    dbPath = tmpDbPath('v8-table');
    db = openDatabase(dbPath);

    const tables = db.pragma('table_list') as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('entity_embeddings');
  });

  it('entity_embeddings accepts Float32Array insertion', () => {
    dbPath = tmpDbPath('v8-insert');
    db = openDatabase(dbPath);

    const embedding = new Float32Array(256);
    embedding[0] = 1.0;
    embedding[1] = 0.5;

    const insertStmt = db.prepare(
      'INSERT INTO entity_embeddings(embedding, entity_type, entity_id) VALUES (?, ?, ?)'
    );
    insertStmt.run(Buffer.from(embedding.buffer), 'module', '42');

    const count = db.prepare('SELECT COUNT(*) as cnt FROM entity_embeddings').get() as { cnt: number };
    expect(count.cnt).toBe(1);
  });

  it('entity_embeddings supports KNN query', () => {
    dbPath = tmpDbPath('v8-knn');
    db = openDatabase(dbPath);

    // Insert a few vectors
    const insertStmt = db.prepare(
      'INSERT INTO entity_embeddings(embedding, entity_type, entity_id) VALUES (?, ?, ?)'
    );

    const vec1 = new Float32Array(256).fill(0);
    vec1[0] = 1.0;
    insertStmt.run(Buffer.from(vec1.buffer), 'module', '1');

    const vec2 = new Float32Array(256).fill(0);
    vec2[0] = 0.9;
    insertStmt.run(Buffer.from(vec2.buffer), 'event', '2');

    const vec3 = new Float32Array(256).fill(0);
    vec3[0] = 0.1;
    insertStmt.run(Buffer.from(vec3.buffer), 'service', '3');

    // KNN query: find 2 nearest to vec1
    const queryVec = new Float32Array(256).fill(0);
    queryVec[0] = 1.0;

    const results = db.prepare(`
      SELECT entity_type, entity_id, distance
      FROM entity_embeddings
      WHERE embedding MATCH ?
      AND k = ?
      ORDER BY distance
    `).all(Buffer.from(queryVec.buffer), 2) as Array<{ entity_type: string; entity_id: number; distance: number }>;

    expect(results).toHaveLength(2);
    expect(results[0].entity_type).toBe('module');
    expect(results[0].entity_id).toBe('1');
    expect(results[0].distance).toBeCloseTo(0, 5);
  });

  it('V7 to V8 migration preserves existing data', () => {
    dbPath = tmpDbPath('v8-preserve');
    // Create a V7 database manually
    const rawDb = new BetterSqlite3(dbPath);
    rawDb.pragma('journal_mode = WAL');
    rawDb.pragma('foreign_keys = ON');
    // Load vec extension on raw db too
    loadVecExtension(rawDb);

    // Build up to V7 using static imports
    runMigrations(rawDb, 0, 7);
    setVersion(rawDb, 7);

    // Insert sample data
    rawDb.prepare("INSERT INTO repos (name, path) VALUES ('v8-test', '/tmp/v8')").run();
    rawDb.prepare("INSERT INTO modules (repo_id, name, type) VALUES (1, 'TestMod', 'context')").run();

    rawDb.close();

    // Reopen via openDatabase which triggers V8 migration
    db = openDatabase(dbPath);

    // Existing data preserved
    const repo = db.prepare("SELECT name FROM repos WHERE name = 'v8-test'").get() as { name: string };
    expect(repo.name).toBe('v8-test');

    const mod = db.prepare("SELECT name FROM modules WHERE name = 'TestMod'").get() as { name: string };
    expect(mod.name).toBe('TestMod');

    // vec0 table created
    const tables = db.pragma('table_list') as Array<{ name: string }>;
    expect(tables.map(t => t.name)).toContain('entity_embeddings');
  });
});

describe('clearRepoEmbeddings', () => {
  let db: Database.Database;
  let dbPath: string;

  afterEach(() => {
    if (db?.open) closeDatabase(db);
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('removes embeddings for all entity types belonging to a repo', () => {
    dbPath = tmpDbPath('clear-embeddings');
    db = openDatabase(dbPath);

    // Set up repo with entities
    db.prepare("INSERT INTO repos (name, path) VALUES ('emb-repo', '/tmp/emb')").run();
    const repo = db.prepare("SELECT id FROM repos WHERE name = 'emb-repo'").get() as { id: number };
    db.prepare("INSERT INTO modules (repo_id, name) VALUES (?, 'Mod1')").run(repo.id);
    db.prepare("INSERT INTO modules (repo_id, name) VALUES (?, 'Mod2')").run(repo.id);
    db.prepare("INSERT INTO events (repo_id, name) VALUES (?, 'Evt1')").run(repo.id);
    db.prepare("INSERT INTO services (repo_id, name) VALUES (?, 'Svc1')").run(repo.id);

    const mod1 = db.prepare("SELECT id FROM modules WHERE name = 'Mod1'").get() as { id: number };
    const mod2 = db.prepare("SELECT id FROM modules WHERE name = 'Mod2'").get() as { id: number };
    const evt1 = db.prepare("SELECT id FROM events WHERE name = 'Evt1'").get() as { id: number };
    const svc1 = db.prepare("SELECT id FROM services WHERE name = 'Svc1'").get() as { id: number };

    // Insert embeddings
    const insertEmb = db.prepare(
      'INSERT INTO entity_embeddings(embedding, entity_type, entity_id) VALUES (?, ?, ?)'
    );
    const dummyVec = Buffer.from(new Float32Array(256).fill(0.1).buffer);
    insertEmb.run(dummyVec, 'module', String(mod1.id));
    insertEmb.run(dummyVec, 'module', String(mod2.id));
    insertEmb.run(dummyVec, 'event', String(evt1.id));
    insertEmb.run(dummyVec, 'service', String(svc1.id));
    insertEmb.run(dummyVec, 'repo', String(repo.id));

    // Also insert embeddings for a different repo to prove we only delete the right ones
    db.prepare("INSERT INTO repos (name, path) VALUES ('other-repo', '/tmp/other')").run();
    const otherRepo = db.prepare("SELECT id FROM repos WHERE name = 'other-repo'").get() as { id: number };
    db.prepare("INSERT INTO modules (repo_id, name) VALUES (?, 'OtherMod')").run(otherRepo.id);
    const otherMod = db.prepare("SELECT id FROM modules WHERE name = 'OtherMod'").get() as { id: number };
    insertEmb.run(dummyVec, 'module', String(otherMod.id));
    insertEmb.run(dummyVec, 'repo', String(otherRepo.id));

    const countBefore = db.prepare('SELECT COUNT(*) as cnt FROM entity_embeddings').get() as { cnt: number };
    expect(countBefore.cnt).toBe(7);

    // Clear embeddings for the first repo
    clearRepoEmbeddings(db, repo.id);

    const countAfter = db.prepare('SELECT COUNT(*) as cnt FROM entity_embeddings').get() as { cnt: number };
    expect(countAfter.cnt).toBe(2); // Only other-repo's embeddings remain
  });
});
