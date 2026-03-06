import type Database from 'better-sqlite3';

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
