import * as sqliteVec from 'sqlite-vec';
import type Database from 'better-sqlite3';

let vecAvailable = false;

/**
 * Attempt to load the sqlite-vec extension into the database.
 * Returns true on success, false if sqlite-vec is not available.
 * Sets a module-level flag readable via isVecAvailable().
 */
export function loadVecExtension(db: Database.Database): boolean {
  try {
    sqliteVec.load(db);
    vecAvailable = true;
    return true;
  } catch {
    // sqlite-vec not available on this platform
    vecAvailable = false;
    return false;
  }
}

/**
 * Check whether sqlite-vec was loaded successfully.
 * Only valid after loadVecExtension() has been called.
 */
export function isVecAvailable(): boolean {
  return vecAvailable;
}
