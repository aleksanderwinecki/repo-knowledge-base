import type Database from 'better-sqlite3';
import type { TextSearchResult, TextSearchOptions } from './types.js';
import { tokenizeForFts } from '../db/tokenizer.js';
import { resolveTypeFilter, parseCompositeType, executeFtsWithFallback } from '../db/fts.js';
import { createEntityHydrator } from './entity.js';

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

  // Create shared hydrator for entity lookups
  const hydrate = createEntityHydrator(db);

  // Hydrate each result with contextual metadata
  const hydrated: TextSearchResult[] = [];

  for (const match of ftsResults) {
    const { entityType, subType } = parseCompositeType(match.entity_type);
    const entity = hydrate(entityType, match.entity_id);
    if (!entity) continue;

    // Apply repo filter after hydration
    if (repoFilter && entity.repoName !== repoFilter) continue;

    hydrated.push({
      entityType,
      subType,
      entityId: match.entity_id,
      name: entity.name,
      snippet: entity.description ?? entity.name,
      repoName: entity.repoName,
      repoPath: entity.repoPath,
      filePath: entity.filePath,
      relevance: match.relevance,
    });
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

  const buildParams = (query: string): (string | number)[] => {
    const p: (string | number)[] = [query];
    if (typeFilterParam) p.push(typeFilterParam);
    p.push(limit);
    return p;
  };

  return executeFtsWithFallback<FtsMatch>(db, sql, processedQuery, buildParams);
}

