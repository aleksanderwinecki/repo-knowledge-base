import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { SCHEMA_VERSION, createSchema } from '../../src/db/schema.js';
import { getCurrentVersion, setVersion } from '../../src/db/migrations.js';
import type { FieldData } from '../../src/indexer/writer.js';
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

  it('SCHEMA_VERSION is 10', () => {
    expect(SCHEMA_VERSION).toBe(10);
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
    expect(tableNames).toContain('learned_facts');
    expect(tableNames).toContain('fields');
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

  it('modules table has correct columns', () => {
    const columns = db.pragma('table_info(modules)') as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('repo_id');
    expect(colNames).toContain('file_id');
    expect(colNames).toContain('name');
    expect(colNames).toContain('type');
    expect(colNames).toContain('summary');
    expect(colNames).toContain('table_name');
    expect(colNames).toContain('schema_fields');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
  });

  it('services table has correct columns', () => {
    const columns = db.pragma('table_info(services)') as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('repo_id');
    expect(colNames).toContain('name');
    expect(colNames).toContain('description');
    expect(colNames).toContain('service_type');
    expect(colNames).toContain('created_at');
    expect(colNames).toContain('updated_at');
  });

  it('events table has correct columns', () => {
    const columns = db.pragma('table_info(events)') as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('repo_id');
    expect(colNames).toContain('name');
    expect(colNames).toContain('schema_definition');
    expect(colNames).toContain('source_file');
    expect(colNames).toContain('file_id');
    expect(colNames).toContain('domain');
    expect(colNames).toContain('owner_team');
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
    expect(colNames).toContain('metadata');
    expect(colNames).toContain('created_at');
  });

  it('fields table has correct columns', () => {
    const columns = db.pragma('table_info(fields)') as Array<{ name: string }>;
    const colNames = columns.map((c) => c.name);

    expect(colNames).toContain('id');
    expect(colNames).toContain('repo_id');
    expect(colNames).toContain('parent_type');
    expect(colNames).toContain('parent_name');
    expect(colNames).toContain('field_name');
    expect(colNames).toContain('field_type');
    expect(colNames).toContain('nullable');
    expect(colNames).toContain('source_file');
    expect(colNames).toContain('module_id');
    expect(colNames).toContain('event_id');
    expect(colNames).toContain('created_at');
  });

  it('edges table has correct indexes', () => {
    const indexes = db.pragma('index_list(edges)') as Array<{ name: string }>;
    const indexNames = indexes.map((i) => i.name);

    expect(indexNames).toContain('idx_edges_source');
    expect(indexNames).toContain('idx_edges_target');
    expect(indexNames).toContain('idx_edges_relationship');
  });

  it('all expected indexes exist', () => {
    const allIndexes = db.prepare(
      "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    ).all() as Array<{ name: string; tbl_name: string }>;
    const indexNames = allIndexes.map((i) => i.name);

    // Edge indexes
    expect(indexNames).toContain('idx_edges_source');
    expect(indexNames).toContain('idx_edges_target');
    expect(indexNames).toContain('idx_edges_relationship');

    // Name indexes
    expect(indexNames).toContain('idx_modules_name');
    expect(indexNames).toContain('idx_events_name');
    expect(indexNames).toContain('idx_services_name');

    // Compound indexes
    expect(indexNames).toContain('idx_modules_repo_file');
    expect(indexNames).toContain('idx_events_repo_file');

    // Field indexes
    expect(indexNames).toContain('idx_fields_repo');
    expect(indexNames).toContain('idx_fields_name');
    expect(indexNames).toContain('idx_fields_parent');
    expect(indexNames).toContain('idx_fields_module');
    expect(indexNames).toContain('idx_fields_event');
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

    // Delete the repo -- file should cascade
    db.prepare('DELETE FROM repos WHERE id = ?').run(repo.id);
    const filesAfter = db
      .prepare('SELECT COUNT(*) as count FROM files WHERE repo_id = ?')
      .get(repo.id) as { count: number };
    expect(filesAfter.count).toBe(0);
  });

  it('foreign key cascade deletes fields when repo is deleted', () => {
    db.prepare("INSERT INTO repos (name, path) VALUES ('fk-test', '/tmp/fk')").run();
    const repo = db.prepare("SELECT id FROM repos WHERE name = 'fk-test'").get() as { id: number };

    db.prepare(
      "INSERT INTO fields (repo_id, parent_type, parent_name, field_name, field_type, nullable) VALUES (?, 'ecto_schema', 'User', 'email', 'string', 0)"
    ).run(repo.id);

    const fieldsBefore = db.prepare('SELECT COUNT(*) as count FROM fields WHERE repo_id = ?').get(repo.id) as { count: number };
    expect(fieldsBefore.count).toBe(1);

    db.prepare('DELETE FROM repos WHERE id = ?').run(repo.id);
    const fieldsAfter = db.prepare('SELECT COUNT(*) as count FROM fields WHERE repo_id = ?').get(repo.id) as { count: number };
    expect(fieldsAfter.count).toBe(0);
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

    db.prepare(`
      INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file)
      VALUES ('service', ?, 'service', ?, 'calls_grpc', 'src/client.ts')
    `).run(svcA.id, svcB.id);

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

  it('FTS table exists on fresh DB', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_fts'"
    ).all() as Array<{ name: string }>;
    expect(tables.length).toBe(1);
  });

  it('FieldData interface is exported from writer.ts', () => {
    const fieldData: FieldData = {
      parentType: 'ecto_schema',
      parentName: 'User',
      fieldName: 'email',
      fieldType: 'string',
      nullable: false,
      sourceFile: 'lib/my_app/user.ex',
    };
    expect(fieldData.parentType).toBe('ecto_schema');
    expect(fieldData.nullable).toBe(false);
  });
});

describe('idempotent open', () => {
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

  it('opening same DB twice does not drop or error', () => {
    dbPath = tmpDbPath('idempotent');
    db = openDatabase(dbPath);

    // Insert some data
    db.prepare("INSERT INTO repos (name, path) VALUES ('idem-test', '/tmp/idem')").run();

    // Open a second connection to the same db
    const db2 = openDatabase(dbPath);
    const version = db2.pragma('user_version', { simple: true });
    expect(version).toBe(SCHEMA_VERSION);

    // Data should still be there
    const repo = db2.prepare("SELECT name FROM repos WHERE name = 'idem-test'").get() as { name: string } | undefined;
    expect(repo).toBeDefined();
    expect(repo!.name).toBe('idem-test');

    closeDatabase(db2);
  });
});

describe('fresh database', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath('fresh');
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

  it('has all 8 tables', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knowledge_fts%'"
    ).all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    expect(tableNames.sort()).toEqual([
      'edges', 'events', 'fields', 'files', 'learned_facts', 'modules', 'repos', 'services',
    ]);
  });

  it('has all 13 indexes', () => {
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'"
    ).all() as Array<{ name: string }>;

    expect(indexes.length).toBe(13);
  });

  it('version is current', () => {
    expect(getCurrentVersion(db)).toBe(SCHEMA_VERSION);
  });
});

describe('drop and rebuild', () => {
  let dbPath: string;

  afterEach(() => {
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('rebuilds on version mismatch, preserving learned facts', () => {
    dbPath = tmpDbPath('rebuild');

    // Step 1: Create a DB with current schema and populate it
    const db1 = openDatabase(dbPath);

    db1.prepare("INSERT INTO repos (name, path) VALUES ('test-repo', '/tmp/test')").run();
    const repo = db1.prepare("SELECT id FROM repos WHERE name = 'test-repo'").get() as { id: number };
    db1.prepare("INSERT INTO files (repo_id, path) VALUES (?, 'src/main.ts')").run(repo.id);
    db1.prepare("INSERT INTO modules (repo_id, name, type) VALUES (?, 'MyModule', 'context')").run(repo.id);
    db1.prepare("INSERT INTO services (repo_id, name) VALUES (?, 'my-service')").run(repo.id);
    db1.prepare("INSERT INTO events (repo_id, name) VALUES (?, 'UserCreated')").run(repo.id);
    db1.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type) VALUES ('service', 1, 'service', 2, 'calls_grpc')"
    ).run();
    db1.prepare(
      "INSERT INTO fields (repo_id, parent_type, parent_name, field_name, field_type, nullable) VALUES (?, 'ecto_schema', 'User', 'email', 'string', 0)"
    ).run(repo.id);

    // Insert learned facts
    db1.prepare("INSERT INTO learned_facts (content, repo, created_at) VALUES ('fact one', 'test-repo', '2025-01-01T00:00:00')").run();
    db1.prepare("INSERT INTO learned_facts (content, repo, created_at) VALUES ('fact two', NULL, '2025-02-01T00:00:00')").run();

    closeDatabase(db1);

    // Step 2: Simulate version mismatch by setting user_version to an old value
    const raw = new BetterSqlite3(dbPath);
    raw.pragma('user_version = 5');
    raw.close();

    // Step 3: Reopen with openDatabase -- triggers drop+rebuild
    const db2 = openDatabase(dbPath);

    // Schema version should be current
    expect(getCurrentVersion(db2)).toBe(SCHEMA_VERSION);

    // All tables should exist
    const tables = db2.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'knowledge_fts%'"
    ).all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name).sort();
    expect(tableNames).toEqual([
      'edges', 'events', 'fields', 'files', 'learned_facts', 'modules', 'repos', 'services',
    ]);

    // Indexed data should be gone (repos, files, etc.)
    const repos = db2.prepare('SELECT COUNT(*) as count FROM repos').get() as { count: number };
    expect(repos.count).toBe(0);

    const files = db2.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number };
    expect(files.count).toBe(0);

    const modules = db2.prepare('SELECT COUNT(*) as count FROM modules').get() as { count: number };
    expect(modules.count).toBe(0);

    const services = db2.prepare('SELECT COUNT(*) as count FROM services').get() as { count: number };
    expect(services.count).toBe(0);

    const events = db2.prepare('SELECT COUNT(*) as count FROM events').get() as { count: number };
    expect(events.count).toBe(0);

    const edges = db2.prepare('SELECT COUNT(*) as count FROM edges').get() as { count: number };
    expect(edges.count).toBe(0);

    const fields = db2.prepare('SELECT COUNT(*) as count FROM fields').get() as { count: number };
    expect(fields.count).toBe(0);

    // Learned facts should be preserved
    const facts = db2.prepare('SELECT content, repo, created_at FROM learned_facts ORDER BY content').all() as Array<{
      content: string;
      repo: string | null;
      created_at: string;
    }>;
    expect(facts.length).toBe(2);
    expect(facts[0].content).toBe('fact one');
    expect(facts[0].repo).toBe('test-repo');
    expect(facts[0].created_at).toBe('2025-01-01T00:00:00');
    expect(facts[1].content).toBe('fact two');
    expect(facts[1].repo).toBeNull();
    expect(facts[1].created_at).toBe('2025-02-01T00:00:00');

    // FTS table should exist
    const fts = db2.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_fts'"
    ).all() as Array<{ name: string }>;
    expect(fts.length).toBe(1);

    closeDatabase(db2);
  });

  it('learned facts with FTS entries are searchable after rebuild', () => {
    dbPath = tmpDbPath('rebuild-fts');

    // Create DB with a learned fact indexed in FTS
    const db1 = openDatabase(dbPath);
    db1.prepare("INSERT INTO learned_facts (content, repo, created_at) VALUES ('deployment requires VPN access', 'infra-repo', '2025-06-01T00:00:00')").run();
    const factRow = db1.prepare("SELECT id FROM learned_facts WHERE content = 'deployment requires VPN access'").get() as { id: number };

    // Index in FTS
    db1.prepare(
      "INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, 'learned_fact:learned_fact', ?)"
    ).run('deployment requires VPN access', 'deployment requires VPN access', factRow.id);

    closeDatabase(db1);

    // Simulate version mismatch
    const raw = new BetterSqlite3(dbPath);
    raw.pragma('user_version = 5');
    raw.close();

    // Reopen -- triggers rebuild
    const db2 = openDatabase(dbPath);

    // Fact should still be there
    const facts = db2.prepare("SELECT content FROM learned_facts").all() as Array<{ content: string }>;
    expect(facts.length).toBe(1);
    expect(facts[0].content).toBe('deployment requires VPN access');

    // Fact should be searchable in FTS (re-indexed during rebuild)
    const ftsResults = db2.prepare(
      "SELECT name, entity_type FROM knowledge_fts WHERE entity_type = 'learned_fact:learned_fact'"
    ).all() as Array<{ name: string; entity_type: string }>;
    expect(ftsResults.length).toBe(1);

    closeDatabase(db2);
  });

  it('matching version does not drop tables (no-op)', () => {
    dbPath = tmpDbPath('noop');

    const db1 = openDatabase(dbPath);
    db1.prepare("INSERT INTO repos (name, path) VALUES ('persist-repo', '/tmp/persist')").run();
    closeDatabase(db1);

    // Reopen -- version matches, should be no-op
    const db2 = openDatabase(dbPath);
    expect(getCurrentVersion(db2)).toBe(SCHEMA_VERSION);

    // Data should still be there
    const repo = db2.prepare("SELECT name FROM repos WHERE name = 'persist-repo'").get() as { name: string } | undefined;
    expect(repo).toBeDefined();
    expect(repo!.name).toBe('persist-repo');

    closeDatabase(db2);
  });
});
