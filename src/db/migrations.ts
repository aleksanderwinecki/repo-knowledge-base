import type Database from 'better-sqlite3';
import { isVecAvailable } from './vec.js';

/**
 * Get the current schema version from the database.
 */
export function getCurrentVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/**
 * Set the schema version in the database.
 */
export function setVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

/**
 * Run all pending migrations from `fromVersion` to `toVersion`.
 * Wrapped in a transaction for atomicity.
 */
export function runMigrations(
  db: Database.Database,
  fromVersion: number,
  toVersion: number,
): void {
  const migrate = db.transaction(() => {
    if (fromVersion < 1 && toVersion >= 1) {
      migrateToV1(db);
    }
    if (fromVersion < 2 && toVersion >= 2) {
      migrateToV2(db);
    }
    if (fromVersion < 3 && toVersion >= 3) {
      migrateToV3(db);
    }
    if (fromVersion < 4 && toVersion >= 4) {
      migrateToV4(db);
    }
    if (fromVersion < 5 && toVersion >= 5) {
      migrateToV5(db);
    }
    if (fromVersion < 6 && toVersion >= 6) {
      migrateToV6(db);
    }
    if (fromVersion < 7 && toVersion >= 7) {
      migrateToV7(db);
    }
    if (fromVersion < 8 && toVersion >= 8) {
      migrateToV8(db);
    }
  });

  migrate();
}

/**
 * V1: Create all initial tables and indexes.
 */
function migrateToV1(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      description TEXT,
      last_indexed_commit TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      language TEXT,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo_id, path)
    );

    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      file_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      type TEXT,
      summary TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(repo_id, name)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      schema_definition TEXT,
      source_file TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      source_id INTEGER NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      relationship_type TEXT NOT NULL,
      source_file TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_type, source_id);
    CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_edges_relationship ON edges(relationship_type);
  `);
}

/**
 * V2: Add learned_facts table for manual knowledge injection.
 */
function migrateToV2(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS learned_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      repo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * V3: Add branch-aware and enriched metadata columns.
 * - repos.default_branch: resolved default branch (main/master/null)
 * - modules.table_name, modules.schema_fields: Ecto schema metadata
 * - services.service_type: service classification (grpc, http, etc.)
 * - events.domain, events.owner_team: event catalog metadata
 */
function migrateToV3(db: Database.Database): void {
  db.exec(`
    ALTER TABLE repos ADD COLUMN default_branch TEXT;
    ALTER TABLE modules ADD COLUMN table_name TEXT;
    ALTER TABLE modules ADD COLUMN schema_fields TEXT;
    ALTER TABLE services ADD COLUMN service_type TEXT;
    ALTER TABLE events ADD COLUMN domain TEXT;
    ALTER TABLE events ADD COLUMN owner_team TEXT;
  `);
}

/**
 * V4: Add file_id FK to events table for surgical file-level cleanup.
 * Existing events get NULL file_id (backfilled on next re-index).
 */
function migrateToV4(db: Database.Database): void {
  db.exec(`
    ALTER TABLE events ADD COLUMN file_id INTEGER REFERENCES files(id) ON DELETE SET NULL;
  `);
}

/**
 * V5: Add B-tree indexes on name columns and compound indexes for repo+file lookups.
 * Rebuild FTS5 virtual table with prefix='2,3' for faster prefix searches.
 */
function migrateToV5(db: Database.Database): void {
  // Add B-tree indexes for name lookups and repo+file compound lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_modules_name ON modules(name);
    CREATE INDEX IF NOT EXISTS idx_events_name ON events(name);
    CREATE INDEX IF NOT EXISTS idx_services_name ON services(name);
    CREATE INDEX IF NOT EXISTS idx_modules_repo_file ON modules(repo_id, file_id);
    CREATE INDEX IF NOT EXISTS idx_events_repo_file ON events(repo_id, file_id);
  `);

  // Check if knowledge_fts exists before attempting to save rows
  const ftsExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='knowledge_fts'"
  ).get();

  let ftsRows: Array<{ name: string; description: string | null; entity_type: string; entity_id: number }> = [];
  if (ftsExists) {
    // Save all existing FTS rows before rebuilding
    ftsRows = db.prepare(
      'SELECT name, description, entity_type, entity_id FROM knowledge_fts'
    ).all() as typeof ftsRows;
    db.exec('DROP TABLE IF EXISTS knowledge_fts');
  }

  // Create FTS5 table with prefix config
  db.exec(`
    CREATE VIRTUAL TABLE knowledge_fts USING fts5(
      name,
      description,
      entity_type UNINDEXED,
      entity_id UNINDEXED,
      tokenize = 'unicode61',
      prefix = '2,3'
    );
  `);

  // Re-insert saved rows
  if (ftsRows.length > 0) {
    const insert = db.prepare(
      'INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)'
    );
    for (const row of ftsRows) {
      insert.run(row.name, row.description, row.entity_type, row.entity_id);
    }
  }
}

/**
 * V6: Normalize bare 'learned_fact' FTS entries to composite 'learned_fact:learned_fact'.
 * indexEntity/removeEntity use LIKE 'type:%' patterns that won't match bare types.
 */
function migrateToV6(db: Database.Database): void {
  const rows = db.prepare(
    "SELECT rowid, name, description, entity_id FROM knowledge_fts WHERE entity_type = 'learned_fact'"
  ).all() as Array<{ rowid: number; name: string; description: string | null; entity_id: number }>;

  if (rows.length > 0) {
    const deleteStmt = db.prepare(
      "DELETE FROM knowledge_fts WHERE entity_type = 'learned_fact' AND entity_id = ?"
    );
    const insertStmt = db.prepare(
      "INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, 'learned_fact:learned_fact', ?)"
    );
    for (const row of rows) {
      deleteStmt.run(row.entity_id);
      insertStmt.run(row.name, row.description, row.entity_id);
    }
  }
}

/**
 * V7: Add metadata JSON column to edges table for topology context.
 * Stores mechanism-specific metadata (stub name, topic, URL, confidence).
 */
function migrateToV7(db: Database.Database): void {
  db.exec(`
    ALTER TABLE edges ADD COLUMN metadata TEXT;
  `);
}

/**
 * V8: Create vec0 virtual table for entity embeddings (vector storage + KNN).
 * Only created when sqlite-vec extension is available; skipped otherwise.
 */
function migrateToV8(db: Database.Database): void {
  if (!isVecAvailable()) return;

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS entity_embeddings USING vec0(
      embedding float[256],
      entity_type text,
      entity_id text
    );
  `);
}
