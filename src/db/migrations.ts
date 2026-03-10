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
