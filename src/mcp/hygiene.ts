/**
 * Data hygiene: detect deleted repos, prune orphaned data, flag stale facts.
 * Learned facts are flagged for review, never auto-deleted.
 */

import type Database from 'better-sqlite3';
import fs from 'fs';
import { clearRepoEntities } from '../indexer/writer.js';
import type { LearnedFact } from '../knowledge/types.js';

const DEFAULT_MAX_AGE_DAYS = 90;

/**
 * Detect repos whose disk path no longer exists.
 * Returns the names of deleted repos.
 */
export function detectDeletedRepos(db: Database.Database): string[] {
  const repos = db
    .prepare('SELECT name, path FROM repos')
    .all() as Array<{ name: string; path: string }>;

  return repos
    .filter((repo) => !fs.existsSync(repo.path))
    .map((repo) => repo.name);
}

/**
 * Remove deleted repos and all their related entities from the database.
 * Uses the existing clearRepoEntities to handle modules, events, files, services, edges, and FTS.
 * Idempotent: calling with a repo name that doesn't exist in the DB is a no-op.
 */
export function pruneDeletedRepos(
  db: Database.Database,
  repoNames: string[],
): void {
  const getRepo = db.prepare('SELECT id FROM repos WHERE name = ?');
  const deleteRepo = db.prepare('DELETE FROM repos WHERE id = ?');

  const prune = db.transaction(() => {
    for (const name of repoNames) {
      const row = getRepo.get(name) as { id: number } | undefined;
      if (!row) continue;

      // Clear all related entities (modules, events, files, services, edges, FTS)
      clearRepoEntities(db, row.id);

      // Remove the repo record itself
      deleteRepo.run(row.id);
    }
  });

  prune();
}

/**
 * Flag learned facts older than maxAgeDays for review.
 * Returns the stale facts WITHOUT deleting them.
 */
export function flagStaleFacts(
  db: Database.Database,
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
): LearnedFact[] {
  const rows = db
    .prepare(
      "SELECT id, content, repo, created_at FROM learned_facts WHERE created_at < datetime('now', '-' || ? || ' days')",
    )
    .all(maxAgeDays) as Array<{
    id: number;
    content: string;
    repo: string | null;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    repo: r.repo,
    createdAt: r.created_at,
  }));
}
