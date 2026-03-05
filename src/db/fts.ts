import type Database from 'better-sqlite3';
import type { EntityType } from '../types/entities.js';
import { tokenizeForFts } from './tokenizer.js';

/** Search result returned by the search function */
export interface SearchResult {
  entityType: EntityType;
  entityId: number;
  name: string;
  description: string | null;
  relevance: number;
}

/**
 * Create the FTS5 virtual table for full-text search.
 * Called during schema initialization.
 */
export function initializeFts(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      name,
      description,
      entity_type,
      entity_id UNINDEXED,
      tokenize = 'unicode61'
    );
  `);
}

/**
 * Index an entity in the FTS table.
 * Preprocesses name and description through tokenizeForFts before insertion.
 * Uses delete-then-insert to handle upserts.
 */
export function indexEntity(
  db: Database.Database,
  entity: {
    type: EntityType;
    id: number;
    name: string;
    description?: string | null;
  },
): void {
  const processedName = tokenizeForFts(entity.name);
  const processedDescription = entity.description
    ? tokenizeForFts(entity.description)
    : null;

  const upsert = db.transaction(() => {
    // Remove existing entry if any
    db.prepare(
      'DELETE FROM knowledge_fts WHERE entity_type = ? AND entity_id = ?',
    ).run(entity.type, entity.id);

    // Insert new entry
    db.prepare(
      'INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)',
    ).run(processedName, processedDescription, entity.type, entity.id);
  });

  upsert();
}

/**
 * Remove an entity from the FTS index.
 */
export function removeEntity(
  db: Database.Database,
  entityType: EntityType,
  entityId: number,
): void {
  db.prepare(
    'DELETE FROM knowledge_fts WHERE entity_type = ? AND entity_id = ?',
  ).run(entityType, entityId);
}

/**
 * Search the FTS index.
 * Preprocesses the query through tokenizeForFts to match the indexed tokenization.
 * Returns results ranked by relevance (BM25).
 */
export function search(
  db: Database.Database,
  query: string,
  limit = 20,
): SearchResult[] {
  if (!query || !query.trim()) {
    return [];
  }

  const processedQuery = tokenizeForFts(query);
  if (!processedQuery) {
    return [];
  }

  const stmt = db.prepare(`
    SELECT entity_type, entity_id, name, description, rank as relevance
    FROM knowledge_fts
    WHERE knowledge_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `);

  const rows = stmt.all(processedQuery, limit) as Array<{
    entity_type: string;
    entity_id: number;
    name: string;
    description: string | null;
    relevance: number;
  }>;

  return rows.map((row) => ({
    entityType: row.entity_type as EntityType,
    entityId: row.entity_id,
    name: row.name,
    description: row.description,
    relevance: row.relevance,
  }));
}
