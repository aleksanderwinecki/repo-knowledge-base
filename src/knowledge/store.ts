/**
 * CRUD operations for learned facts.
 * Facts are stored in the learned_facts table and indexed in FTS for searchability.
 */

import type Database from 'better-sqlite3';
import type { LearnedFact } from './types.js';
import { indexEntity, removeEntity } from '../db/fts.js';

/**
 * Store a new learned fact in the knowledge base.
 * Also indexes the fact in FTS so it appears in search results (KNOW-02).
 */
export function learnFact(
  db: Database.Database,
  content: string,
  repo?: string,
): LearnedFact {
  const stmt = db.prepare(
    'INSERT INTO learned_facts (content, repo) VALUES (?, ?)',
  );
  const result = stmt.run(content, repo ?? null);
  const id = Number(result.lastInsertRowid);

  // Index in FTS for searchability via the standard path
  indexEntity(db, {
    type: 'learned_fact',
    id,
    name: content,
    description: content,
  });

  // Read back the created_at from DB for accurate timestamp
  const row = db
    .prepare('SELECT created_at FROM learned_facts WHERE id = ?')
    .get(id) as { created_at: string };

  return {
    id,
    content,
    repo: repo ?? null,
    createdAt: row.created_at,
  };
}

/**
 * List all learned facts, optionally filtered by repo.
 */
export function listFacts(
  db: Database.Database,
  repo?: string,
): LearnedFact[] {
  const sql = repo
    ? 'SELECT id, content, repo, created_at FROM learned_facts WHERE repo = ? ORDER BY created_at DESC, id DESC'
    : 'SELECT id, content, repo, created_at FROM learned_facts ORDER BY created_at DESC, id DESC';
  const params = repo ? [repo] : [];
  const rows = db.prepare(sql).all(...params) as Array<{
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

/**
 * Delete a learned fact by ID.
 * Also removes from FTS index.
 * Returns true if the fact was found and deleted, false if not found.
 */
export function forgetFact(db: Database.Database, id: number): boolean {
  const forget = db.transaction(() => {
    // Remove from FTS first via the standard path
    removeEntity(db, 'learned_fact', id);
    // Remove from table
    const result = db
      .prepare('DELETE FROM learned_facts WHERE id = ?')
      .run(id);
    return result.changes > 0;
  });

  return forget();
}
