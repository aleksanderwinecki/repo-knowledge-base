import type Database from 'better-sqlite3';
import type { TextSearchResult, TextSearchOptions } from './types.js';
import type { EntityType } from '../types/entities.js';
import { isVecAvailable } from '../db/vec.js';
import { generateQueryEmbedding } from '../embeddings/pipeline.js';
import { createEntityHydrator } from './entity.js';

/**
 * Semantic search using KNN vector similarity on entity embeddings.
 * Returns entities ranked by cosine distance (closest first), converted
 * to relevance scores via 1/(1+distance).
 *
 * Gracefully degrades to [] when:
 * - sqlite-vec extension is not available
 * - entity_embeddings table has no rows
 */
export async function searchSemantic(
  db: Database.Database,
  query: string,
  options: TextSearchOptions = {},
): Promise<TextSearchResult[]> {
  const { limit = 20, repoFilter } = options;

  // Guard 1: vec extension not loaded
  if (!isVecAvailable()) return [];

  // Guard 2: no embeddings stored
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM entity_embeddings').get() as { cnt: number };
  if (countRow.cnt === 0) return [];

  // Generate query vector with search_query: prefix
  const queryVec = await generateQueryEmbedding(query);

  // KNN query via vec0 virtual table
  const knnRows = db.prepare(
    `SELECT entity_type, entity_id, distance
     FROM entity_embeddings
     WHERE embedding MATCH ?
     AND k = ?
     ORDER BY distance`,
  ).all(Buffer.from(queryVec.buffer), limit * 2) as Array<{
    entity_type: string;
    entity_id: string;
    distance: number;
  }>;

  // Hydrate results with entity metadata
  const hydrate = createEntityHydrator(db);
  const results: TextSearchResult[] = [];

  for (const row of knnRows) {
    const entityType = row.entity_type as EntityType;
    const entityId = parseInt(row.entity_id, 10);
    const entity = hydrate(entityType, entityId);

    // Skip entities that no longer exist
    if (!entity) continue;

    // Apply repo filter post-hydration (same pattern as searchText)
    if (repoFilter && entity.repoName !== repoFilter) continue;

    results.push({
      entityType,
      subType: entityType, // No FTS composite types in KNN
      entityId,
      name: entity.name,
      snippet: entity.description ?? entity.name,
      repoName: entity.repoName,
      repoPath: entity.repoPath,
      filePath: entity.filePath,
      relevance: 1 / (1 + row.distance),
    });

    if (results.length >= limit) break;
  }

  return results;
}
