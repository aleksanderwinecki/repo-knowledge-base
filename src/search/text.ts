import type Database from 'better-sqlite3';
import type { EntityType } from '../types/entities.js';
import type { TextSearchResult, TextSearchOptions } from './types.js';
import { tokenizeForFts } from '../db/tokenizer.js';
import { resolveTypeFilter, parseCompositeType } from '../db/fts.js';

/**
 * Full-text search across all indexed content with contextual metadata.
 * Uses FTS5 MATCH for search, then hydrates results with repo/file context.
 *
 * Accepts FTS5 match syntax (AND, OR, NOT, phrase matching).
 * Invalid syntax falls back to phrase matching.
 */
export function searchText(
  db: Database.Database,
  query: string,
  options: TextSearchOptions = {},
): TextSearchResult[] {
  const { limit = 20, repoFilter, entityTypeFilter } = options;

  if (!query || !query.trim()) {
    return [];
  }

  // Try FTS match, falling back on syntax errors
  const ftsResults = executeFtsQuery(db, query, limit, entityTypeFilter);
  if (ftsResults === null) {
    return [];
  }

  // Hydrate each result with contextual metadata
  const hydrated: TextSearchResult[] = [];

  for (const match of ftsResults) {
    const result = hydrateResult(db, match);
    if (!result) continue;

    // Apply repo filter after hydration
    if (repoFilter && result.repoName !== repoFilter) continue;

    hydrated.push(result);
  }

  return hydrated;
}

interface FtsMatch {
  entity_type: string;
  entity_id: number;
  name: string;
  description: string | null;
  relevance: number;
}

/**
 * Execute FTS5 query with fallback for syntax errors.
 * Returns null if query produces no results even after fallback.
 */
function executeFtsQuery(
  db: Database.Database,
  query: string,
  limit: number,
  entityTypeFilter?: string,
): FtsMatch[] | null {
  const processedQuery = tokenizeForFts(query);
  if (!processedQuery) return null;

  // Build query with optional entity type filter using resolveTypeFilter
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

  const params: (string | number)[] = [processedQuery];
  if (typeFilterParam) params.push(typeFilterParam);
  params.push(limit);

  try {
    return db.prepare(sql).all(...params) as FtsMatch[];
  } catch {
    // FTS5 syntax error — try wrapping as phrase match
    try {
      const phraseQuery = `"${processedQuery.replace(/"/g, '')}"`;
      const fallbackParams: (string | number)[] = [phraseQuery];
      if (typeFilterParam) fallbackParams.push(typeFilterParam);
      fallbackParams.push(limit);
      return db.prepare(sql).all(...fallbackParams) as FtsMatch[];
    } catch {
      return [];
    }
  }
}

/**
 * Hydrate an FTS match with full contextual metadata from source tables.
 * Parses composite entity_type (e.g., 'module:schema') before routing.
 */
function hydrateResult(db: Database.Database, match: FtsMatch): TextSearchResult | null {
  const { entityType, subType } = parseCompositeType(match.entity_type);

  switch (entityType as string) {
    case 'repo':
      return hydrateRepo(db, match, subType);
    case 'module':
      return hydrateModule(db, match, subType);
    case 'event':
      return hydrateEvent(db, match, subType);
    case 'service':
      return hydrateService(db, match, subType);
    case 'learned_fact':
      return hydrateLearnedFact(db, match, subType);
    default:
      return null;
  }
}

function hydrateRepo(db: Database.Database, match: FtsMatch, subType: string): TextSearchResult | null {
  const row = db
    .prepare('SELECT name, path, description FROM repos WHERE id = ?')
    .get(match.entity_id) as { name: string; path: string; description: string | null } | undefined;

  if (!row) return null;

  return {
    entityType: 'repo',
    subType,
    entityId: match.entity_id,
    name: row.name,
    snippet: row.description ?? row.name,
    repoName: row.name,
    repoPath: row.path,
    filePath: null,
    relevance: match.relevance,
  };
}

function hydrateModule(db: Database.Database, match: FtsMatch, subType: string): TextSearchResult | null {
  const row = db
    .prepare(
      `SELECT m.name, m.summary, r.name as repo_name, r.path as repo_path, f.path as file_path
       FROM modules m
       JOIN repos r ON m.repo_id = r.id
       LEFT JOIN files f ON m.file_id = f.id
       WHERE m.id = ?`,
    )
    .get(match.entity_id) as {
    name: string;
    summary: string | null;
    repo_name: string;
    repo_path: string;
    file_path: string | null;
  } | undefined;

  if (!row) return null;

  return {
    entityType: 'module',
    subType,
    entityId: match.entity_id,
    name: row.name,
    snippet: row.summary ?? row.name,
    repoName: row.repo_name,
    repoPath: row.repo_path,
    filePath: row.file_path,
    relevance: match.relevance,
  };
}

function hydrateEvent(db: Database.Database, match: FtsMatch, subType: string): TextSearchResult | null {
  const row = db
    .prepare(
      `SELECT e.name, e.schema_definition, e.source_file, r.name as repo_name, r.path as repo_path
       FROM events e
       JOIN repos r ON e.repo_id = r.id
       WHERE e.id = ?`,
    )
    .get(match.entity_id) as {
    name: string;
    schema_definition: string | null;
    source_file: string | null;
    repo_name: string;
    repo_path: string;
  } | undefined;

  if (!row) return null;

  return {
    entityType: 'event',
    subType,
    entityId: match.entity_id,
    name: row.name,
    snippet: row.schema_definition ?? row.name,
    repoName: row.repo_name,
    repoPath: row.repo_path,
    filePath: row.source_file,
    relevance: match.relevance,
  };
}

function hydrateService(db: Database.Database, match: FtsMatch, subType: string): TextSearchResult | null {
  const row = db
    .prepare(
      `SELECT s.name, s.description, r.name as repo_name, r.path as repo_path
       FROM services s
       JOIN repos r ON s.repo_id = r.id
       WHERE s.id = ?`,
    )
    .get(match.entity_id) as {
    name: string;
    description: string | null;
    repo_name: string;
    repo_path: string;
  } | undefined;

  if (!row) return null;

  return {
    entityType: 'service',
    subType,
    entityId: match.entity_id,
    name: row.name,
    snippet: row.description ?? row.name,
    repoName: row.repo_name,
    repoPath: row.repo_path,
    filePath: null,
    relevance: match.relevance,
  };
}

function hydrateLearnedFact(db: Database.Database, match: FtsMatch, subType: string): TextSearchResult | null {
  const row = db
    .prepare('SELECT id, content, repo FROM learned_facts WHERE id = ?')
    .get(match.entity_id) as {
    id: number;
    content: string;
    repo: string | null;
  } | undefined;

  if (!row) return null;

  return {
    entityType: 'learned_fact' as EntityType, // Cast — FTS stores this string
    subType,
    entityId: match.entity_id,
    name: row.content.length > 100 ? row.content.substring(0, 100) + '...' : row.content,
    snippet: row.content,
    repoName: row.repo ?? 'user-knowledge',
    repoPath: '',
    filePath: null,
    relevance: match.relevance,
  };
}
