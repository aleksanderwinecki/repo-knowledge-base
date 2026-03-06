/**
 * Auto-sync: detects stale repos and re-indexes them.
 * Caps re-indexing at MAX_SYNC_PER_QUERY to avoid timeouts during MCP queries.
 */

import type Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { getCurrentCommit } from '../indexer/git.js';
import { indexSingleRepo } from '../indexer/pipeline.js';

const MAX_SYNC_PER_QUERY = 3;

export interface SyncResult {
  /** Repos that were successfully re-indexed */
  synced: string[];
  /** Stale repos that were skipped due to the per-query cap */
  skipped: string[];
}

/**
 * Check a list of repos for staleness and re-index up to MAX_SYNC_PER_QUERY.
 *
 * A repo is stale when its HEAD SHA differs from the stored last_indexed_commit.
 * Repos whose path no longer exists on disk or aren't in the DB are silently skipped.
 */
export function checkAndSyncRepos(
  db: Database.Database,
  repoNames: string[],
): SyncResult {
  const staleRepos: Array<{ name: string; repoPath: string }> = [];

  const getRepo = db.prepare(
    'SELECT name, path, last_indexed_commit FROM repos WHERE name = ?',
  );

  for (const name of repoNames) {
    const row = getRepo.get(name) as
      | { name: string; path: string; last_indexed_commit: string | null }
      | undefined;

    // Skip repos not in database
    if (!row) continue;

    // Skip repos whose path no longer exists
    if (!fs.existsSync(row.path)) continue;

    // Get current HEAD commit
    const currentCommit = getCurrentCommit(row.path);
    if (!currentCommit) continue;

    // Skip if commit hasn't changed
    if (row.last_indexed_commit === currentCommit) continue;

    staleRepos.push({ name: row.name, repoPath: row.path });
  }

  const toSync = staleRepos.slice(0, MAX_SYNC_PER_QUERY);
  const toSkip = staleRepos.slice(MAX_SYNC_PER_QUERY);

  for (const repo of toSync) {
    indexSingleRepo(db, repo.repoPath, {
      force: false,
      rootDir: path.dirname(repo.repoPath),
    });
  }

  return {
    synced: toSync.map((r) => r.name),
    skipped: toSkip.map((r) => r.name),
  };
}
