/**
 * Shared database path resolution.
 * Single source of truth for the default KB database location.
 */

import os from 'os';
import path from 'path';

/**
 * Resolve the database file path.
 * Uses KB_DB_PATH env var if set, otherwise defaults to ~/.kb/knowledge.db.
 */
export function resolveDbPath(): string {
  return (
    process.env.KB_DB_PATH ??
    path.join(os.homedir(), '.kb', 'knowledge.db')
  );
}
