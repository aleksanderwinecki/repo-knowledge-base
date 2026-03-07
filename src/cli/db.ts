/**
 * Database path resolution and lifecycle helper for CLI commands.
 */

import { openDatabase, closeDatabase } from '../db/database.js';
import { resolveDbPath } from '../db/path.js';
import type Database from 'better-sqlite3';

/**
 * Resolve the database file path.
 * Uses KB_DB_PATH env var if set, otherwise defaults to ~/.kb/knowledge.db.
 */
export function getDbPath(): string {
  return resolveDbPath();
}

/**
 * Open a database, run a function, then close the database.
 * Ensures the database is always closed, even on exceptions.
 */
export function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = openDatabase(getDbPath());
  try {
    return fn(db);
  } finally {
    closeDatabase(db);
  }
}

/**
 * Open a database, run an async function, then close the database.
 * Ensures the database is always closed, even on exceptions.
 */
export async function withDbAsync<T>(fn: (db: Database.Database) => Promise<T>): Promise<T> {
  const db = openDatabase(getDbPath());
  try {
    return await fn(db);
  } finally {
    closeDatabase(db);
  }
}
