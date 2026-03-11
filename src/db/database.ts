import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { initializeSchema } from './schema.js';

/**
 * Open (or create) a SQLite database at the given path.
 * Enables WAL mode, foreign keys, and initializes the schema.
 */
export function openDatabase(dbPath: string): Database.Database {
  // Ensure parent directory exists
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);

  // Performance and safety pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  // Performance tuning pragmas
  db.pragma('cache_size = -64000');
  db.pragma('temp_store = MEMORY');
  db.pragma('mmap_size = 268435456');

  // Initialize schema (runs migrations if needed)
  initializeSchema(db);

  return db;
}

/**
 * Enable bulk-write pragmas for heavy indexing operations.
 * Disables WAL auto-checkpoint to avoid stalls mid-bulk-insert.
 * Call restoreNormalPragmas() after bulk operations complete.
 */
export function enableBulkWritePragmas(db: Database.Database): void {
  db.pragma('wal_autocheckpoint = 0');
}

/**
 * Restore normal pragmas after bulk-write operations.
 * Re-enables WAL auto-checkpoint and forces a truncating checkpoint.
 */
export function restoreNormalPragmas(db: Database.Database): void {
  db.pragma('wal_autocheckpoint = 1000');
  db.pragma('wal_checkpoint(TRUNCATE)');
}

/**
 * Close the database connection.
 */
export function closeDatabase(db: Database.Database): void {
  if (db.open) {
    db.close();
  }
}

/**
 * Register process exit handlers to ensure the database is closed cleanly.
 */
export function registerShutdownHandlers(db: Database.Database): void {
  const shutdown = () => {
    closeDatabase(db);
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('exit', () => closeDatabase(db));
}
