import type Database from 'better-sqlite3';
import type { EntityType } from '../types/entities.js';
import type { TextSearchResult, TextSearchOptions } from './types.js';
import { parseCompositeType, searchWithRelaxation } from '../db/fts.js';
import { createEntityHydrator } from './entity.js';

/** Map entity type to the most useful follow-up MCP tool */
const NEXT_ACTION_MAP: Partial<Record<EntityType, string>> = {
  field: 'kb_field_impact',
  repo: 'kb_explain',
  module: 'kb_entity',
  event: 'kb_entity',
  service: 'kb_entity',
  learned_fact: 'kb_search',
};

/**
 * Get the recommended follow-up MCP tool for a given entity type.
 * Returns the tool name that would provide the most useful drill-down.
 */
export function getNextAction(entityType: EntityType, _subType: string): string {
  return NEXT_ACTION_MAP[entityType] ?? 'kb_entity';
}

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

    const tool = getNextAction(entityType, subType);
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
      nextAction: { tool, args: { name: entity.name } },
    });
  }

  return hydrated;
}

