import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { SCHEMA_VERSION } from '../../src/db/schema.js';
import { getCurrentVersion, setVersion, runMigrations } from '../../src/db/migrations.js';
import BetterSqlite3 from 'better-sqlite3';
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
    expect(colNames).toContain('default_branch');
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
    expect(version).toBe(SCHEMA_VERSION);
  });

  it('idempotent initialization', () => {
    // Opening a second connection to the same db should not throw
    const db2 = openDatabase(dbPath);
    const version = db2.pragma('user_version', { simple: true });
    expect(version).toBe(SCHEMA_VERSION);
    closeDatabase(db2);
  });
});

describe('v3 migration', () => {
  let db: Database.Database;
  let dbPath: string;

  /**
   * Create a raw v2 database by running only v1+v2 migrations manually,
   * then setting user_version to 2. This simulates an existing v2 database.
   */
  function createV2Database(filePath: string): Database.Database {
    const rawDb = new BetterSqlite3(filePath);
    rawDb.pragma('journal_mode = WAL');
    rawDb.pragma('foreign_keys = ON');
    // Run migrations up to v2 only
    runMigrations(rawDb, 0, 2);
    setVersion(rawDb, 2);
    return rawDb;
  }

  afterEach(() => {
    if (db?.open) closeDatabase(db);
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('migrates v2 database to v3 preserving data', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v3-migrate-${Date.now()}.db`);
    db = createV2Database(dbPath);

    // Insert sample data into v2 tables
    db.prepare("INSERT INTO repos (name, path) VALUES ('test-repo', '/tmp/test')").run();
    const repo = db.prepare("SELECT id FROM repos WHERE name = 'test-repo'").get() as { id: number };
    db.prepare("INSERT INTO modules (repo_id, name, type) VALUES (?, 'MyModule', 'context')").run(repo.id);
    db.prepare("INSERT INTO events (repo_id, name, schema_definition) VALUES (?, 'UserCreated', 'proto')").run(repo.id);
    db.prepare("INSERT INTO services (repo_id, name) VALUES (?, 'my-service')").run(repo.id);

    // Verify we're at v2
    expect(getCurrentVersion(db)).toBe(2);

    // Close and reopen via openDatabase, which should trigger v3 migration
    closeDatabase(db);
    db = openDatabase(dbPath);

    // Verify user_version is now current (v4, since openDatabase migrates to SCHEMA_VERSION)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);

    // Verify new columns exist on repos
    const repoCols = (db.pragma('table_info(repos)') as Array<{ name: string }>).map((c) => c.name);
    expect(repoCols).toContain('default_branch');

    // Verify new columns exist on modules
    const modCols = (db.pragma('table_info(modules)') as Array<{ name: string }>).map((c) => c.name);
    expect(modCols).toContain('table_name');
    expect(modCols).toContain('schema_fields');

    // Verify new columns exist on services
    const svcCols = (db.pragma('table_info(services)') as Array<{ name: string }>).map((c) => c.name);
    expect(svcCols).toContain('service_type');

    // Verify new columns exist on events
    const evtCols = (db.pragma('table_info(events)') as Array<{ name: string }>).map((c) => c.name);
    expect(evtCols).toContain('domain');
    expect(evtCols).toContain('owner_team');

    // Verify existing data is preserved
    const repoRow = db.prepare("SELECT name, path FROM repos WHERE name = 'test-repo'").get() as { name: string; path: string };
    expect(repoRow.name).toBe('test-repo');
    expect(repoRow.path).toBe('/tmp/test');

    const modRow = db.prepare("SELECT name, type FROM modules WHERE name = 'MyModule'").get() as { name: string; type: string };
    expect(modRow.name).toBe('MyModule');
    expect(modRow.type).toBe('context');

    const evtRow = db.prepare("SELECT name, schema_definition FROM events WHERE name = 'UserCreated'").get() as { name: string; schema_definition: string };
    expect(evtRow.name).toBe('UserCreated');
    expect(evtRow.schema_definition).toBe('proto');

    const svcRow = db.prepare("SELECT name FROM services WHERE name = 'my-service'").get() as { name: string };
    expect(svcRow.name).toBe('my-service');
  });

  it('fresh database has all v3 columns', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v3-fresh-${Date.now()}.db`);
    db = openDatabase(dbPath);

    // repos: default_branch
    const repoCols = (db.pragma('table_info(repos)') as Array<{ name: string }>).map((c) => c.name);
    expect(repoCols).toContain('default_branch');

    // modules: table_name, schema_fields
    const modCols = (db.pragma('table_info(modules)') as Array<{ name: string }>).map((c) => c.name);
    expect(modCols).toContain('table_name');
    expect(modCols).toContain('schema_fields');

    // services: service_type
    const svcCols = (db.pragma('table_info(services)') as Array<{ name: string }>).map((c) => c.name);
    expect(svcCols).toContain('service_type');

    // events: domain, owner_team
    const evtCols = (db.pragma('table_info(events)') as Array<{ name: string }>).map((c) => c.name);
    expect(evtCols).toContain('domain');
    expect(evtCols).toContain('owner_team');
  });

  it('user_version pragma reaches current version after migration from v2', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v3-version-${Date.now()}.db`);
    db = createV2Database(dbPath);
    expect(getCurrentVersion(db)).toBe(2);

    closeDatabase(db);
    db = openDatabase(dbPath);

    expect(getCurrentVersion(db)).toBe(SCHEMA_VERSION);
  });
});

describe('v4 migration', () => {
  let db: Database.Database;
  let dbPath: string;

  /**
   * Create a raw v3 database by running only v1+v2+v3 migrations manually,
   * then setting user_version to 3. This simulates an existing v3 database.
   */
  function createV3Database(filePath: string): Database.Database {
    const rawDb = new BetterSqlite3(filePath);
    rawDb.pragma('journal_mode = WAL');
    rawDb.pragma('foreign_keys = ON');
    runMigrations(rawDb, 0, 3);
    setVersion(rawDb, 3);
    return rawDb;
  }

  afterEach(() => {
    if (db?.open) closeDatabase(db);
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('v4 migration adds file_id column to events table', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v4-fileid-${Date.now()}.db`);
    db = createV3Database(dbPath);

    // Verify file_id does NOT exist in v3
    const colsBefore = (db.pragma('table_info(events)') as Array<{ name: string }>).map((c) => c.name);
    expect(colsBefore).not.toContain('file_id');

    // Close and reopen to trigger migration
    closeDatabase(db);
    db = openDatabase(dbPath);

    // Verify file_id now exists
    const colsAfter = (db.pragma('table_info(events)') as Array<{ name: string }>).map((c) => c.name);
    expect(colsAfter).toContain('file_id');
  });

  it('v3 databases auto-migrate to v4 preserving existing event data', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v4-preserve-${Date.now()}.db`);
    db = createV3Database(dbPath);

    // Insert sample data into v3 tables
    db.prepare("INSERT INTO repos (name, path) VALUES ('v4-test-repo', '/tmp/v4')").run();
    const repo = db.prepare("SELECT id FROM repos WHERE name = 'v4-test-repo'").get() as { id: number };
    db.prepare("INSERT INTO events (repo_id, name, schema_definition, source_file) VALUES (?, 'OrderPlaced', 'proto def', 'proto/order.proto')").run(repo.id);

    expect(getCurrentVersion(db)).toBe(3);

    closeDatabase(db);
    db = openDatabase(dbPath);

    // Should be v4 now
    expect(getCurrentVersion(db)).toBe(4);

    // Existing event data preserved
    const evtRow = db.prepare("SELECT name, schema_definition, source_file, file_id FROM events WHERE name = 'OrderPlaced'").get() as {
      name: string;
      schema_definition: string;
      source_file: string;
      file_id: number | null;
    };
    expect(evtRow.name).toBe('OrderPlaced');
    expect(evtRow.schema_definition).toBe('proto def');
    expect(evtRow.source_file).toBe('proto/order.proto');
    expect(evtRow.file_id).toBeNull(); // migrated rows have null file_id
  });

  it('SCHEMA_VERSION is 5', () => {
    expect(SCHEMA_VERSION).toBe(5);
  });

  it('fresh database has file_id column on events', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v4-fresh-${Date.now()}.db`);
    db = openDatabase(dbPath);

    const evtCols = (db.pragma('table_info(events)') as Array<{ name: string }>).map((c) => c.name);
    expect(evtCols).toContain('file_id');
  });
});

describe('v5 migration', () => {
  let db: Database.Database;
  let dbPath: string;

  /**
   * Create a raw v4 database by running only v1-v4 migrations manually,
   * then setting user_version to 4. This simulates an existing v4 database.
   */
  function createV4Database(filePath: string): Database.Database {
    const rawDb = new BetterSqlite3(filePath);
    rawDb.pragma('journal_mode = WAL');
    rawDb.pragma('foreign_keys = ON');
    runMigrations(rawDb, 0, 4);
    setVersion(rawDb, 4);
    return rawDb;
  }

  afterEach(() => {
    if (db?.open) closeDatabase(db);
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('creates idx_modules_name index', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v5-idx-mod-name-${Date.now()}.db`);
    db = createV4Database(dbPath);
    closeDatabase(db);
    db = openDatabase(dbPath);

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_modules_name'"
    ).all() as Array<{ name: string }>;
    expect(indexes.length).toBe(1);
  });

  it('creates idx_events_name index', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v5-idx-evt-name-${Date.now()}.db`);
    db = createV4Database(dbPath);
    closeDatabase(db);
    db = openDatabase(dbPath);

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_events_name'"
    ).all() as Array<{ name: string }>;
    expect(indexes.length).toBe(1);
  });

  it('creates idx_services_name index', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v5-idx-svc-name-${Date.now()}.db`);
    db = createV4Database(dbPath);
    closeDatabase(db);
    db = openDatabase(dbPath);

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_services_name'"
    ).all() as Array<{ name: string }>;
    expect(indexes.length).toBe(1);
  });

  it('creates idx_modules_repo_file index', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v5-idx-mod-rf-${Date.now()}.db`);
    db = createV4Database(dbPath);
    closeDatabase(db);
    db = openDatabase(dbPath);

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_modules_repo_file'"
    ).all() as Array<{ name: string }>;
    expect(indexes.length).toBe(1);
  });

  it('creates idx_events_repo_file index', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v5-idx-evt-rf-${Date.now()}.db`);
    db = createV4Database(dbPath);
    closeDatabase(db);
    db = openDatabase(dbPath);

    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name = 'idx_events_repo_file'"
    ).all() as Array<{ name: string }>;
    expect(indexes.length).toBe(1);
  });

  it('rebuilds knowledge_fts with prefix config', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v5-fts-prefix-${Date.now()}.db`);
    db = createV4Database(dbPath);

    // Initialize FTS (old version without prefix) and insert test data
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        name,
        description,
        entity_type UNINDEXED,
        entity_id UNINDEXED,
        tokenize = 'unicode61'
      );
    `);
    db.prepare(
      "INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)"
    ).run('authentication', 'handles user login', 'module:module', 1);

    closeDatabase(db);
    db = openDatabase(dbPath);

    // Verify prefix search works (2-char prefix query)
    const results = db.prepare(
      "SELECT name FROM knowledge_fts WHERE knowledge_fts MATCH ?"
    ).all('au*') as Array<{ name: string }>;
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('authentication');
  });

  it('FTS data survives V5 migration', () => {
    dbPath = path.join(os.tmpdir(), `rkb-v5-fts-data-${Date.now()}.db`);
    db = createV4Database(dbPath);

    // Initialize FTS (old version) and populate with test data
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
        name,
        description,
        entity_type UNINDEXED,
        entity_id UNINDEXED,
        tokenize = 'unicode61'
      );
    `);
    db.prepare(
      "INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)"
    ).run('UserService', 'manages users', 'service:service', 1);
    db.prepare(
      "INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)"
    ).run('OrderPlaced', 'order event', 'event:event', 2);
    db.prepare(
      "INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)"
    ).run('PaymentModule', 'payment processing', 'module:module', 3);

    closeDatabase(db);
    db = openDatabase(dbPath);

    // All 3 rows should survive
    const count = db.prepare(
      "SELECT COUNT(*) as cnt FROM knowledge_fts"
    ).get() as { cnt: number };
    expect(count.cnt).toBe(3);

    // Verify specific data preserved
    const row = db.prepare(
      "SELECT name, description, entity_type, entity_id FROM knowledge_fts WHERE knowledge_fts MATCH ?"
    ).get('UserService') as { name: string; description: string; entity_type: string; entity_id: number };
    expect(row.name).toBe('UserService');
    expect(row.description).toBe('manages users');
    expect(row.entity_type).toBe('service:service');
    expect(row.entity_id).toBe(1);
  });
});
