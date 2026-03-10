import type Database from 'better-sqlite3';
import { getCurrentVersion, setVersion } from './migrations.js';
import { initializeFts, indexEntity } from './fts.js';

/** Current schema version — bump to trigger drop+rebuild on existing DBs */
export const SCHEMA_VERSION = 10;

/**
 * Create all tables and indexes from scratch.
 * Called on fresh DB or after dropping all tables during rebuild.
 */
export function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      description TEXT,
      last_indexed_commit TEXT,
      default_branch TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      language TEXT,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo_id, path)
    );

    CREATE TABLE modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      type TEXT,
      summary TEXT,
      table_name TEXT,
      schema_fields TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      service_type TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo_id, name)
    );

    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      schema_definition TEXT,
      source_file TEXT,
      file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      domain TEXT,
      owner_team TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL,
      source_file TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE learned_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      repo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      parent_type TEXT NOT NULL,
      parent_name TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_type TEXT NOT NULL,
      nullable INTEGER NOT NULL DEFAULT 1,
      source_file TEXT,
      module_id INTEGER REFERENCES modules(id) ON DELETE SET NULL,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX idx_edges_source ON edges(source_type, source_id);
    CREATE INDEX idx_edges_target ON edges(target_type, target_id);
    CREATE INDEX idx_edges_relationship ON edges(relationship_type);
    CREATE INDEX idx_modules_name ON modules(name);
    CREATE INDEX idx_events_name ON events(name);
    CREATE INDEX idx_services_name ON services(name);
    CREATE INDEX idx_modules_repo_file ON modules(repo_id, file_id);
    CREATE INDEX idx_events_repo_file ON events(repo_id, file_id);
    CREATE INDEX idx_fields_repo ON fields(repo_id);
    CREATE INDEX idx_fields_name ON fields(field_name);
    CREATE INDEX idx_fields_parent ON fields(parent_type, parent_name);
    CREATE INDEX idx_fields_module ON fields(module_id);
    CREATE INDEX idx_fields_event ON fields(event_id);
  `);
}

interface SavedFact {
  id: number;
  content: string;
  repo: string | null;
  created_at: string;
}

/**
 * Initialize the database schema.
 * - Fresh DB (version 0): create schema from scratch.
 * - Matching version: no-op (just ensure FTS exists).
 * - Mismatched version: drop all tables, rebuild, preserve learned facts.
 */
export function initializeSchema(db: Database.Database): void {
  const currentVersion = getCurrentVersion(db);

  if (currentVersion === SCHEMA_VERSION) {
    // Idempotent path — schema is current
    initializeFts(db);
    return;
  }

  if (currentVersion === 0) {
    // Fresh database — create everything
    createSchema(db);
    setVersion(db, SCHEMA_VERSION);
    initializeFts(db);
    return;
  }

  // Version mismatch — drop and rebuild, preserving learned facts
  const rebuild = db.transaction(() => {
    // 1. Export learned facts (table may not exist in very old DBs)
    let savedFacts: SavedFact[] = [];
    try {
      savedFacts = db.prepare(
        'SELECT id, content, repo, created_at FROM learned_facts'
      ).all() as SavedFact[];
    } catch {
      // Table doesn't exist — nothing to preserve
    }

    // 2. Get all user tables (including FTS virtual tables)
    const allTables = db.prepare(
      "SELECT name, type FROM sqlite_master WHERE (type='table' OR type='view') AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ name: string; type: string }>;
    const tableNames = allTables.map((t) => t.name);

    // 3. Disable foreign keys for clean drop
    db.pragma('foreign_keys = OFF');

    // 4. Drop FTS virtual tables first (this also drops shadow tables)
    for (const name of tableNames) {
      if (name === 'knowledge_fts') {
        db.exec(`DROP TABLE IF EXISTS "${name}"`);
      }
    }

    // 5. Drop all remaining tables
    // Re-read table list since dropping FTS may have removed shadow tables
    const remainingTables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).all() as Array<{ name: string }>;
    for (const { name } of remainingTables) {
      db.exec(`DROP TABLE IF EXISTS "${name}"`);
    }

    // 6. Re-enable foreign keys
    db.pragma('foreign_keys = ON');

    // 7. Rebuild schema
    createSchema(db);

    // 8. Set version
    setVersion(db, SCHEMA_VERSION);

    // 9. Initialize FTS
    initializeFts(db);

    // 10. Re-import learned facts
    if (savedFacts.length > 0) {
      const insertFact = db.prepare(
        'INSERT INTO learned_facts (content, repo, created_at) VALUES (?, ?, ?)'
      );
      for (const fact of savedFacts) {
        const result = insertFact.run(fact.content, fact.repo, fact.created_at);
        // Re-index fact in FTS
        indexEntity(db, {
          type: 'learned_fact',
          id: result.lastInsertRowid as number,
          name: fact.content,
          description: fact.content,
          subType: 'learned_fact',
        });
      }
    }
  });

  rebuild();
}
