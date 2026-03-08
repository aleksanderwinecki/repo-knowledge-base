import type Database from 'better-sqlite3';
import type { TextSearchResult, TextSearchOptions } from './types.js';
import { searchText } from './text.js';
import { searchSemantic } from './semantic.js';

/** Reciprocal Rank Fusion constant. Standard value per the original RRF paper. */
export const RRF_K = 60;

/**
 * Hybrid search combining FTS5 text search and KNN vector similarity.
 * Merges results using Reciprocal Rank Fusion (RRF) with k=60.
 *
 * Gracefully degrades to FTS5-only when vector search returns no results
 * (covers both vec-unavailable and empty-embeddings cases).
 *
 * Deduplicates entities that appear in both result sets, giving them
 * a higher combined RRF score.
 */
export async function searchHybrid(
  db: Database.Database,
  query: string,
  options: TextSearchOptions = {},
): Promise<TextSearchResult[]> {
  const { limit = 20 } = options;

  // Run both search legs -- FTS5 (sync) and KNN (async)
  const ftsResults = searchText(db, query, { ...options, limit: limit * 2 });
  const vecResults = await searchSemantic(db, query, { ...options, limit: limit * 2 });

  // Graceful degradation: FTS5-only when no vector results
  if (vecResults.length === 0) {
    return ftsResults.slice(0, limit);
  }

  // RRF merge with deduplication
  const scores = new Map<string, { score: number; result: TextSearchResult }>();

  // Score FTS5 results
  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i]!;
    const key = `${r.entityType}:${r.entityId}`;
    const rrfScore = 1 / (RRF_K + i + 1);

    const existing = scores.get(key);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(key, { score: rrfScore, result: r });
    }
  }

  // Score KNN results
  for (let i = 0; i < vecResults.length; i++) {
    const r = vecResults[i]!;
    const key = `${r.entityType}:${r.entityId}`;
    const rrfScore = 1 / (RRF_K + i + 1);

    const existing = scores.get(key);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(key, { score: rrfScore, result: r });
    }
  }

  // Sort by combined RRF score descending, take top limit
  const merged = Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, result }) => ({
      ...result,
      relevance: score,
    }));

  return merged;
}
