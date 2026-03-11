import type Database from 'better-sqlite3';
import type { TextSearchResult, TextSearchOptions } from './types.js';
import { parseCompositeType, searchWithRelaxation } from '../db/fts.js';
import { createEntityHydrator } from './entity.js';

/**
 * Full-text search across all indexed content with contextual metadata.
 * Uses searchWithRelaxation for progressive AND -> OR -> prefix OR cascade,
 * then hydrates results with repo/file context.
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

  // Progressive relaxation: AND -> OR -> prefix OR
  const ftsResults = searchWithRelaxation(db, query, limit, entityTypeFilter);

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

