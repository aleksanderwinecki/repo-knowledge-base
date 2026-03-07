import type Database from 'better-sqlite3';
import { getCurrentVersion, setVersion, runMigrations } from './migrations.js';
import { initializeFts } from './fts.js';

/** Current schema version — increment when adding migrations */
export const SCHEMA_VERSION = 6;

/**
 * Initialize the database schema.
 * Checks current version and runs any pending migrations.
 */
export function initializeSchema(db: Database.Database): void {
  const currentVersion = getCurrentVersion(db);

  if (currentVersion < SCHEMA_VERSION) {
    runMigrations(db, currentVersion, SCHEMA_VERSION);
    setVersion(db, SCHEMA_VERSION);
  }

  // Initialize FTS5 virtual table (idempotent)
  initializeFts(db);
}
