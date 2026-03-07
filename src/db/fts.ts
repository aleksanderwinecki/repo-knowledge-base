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

/** Coarse (parent) entity types that map to DB tables */
export const COARSE_TYPES = new Set(['repo', 'file', 'module', 'service', 'event', 'learned_fact']);

/**
 * Create the FTS5 virtual table for full-text search.
 * Called during schema initialization.
 * entity_type is UNINDEXED to prevent type strings from polluting MATCH results.
 */
export function initializeFts(db: Database.Database): void {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      name,
      description,
      entity_type UNINDEXED,
      entity_id UNINDEXED,
      tokenize = 'unicode61'
    );
  `);
}

/**
 * Index an entity in the FTS table.
 * Preprocesses name and description through tokenizeForFts before insertion.
 * Uses delete-then-insert to handle upserts.
 * Stores entity_type in parent:subtype composite format (e.g., 'module:schema').
 */
export function indexEntity(
  db: Database.Database,
  entity: {
    type: EntityType;
    id: number;
    name: string;
    description?: string | null;
    subType?: string;
  },
): void {
  const processedName = tokenizeForFts(entity.name);
  const processedDescription = entity.description
    ? tokenizeForFts(entity.description)
    : null;

  const compositeType = entity.subType
    ? `${entity.type}:${entity.subType}`
    : `${entity.type}:${entity.type}`;

  const upsert = db.transaction(() => {
    // Remove existing entry if any (use LIKE to match any sub-type under this parent)
    db.prepare(
      'DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id = ?',
    ).run(`${entity.type}:%`, entity.id);

    // Insert new entry with composite type
    db.prepare(
      'INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)',
    ).run(processedName, processedDescription, compositeType, entity.id);
  });

  upsert();
}

/**
 * Remove an entity from the FTS index.
 * Uses LIKE pattern to match any sub-type under the parent type.
 */
export function removeEntity(
  db: Database.Database,
  entityType: EntityType,
  entityId: number,
): void {
  db.prepare(
    'DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id = ?',
  ).run(`${entityType}:%`, entityId);
}

/**
 * Resolve a type filter value to a SQL clause and parameter.
 * Coarse types (e.g., 'module') match all sub-types: entity_type LIKE 'module:%'
 * Granular types (e.g., 'schema') match specific sub-type: entity_type LIKE '%:schema'
 */
export function resolveTypeFilter(typeValue: string): { sql: string; param: string } {
  if (COARSE_TYPES.has(typeValue)) {
    return { sql: 'entity_type LIKE ?', param: `${typeValue}:%` };
  }
  return { sql: 'entity_type LIKE ?', param: `%:${typeValue}` };
}

/**
 * Parse a composite entity_type string into parent and sub-type.
 * e.g., 'module:schema' -> { entityType: 'module', subType: 'schema' }
 * Legacy format without colon: 'module' -> { entityType: 'module', subType: 'module' }
 */
export function parseCompositeType(compositeType: string): { entityType: EntityType; subType: string } {
  const colonIdx = compositeType.indexOf(':');
  if (colonIdx === -1) {
    return { entityType: compositeType as EntityType, subType: compositeType };
  }
  return {
    entityType: compositeType.substring(0, colonIdx) as EntityType,
    subType: compositeType.substring(colonIdx + 1),
  };
}

/**
 * List available entity types with sub-type counts from the FTS table.
 * Returns grouped structure: { module: [{ subType: 'schema', count: 2 }, ...], ... }
 */
export function listAvailableTypes(db: Database.Database): Record<string, { subType: string; count: number }[]> {
  const rows = db.prepare(`
    SELECT entity_type, COUNT(*) as count
    FROM knowledge_fts
    GROUP BY entity_type
    ORDER BY entity_type
  `).all() as Array<{ entity_type: string; count: number }>;

  const grouped: Record<string, { subType: string; count: number }[]> = {};
  for (const row of rows) {
    const { entityType, subType } = parseCompositeType(row.entity_type);
    if (!grouped[entityType]) grouped[entityType] = [];
    grouped[entityType].push({ subType, count: row.count });
  }
  return grouped;
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
