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
export const COARSE_TYPES = new Set(['repo', 'file', 'module', 'service', 'event', 'learned_fact', 'field']);

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
      tokenize = 'unicode61',
      prefix = '2,3'
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

  // Hoist prepared statements outside transaction closure
  const deleteFts = db.prepare(
    'DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id = ?',
  );
  const insertFts = db.prepare(
    'INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)',
  );

  const upsert = db.transaction(() => {
    // Remove existing entry if any (use LIKE to match any sub-type under this parent)
    deleteFts.run(`${entity.type}:%`, entity.id);

    // Insert new entry with composite type
    insertFts.run(processedName, processedDescription, compositeType, entity.id);
  });

  upsert();
}

/**
 * Rebuild the entire FTS index from entity tables in a single bulk operation.
 * Far faster than per-entity indexEntity() calls because:
 * 1. automerge=0 disables segment merge work during inserts
 * 2. Single transaction = single segment created
 * 3. optimize at end merges once
 *
 * Handles: repos, modules, events, services, fields, learned_facts.
 */
export function rebuildAllFts(db: Database.Database): void {
  // Clear entire FTS table
  db.exec('DELETE FROM knowledge_fts');

  // Disable merge work during bulk insert
  db.exec("INSERT INTO knowledge_fts(knowledge_fts, rank) VALUES('automerge', 0)");

  const insertFts = db.prepare(
    'INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)',
  );

  const bulkInsert = db.transaction(() => {
    // Repos
    const repos = db.prepare('SELECT id, name, description FROM repos').all() as Array<{
      id: number; name: string; description: string | null;
    }>;
    for (const r of repos) {
      insertFts.run(
        tokenizeForFts(r.name),
        r.description ? tokenizeForFts(r.description) : null,
        'repo:repo',
        r.id,
      );
    }

    // Modules
    const modules = db.prepare(
      'SELECT m.id, m.name, m.type, m.summary, m.table_name, r.name as repo_name FROM modules m JOIN repos r ON m.repo_id = r.id',
    ).all() as Array<{
      id: number; name: string; type: string | null; summary: string | null;
      table_name: string | null; repo_name: string;
    }>;
    for (const m of modules) {
      const parts: string[] = [m.repo_name];
      if (m.summary) parts.push(m.summary);
      if (m.table_name) parts.push(`table:${m.table_name}`);
      const desc = parts.join(' ') || null;
      insertFts.run(
        tokenizeForFts(m.name),
        desc ? tokenizeForFts(desc) : null,
        `module:${m.type ?? 'module'}`,
        m.id,
      );
    }

    // Events
    const events = db.prepare(
      'SELECT e.id, e.name, e.schema_definition, r.name as repo_name FROM events e JOIN repos r ON e.repo_id = r.id',
    ).all() as Array<{
      id: number; name: string; schema_definition: string | null; repo_name: string;
    }>;
    for (const e of events) {
      const desc = e.schema_definition ? `${e.repo_name} ${e.schema_definition}` : e.repo_name;
      insertFts.run(
        tokenizeForFts(e.name),
        tokenizeForFts(desc),
        'event:event',
        e.id,
      );
    }

    // Services
    const services = db.prepare(
      'SELECT s.id, s.name, s.description, s.service_type, r.name as repo_name FROM services s JOIN repos r ON s.repo_id = r.id',
    ).all() as Array<{
      id: number; name: string; description: string | null;
      service_type: string | null; repo_name: string;
    }>;
    for (const s of services) {
      const desc = s.description ? `${s.repo_name} ${s.description}` : s.repo_name;
      insertFts.run(
        tokenizeForFts(s.name),
        desc ? tokenizeForFts(desc) : null,
        `service:${s.service_type ?? 'service'}`,
        s.id,
      );
    }

    // Fields
    const fields = db.prepare(
      'SELECT f.id, f.field_name, f.parent_type, f.parent_name, f.field_type, r.name as repo_name FROM fields f JOIN repos r ON f.repo_id = r.id',
    ).all() as Array<{
      id: number; field_name: string; parent_type: string;
      parent_name: string; field_type: string; repo_name: string;
    }>;
    for (const f of fields) {
      const parts = [f.repo_name, f.parent_name, f.field_type];
      if (f.parent_type === 'proto_message') {
        parts.push(`event:${f.parent_name}`);
      }
      insertFts.run(
        tokenizeForFts(f.field_name),
        tokenizeForFts(parts.join(' ')),
        `field:${f.parent_type}`,
        f.id,
      );
    }

    // Learned facts
    const facts = db.prepare(
      'SELECT id, content, repo FROM learned_facts',
    ).all() as Array<{
      id: number; content: string; repo: string | null;
    }>;
    for (const fact of facts) {
      insertFts.run(
        tokenizeForFts(fact.content),
        fact.repo ? tokenizeForFts(fact.repo) : null,
        'learned_fact:learned_fact',
        fact.id,
      );
    }
  });

  bulkInsert();

  // Consolidate all segments into one
  db.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize')");
  // Restore normal automerge for incremental updates
  db.exec("INSERT INTO knowledge_fts(knowledge_fts, rank) VALUES('automerge', 4)");
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
  const deleteFts = db.prepare(
    'DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id = ?',
  );
  deleteFts.run(`${entityType}:%`, entityId);
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
 * Execute an FTS5 query with automatic fallback for syntax errors.
 * On FTS5 MATCH failure (e.g., unbalanced quotes, invalid operators),
 * retries with the query wrapped as a phrase match.
 * Returns empty array if both attempts fail.
 */
export function executeFtsWithFallback<T>(
  db: Database.Database,
  sql: string,
  processedQuery: string,
  buildParams: (query: string) => (string | number)[],
): T[] {
  try {
    return db.prepare(sql).all(...buildParams(processedQuery)) as T[];
  } catch {
    // FTS syntax error -- retry as phrase match below
    try {
      const phraseQuery = `"${processedQuery.replace(/"/g, '')}"`;
      return db.prepare(sql).all(...buildParams(phraseQuery)) as T[];
    } catch {
      // Phrase match also failed -- return empty results
      return [];
    }
  }
}

/** Minimum result count before triggering progressive relaxation */
export const MIN_RELAXATION_RESULTS = 3;

/** Raw FTS match row returned by query execution */
export interface FtsMatch {
  entity_type: string;
  entity_id: number;
  name: string;
  description: string | null;
  relevance: number;
}

/**
 * Build an OR query from raw multi-term input.
 * Tokenizes each term individually through tokenizeForFts, then joins with FTS5 OR operator.
 * CRITICAL: OR operator is never passed through tokenizeForFts (would become lowercase "or").
 */
export function buildOrQuery(rawQuery: string): string {
  const terms = rawQuery.trim().split(/\s+/)
    .map(term => tokenizeForFts(term))
    .filter(Boolean);
  if (terms.length <= 1) return terms[0] ?? '';
  return terms.join(' OR ');
}

/**
 * Build a prefix OR query from raw multi-term input.
 * Same as buildOrQuery but appends * wildcard to each tokenized term.
 */
export function buildPrefixOrQuery(rawQuery: string): string {
  const terms = rawQuery.trim().split(/\s+/)
    .map(term => tokenizeForFts(term))
    .filter(Boolean);
  if (terms.length === 0) return '';
  if (terms.length === 1) return `${terms[0]}*`;
  return terms.map(t => `${t}*`).join(' OR ');
}

/**
 * Execute a single FTS query with optional entity type filter.
 * Internal helper for searchWithRelaxation.
 */
function runFtsQuery(
  db: Database.Database,
  processedQuery: string,
  limit: number,
  entityTypeFilter?: string,
): FtsMatch[] {
  let typeFilterSql = '';
  let typeFilterParam: string | undefined;
  if (entityTypeFilter) {
    const resolved = resolveTypeFilter(entityTypeFilter);
    typeFilterSql = ` AND ${resolved.sql}`;
    typeFilterParam = resolved.param;
  }

  const sql = `
    SELECT entity_type, entity_id, name, description, rank as relevance
    FROM knowledge_fts
    WHERE knowledge_fts MATCH ?${typeFilterSql}
    ORDER BY rank
    LIMIT ?
  `;

  const buildParams = (query: string): (string | number)[] => {
    const p: (string | number)[] = [query];
    if (typeFilterParam) p.push(typeFilterParam);
    p.push(limit);
    return p;
  };

  return executeFtsWithFallback<FtsMatch>(db, sql, processedQuery, buildParams);
}

/**
 * Search with progressive relaxation: AND -> OR -> prefix OR.
 * For single-term queries, runs a single FTS query.
 * For multi-term queries, starts with implicit AND (tightest).
 * If AND returns fewer than MIN_RELAXATION_RESULTS, retries with OR.
 * If OR also insufficient, retries with prefix OR.
 * entityTypeFilter is preserved across ALL relaxation steps.
 */
export function searchWithRelaxation(
  db: Database.Database,
  rawQuery: string,
  limit: number,
  entityTypeFilter?: string,
): FtsMatch[] {
  const terms = rawQuery.trim().split(/\s+/)
    .map(t => tokenizeForFts(t))
    .filter(Boolean);

  if (terms.length === 0) return [];

  if (terms.length === 1) {
    return runFtsQuery(db, terms[0]!, limit, entityTypeFilter);
  }

  // Step 1: AND (implicit — FTS5 default)
  const andQuery = terms.join(' ');
  const andResults = runFtsQuery(db, andQuery, limit, entityTypeFilter);
  if (andResults.length >= MIN_RELAXATION_RESULTS) return andResults;

  // Step 2: OR
  const orQuery = terms.join(' OR ');
  const orResults = runFtsQuery(db, orQuery, limit, entityTypeFilter);
  if (orResults.length >= MIN_RELAXATION_RESULTS) return orResults;

  // Step 3: Prefix OR
  const prefixOrQuery = terms.map(t => `${t}*`).join(' OR ');
  return runFtsQuery(db, prefixOrQuery, limit, entityTypeFilter);
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
