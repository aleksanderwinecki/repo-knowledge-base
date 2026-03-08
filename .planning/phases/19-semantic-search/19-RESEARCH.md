# Phase 19: Semantic Search - Research

**Researched:** 2026-03-08
**Domain:** Vector similarity search, hybrid FTS5+KNN retrieval, RRF scoring
**Confidence:** HIGH

## Summary

Phase 19 builds the query-side of semantic search on top of the Phase 18 embedding infrastructure. The infrastructure is solid: `entity_embeddings` vec0 table with `float[256]` vectors, `entity_type text` and `entity_id text` metadata columns, `generateEmbedding()` and `generateEmbeddingsBatch()` with `search_document:` prefix, `isVecAvailable()` gate, and `composeEmbeddingText()` preprocessing. What's missing is query-time embedding (with `search_query:` prefix), the KNN query function, hybrid search combining FTS5 + vector results via RRF scoring, graceful degradation, and the MCP tool.

The core architecture is straightforward: add a `generateQueryEmbedding()` function that uses the `search_query:` prefix (vs `search_document:` for indexing), build a `searchSemantic()` function that runs KNN against `entity_embeddings` and hydrates results via the existing `createEntityHydrator()`, build a `searchHybrid()` function that runs both FTS5 and KNN and merges with Reciprocal Rank Fusion (k=60), then wire it into the CLI and MCP. The graceful degradation pattern is already established: `isVecAvailable()` gates all vector paths, and the existing `searchText()` FTS5 path remains the unconditional fallback. The CLI already has `withDbAsync()` for async database operations.

**Primary recommendation:** Layer semantic search alongside existing FTS5 search using the same `TextSearchResult` return type. Use RRF with k=60 for hybrid scoring. Add `--semantic` flag to CLI `search` command and a new `kb_semantic` MCP tool. All new code goes in `src/search/semantic.ts` and `src/search/hybrid.ts`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEM-04 | KNN vector similarity search -- `kb search --semantic "query"` returns nearest entities | `generateQueryEmbedding()` with `search_query:` prefix + vec0 KNN MATCH query + hydration via `createEntityHydrator()`. All building blocks exist. |
| SEM-05 | Hybrid FTS5 + vector search with RRF scoring -- combines keyword and semantic results | FTS5 `searchText()` already returns ranked results; KNN returns distance-ranked results. RRF formula: `score = sum(1/(k + rank))` with k=60 merges both lists. |
| SEM-06 | Graceful degradation -- falls back to FTS5-only when sqlite-vec unavailable or embeddings not generated | `isVecAvailable()` already exists as a boolean gate. When false, skip KNN entirely and return FTS5-only results. When embeddings table is empty, KNN returns empty list and RRF degrades to FTS5-only naturally. |
| SEM-07 | `kb_semantic` MCP tool for natural language queries from AI agents | Follow existing pattern: `src/mcp/tools/semantic.ts` with zod schema, `wrapToolHandler`, `formatResponse`, `withAutoSync`. Calls `searchHybrid()`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| sqlite-vec | 0.1.7-alpha.2 (existing) | vec0 KNN MATCH queries | Already loaded in Phase 18; provides `WHERE embedding MATCH ? AND k = ?` syntax |
| @huggingface/transformers | ^3.8.1 (existing) | Query embedding generation | Already loaded in Phase 18; `getEmbeddingPipeline()` singleton ready |
| better-sqlite3 | existing | Synchronous SQLite access | All DB queries are sync; embedding generation is async then results inserted sync |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | existing | MCP tool input validation | Schema for `kb_semantic` tool |
| @modelcontextprotocol/sdk | existing | MCP server registration | Register `kb_semantic` tool |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| RRF k=60 | Weighted linear combination | RRF is rank-based (no score normalization needed); linear combo requires normalizing FTS5 BM25 scores to [0,1] which is fragile |
| Separate `searchSemantic` function | Modifying `searchText` directly | Separate function preserves backward compatibility and is testable independently |
| New MCP tool `kb_semantic` | Adding `--semantic` param to existing `kb_search` | Dedicated tool is clearer for AI agents; existing `kb_search` gets automatic hybrid behavior on default `kb search` |

**Installation:** No new dependencies needed. All libraries from Phase 18.

## Architecture Patterns

### Recommended Project Structure
```
src/
  search/
    text.ts           # EXISTING: FTS5 search (searchText)
    entity.ts         # EXISTING: Entity cards (findEntity, createEntityHydrator)
    semantic.ts       # NEW: KNN vector search (searchSemantic)
    hybrid.ts         # NEW: RRF hybrid search (searchHybrid)
    types.ts          # MODIFIED: Add SemanticSearchOptions type
    index.ts          # MODIFIED: Export new functions
  embeddings/
    pipeline.ts       # MODIFIED: Add generateQueryEmbedding with "search_query:" prefix
  cli/
    commands/
      search.ts       # MODIFIED: Add --semantic flag, use withDbAsync
  mcp/
    tools/
      semantic.ts     # NEW: kb_semantic MCP tool
    server.ts         # MODIFIED: Register semantic tool
```

### Pattern 1: Query Embedding with search_query Prefix
**What:** Generate embeddings for user queries with the correct nomic-embed-text prefix.
**When to use:** Every time a user issues a semantic or hybrid search.
**Example:**
```typescript
// src/embeddings/pipeline.ts -- ADD this function

/**
 * Generate a 256d embedding for a search query.
 * Uses "search_query: " prefix (vs "search_document: " for indexing).
 * Applies same Matryoshka truncation + L2 normalization.
 */
export async function generateQueryEmbedding(text: string): Promise<Float32Array> {
  const pipe = await getEmbeddingPipeline();

  // Query prefix is different from document prefix
  const prefixedText = `search_query: ${text}`;

  let output = await pipe(prefixedText, { pooling: 'mean' });
  const dimSize = output.dims[1] ?? MATRYOSHKA_DIM;
  output = layer_norm(output, [dimSize])
    .slice(null, [0, MATRYOSHKA_DIM])
    .normalize(2, -1);

  return new Float32Array((output.data as Float32Array).slice(0, MATRYOSHKA_DIM));
}
```

### Pattern 2: KNN Vector Search
**What:** Query the vec0 table for nearest neighbor entities and hydrate results.
**When to use:** `kb search --semantic "query"` or as one leg of hybrid search.
**Example:**
```typescript
// src/search/semantic.ts

import type Database from 'better-sqlite3';
import { isVecAvailable } from '../db/vec.js';
import { generateQueryEmbedding } from '../embeddings/pipeline.js';
import { createEntityHydrator } from './entity.js';
import type { TextSearchResult, TextSearchOptions } from './types.js';
import type { EntityType } from '../types/entities.js';

export async function searchSemantic(
  db: Database.Database,
  query: string,
  options: TextSearchOptions = {},
): Promise<TextSearchResult[]> {
  const { limit = 20 } = options;

  if (!isVecAvailable()) return [];

  // Check if embeddings exist
  const count = db.prepare('SELECT COUNT(*) as cnt FROM entity_embeddings').get() as { cnt: number };
  if (count.cnt === 0) return [];

  // Generate query embedding (async)
  const queryVec = await generateQueryEmbedding(query);

  // KNN query (sync -- better-sqlite3)
  const rows = db.prepare(`
    SELECT entity_type, entity_id, distance
    FROM entity_embeddings
    WHERE embedding MATCH ?
    AND k = ?
    ORDER BY distance
  `).all(Buffer.from(queryVec.buffer), limit) as Array<{
    entity_type: string;
    entity_id: string;
    distance: number;
  }>;

  // Hydrate results using existing entity hydrator
  const hydrate = createEntityHydrator(db);
  const results: TextSearchResult[] = [];

  for (const row of rows) {
    const entityType = row.entity_type as EntityType;
    const entityId = parseInt(row.entity_id, 10);
    const entity = hydrate(entityType, entityId);
    if (!entity) continue;

    // Apply filters
    if (options.repoFilter && entity.repoName !== options.repoFilter) continue;

    results.push({
      entityType,
      subType: entityType, // semantic search doesn't have FTS composite types
      entityId,
      name: entity.name,
      snippet: entity.description ?? entity.name,
      repoName: entity.repoName,
      repoPath: entity.repoPath,
      filePath: entity.filePath,
      relevance: 1 / (1 + row.distance), // Convert distance to relevance [0,1]
    });
  }

  return results;
}
```

### Pattern 3: Reciprocal Rank Fusion (RRF) Hybrid Search
**What:** Combine FTS5 keyword results and KNN vector results using rank-based fusion.
**When to use:** Default `kb search "query"` when embeddings are available.
**Example:**
```typescript
// src/search/hybrid.ts

const RRF_K = 60; // Standard RRF constant

/**
 * Combine FTS5 and vector search results using Reciprocal Rank Fusion.
 * RRF score = sum(1 / (k + rank)) across result lists.
 * Rank-based: doesn't need score normalization between different ranking systems.
 */
export async function searchHybrid(
  db: Database.Database,
  query: string,
  options: TextSearchOptions = {},
): Promise<TextSearchResult[]> {
  const { limit = 20 } = options;

  // Run both searches -- FTS5 is sync, semantic is async
  const ftsResults = searchText(db, query, { ...options, limit: limit * 2 });
  const vecResults = await searchSemantic(db, query, { ...options, limit: limit * 2 });

  // If no vector results, just return FTS (graceful degradation)
  if (vecResults.length === 0) return ftsResults.slice(0, limit);

  // Build RRF scores: key = "entityType:entityId"
  const scores = new Map<string, { score: number; result: TextSearchResult }>();

  // Score FTS results by rank position
  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i]!;
    const key = `${r.entityType}:${r.entityId}`;
    const rrfScore = 1 / (RRF_K + i + 1); // rank is 1-indexed
    const existing = scores.get(key);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(key, { score: rrfScore, result: r });
    }
  }

  // Score vector results by rank position
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

  // Sort by combined RRF score descending, take top N
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, result }) => ({ ...result, relevance: score }));
}
```

### Pattern 4: Graceful Degradation
**What:** Fall back to FTS5-only when sqlite-vec is unavailable or no embeddings exist.
**When to use:** Every search path must handle this case.
**Example:**
```typescript
// In searchHybrid:
// If vec is unavailable or no embeddings, vecResults is empty []
// When vecResults is empty, function returns ftsResults directly (short-circuit)
// This means: hybrid search with no embeddings === FTS5-only search

// In searchSemantic:
// Return empty array immediately if !isVecAvailable() or embeddings count is 0

// In CLI:
// --semantic flag with no vec available: return empty results (searchSemantic returns [])
// Default search (hybrid): silently falls back to FTS5-only
```

### Pattern 5: CLI Integration with withDbAsync
**What:** Use existing `withDbAsync()` for the async search commands.
**When to use:** CLI `search` command when `--semantic` flag or default hybrid search.
**Example:**
```typescript
// src/cli/commands/search.ts -- VERIFIED: withDbAsync exists in src/cli/db.ts
// Signature: async function withDbAsync<T>(fn: (db) => Promise<T>): Promise<T>

.option('--semantic', 'use semantic vector similarity search')
.action(async (query, opts) => {
  if (opts.semantic || /* hybrid enabled */) {
    await withDbAsync(async (db) => {
      const results = opts.semantic
        ? await searchSemantic(db, query, { limit: parseInt(opts.limit, 10), repoFilter: opts.repo })
        : await searchHybrid(db, query, { limit: parseInt(opts.limit, 10), repoFilter: opts.repo });
      output(results);
      if (opts.timing) reportTimings();
    });
  } else {
    // Existing sync path for non-hybrid search
    withDb((db) => { /* existing code */ });
  }
});
```

### Pattern 6: MCP Tool Registration
**What:** Register `kb_semantic` following the established pattern.
**When to use:** AI agents issue natural language queries.
**Example:**
```typescript
// src/mcp/tools/semantic.ts
export function registerSemanticTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_semantic',
    'Semantic search for natural language queries. Returns entities ranked by meaning similarity. Use for questions like "which services handle payments" or "modules related to user authentication".',
    {
      query: z.string().describe('Natural language search query'),
      limit: z.number().min(1).max(50).optional().describe('Max results (default: 10)'),
      repo: z.string().optional().describe('Filter results to a specific repo'),
    },
    wrapToolHandler('kb_semantic', async ({ query, limit, repo }) => {
      const results = await withAutoSync(
        db,
        () => searchHybrid(db, query, { limit: limit ?? 10, repoFilter: repo }),
        (items) => [...new Set(items.map((r) => r.repoName))],
      );

      return formatResponse(
        results,
        (items) => `Found ${results.length} semantic matches for "${query}" (showing ${items.length})`,
      );
    }),
  );
}
```

### Anti-Patterns to Avoid
- **Using `search_document:` prefix for queries:** nomic-embed-text-v1.5 uses asymmetric prefixes. Documents use `search_document:`, queries use `search_query:`. Wrong prefix degrades similarity quality.
- **Normalizing FTS5 BM25 scores for weighted combination:** BM25 scores are unbounded negative numbers (rank column in FTS5). Normalizing to [0,1] is fragile and dataset-dependent. RRF avoids this entirely by using rank positions.
- **Running KNN synchronously in a transaction:** `generateQueryEmbedding()` is async. Generate the query vector first, then run the synchronous vec0 MATCH query.
- **Duplicating entity hydration logic:** Use `createEntityHydrator()` from `entity.ts` -- it's already exported and handles all entity types.
- **Filtering by entity_type in KNN WHERE clause:** While metadata filtering works, it limits the KNN to a subset, which could miss good results. Better to filter post-KNN during hydration, same as FTS5 does.
- **Using sync `withDb()` for async search:** Use `withDbAsync()` from `src/cli/db.ts` instead. Using sync `withDb()` with an async callback will close the DB before the Promise resolves.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Score normalization for hybrid search | Min-max normalizer for BM25 + distance | RRF (rank-based) | Score normalization is fragile and dataset-dependent; RRF is rank-only |
| Query embedding | Copy-paste `generateEmbedding` with different prefix | New `generateQueryEmbedding()` function | Single place to change prefix logic; reuses singleton pipeline |
| Entity hydration from KNN results | New SQL JOINs for each entity type | `createEntityHydrator()` from `entity.ts` | Already handles all 5 entity types with pre-prepared statements |
| Embedding availability check | Count rows in entity_embeddings each time | Cache-style check or fast `SELECT COUNT(*)` | vec0 tables are fast for count; guard with `isVecAvailable()` first |
| Re-ranking model | Fine-tuned cross-encoder for reranking | RRF of FTS5 + vector | Out of scope per REQUIREMENTS.md (explicitly listed) |
| Async DB lifecycle | Custom open/try/finally pattern | `withDbAsync()` from `src/cli/db.ts` | Already exists, handles cleanup correctly |

**Key insight:** This phase is pure query-side glue code. All the hard infrastructure (embedding model, vec0 table, entity hydration) was built in Phase 18 and earlier. The value is in correct wiring and the RRF algorithm.

## Common Pitfalls

### Pitfall 1: Wrong Embedding Prefix for Queries
**What goes wrong:** Using `search_document:` prefix for query embeddings produces semantically poor results.
**Why it happens:** Copy-pasting `generateEmbedding()` which hardcodes `search_document:`.
**How to avoid:** Create a dedicated `generateQueryEmbedding()` function with `search_query:` prefix. nomic-embed-text-v1.5 was trained with these asymmetric prefixes.
**Warning signs:** Semantic search returns unrelated results; FTS5 results are consistently better.

### Pitfall 2: Buffer.from() for KNN Query Vector
**What goes wrong:** Passing `Float32Array` directly to the KNN MATCH parameter.
**Why it happens:** better-sqlite3 doesn't automatically convert `Float32Array` to the binary format sqlite-vec expects.
**How to avoid:** Use `Buffer.from(queryVec.buffer)` when binding the query vector in the MATCH clause, same as Phase 18 does for insertions.
**Warning signs:** "invalid vector format" or empty KNN results.

### Pitfall 3: RRF Rank Off-by-One
**What goes wrong:** Using 0-indexed ranks in RRF formula instead of 1-indexed.
**Why it happens:** Array iteration starts at 0 in JavaScript.
**How to avoid:** RRF formula uses 1-indexed ranks: `1 / (k + rank)` where rank starts at 1. With 0-indexed loop variable `i`, use `1 / (RRF_K + i + 1)`.
**Warning signs:** First result gets disproportionately high score (1/60 vs 1/61).

### Pitfall 4: Empty Embeddings Table Causes Error Instead of Graceful Degradation
**What goes wrong:** KNN MATCH on an empty vec0 table might throw or return unexpected results.
**Why it happens:** sqlite-vec behavior on empty tables isn't well-documented.
**How to avoid:** Check `COUNT(*) FROM entity_embeddings` before running KNN. If 0, skip vector search entirely. This also handles the case where user hasn't run `kb index` yet or sqlite-vec loaded but no embeddings generated.
**Warning signs:** Error during `kb search` on a fresh database.

### Pitfall 5: Hybrid Search Double-Counts Entities
**What goes wrong:** Same entity appears in both FTS5 and KNN results but isn't merged.
**Why it happens:** Different ID representations (FTS5 uses composite `entity_type:subType`, KNN uses plain `entity_type`).
**How to avoid:** Use a consistent dedup key: `${entityType}:${entityId}` (coarse entityType, not composite). The RRF map naturally handles dedup by accumulating scores for the same key.
**Warning signs:** Duplicate entities in search results.

### Pitfall 6: withAutoSync with async searchHybrid in MCP
**What goes wrong:** `withAutoSync` expects the queryFn to be synchronous, but `searchHybrid` is async.
**Why it happens:** `withAutoSync` signature is `queryFn: () => T` where T could be Promise.
**How to avoid:** Check `withAutoSync` signature carefully. Current implementation calls `queryFn()` and assigns result, then re-calls. Since `searchHybrid` returns a Promise, `withAutoSync` will work but `extractRepoNames` receives a Promise instead of resolved results. May need an async variant or await inside.
**Warning signs:** `extractRepoNames` called with a Promise object instead of array.

## Code Examples

### KNN Query with Buffer Binding (verified from Phase 18 integration test)
```typescript
// Source: tests/embeddings/integration.test.ts (existing, working)
const queryVec = await generateQueryEmbedding('hotel booking reservation');

const results = db.prepare(`
  SELECT entity_type, entity_id, distance
  FROM entity_embeddings
  WHERE embedding MATCH ?
  AND k = ?
  ORDER BY distance
`).all(Buffer.from(queryVec.buffer), 10) as Array<{
  entity_type: string;
  entity_id: string;
  distance: number;
}>;
```

### RRF Score Calculation
```typescript
// Source: RRF paper (Cormack et al. 2009), confirmed by industry implementations
const RRF_K = 60;

function computeRrfScores(
  rankedLists: TextSearchResult[][],
): Map<string, { score: number; result: TextSearchResult }> {
  const scores = new Map<string, { score: number; result: TextSearchResult }>();

  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!;
      const key = `${r.entityType}:${r.entityId}`;
      const rrfScore = 1 / (RRF_K + i + 1); // 1-indexed rank
      const existing = scores.get(key);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(key, { score: rrfScore, result: r });
      }
    }
  }

  return scores;
}
```

### Distance Metric Note
```
The entity_embeddings vec0 table uses default L2 (Euclidean) distance.
Since all embeddings are L2-normalized (norm = 1.0), L2 distance and cosine
distance produce equivalent ranking:
  L2^2 = 2 - 2*cos(theta)
Lower L2 distance = higher cosine similarity.
No need to change to distance_metric=cosine.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| FTS5-only keyword search | Hybrid FTS5 + vector with RRF | Phase 19 | Natural language queries work ("which services handle payments") |
| Weighted linear combination | Reciprocal Rank Fusion (k=60) | 2024-2025 industry consensus | No score normalization needed; robust to different ranking scales |
| Single retrieval strategy | Multi-strategy retrieval | 2024-2025 RAG evolution | FTS5 catches exact keyword matches; vector catches semantic matches |

**Deprecated/outdated:**
- Simple score normalization (min-max) for hybrid search: Fragile, dataset-dependent
- Re-ranking with cross-encoder: Out of scope per REQUIREMENTS.md; RRF is sufficient

## Open Questions

1. **Empty vec0 table KNN behavior**
   - What we know: sqlite-vec docs don't explicitly cover empty table behavior.
   - What's unclear: Whether `WHERE embedding MATCH ? AND k = 10` on an empty table returns empty results or throws.
   - Recommendation: Guard with a `COUNT(*)` check before running KNN. LOW risk since this is a simple pre-check.

2. **entity_id text type in KNN results**
   - What we know: Phase 18 stores entity_id as text (`String(entity.entityId)`) in vec0, but entity hydrator expects integer IDs.
   - Resolution: `parseInt(row.entity_id, 10)` during hydration. Well-understood, no ambiguity.

3. **RRF k value tuning**
   - What we know: k=60 is the standard value from the original paper and used by Elasticsearch, Azure AI Search, OpenSearch.
   - What's unclear: Whether k=60 is optimal for our small dataset (hundreds of entities vs millions of documents).
   - Recommendation: Start with k=60. Can be tuned later if needed. The algorithm is not sensitive to small k variations.

4. **withAutoSync and async search functions**
   - What we know: `withAutoSync` in `src/mcp/sync.ts` has signature `queryFn: () => T` and calls `queryFn()` twice (before and after sync).
   - What's unclear: Whether it handles `T = Promise<TextSearchResult[]>` correctly (extractRepoNames would receive a Promise).
   - Recommendation: At implementation time, either make `withAutoSync` generic over async, create `withAutoSyncAsync`, or await the searchHybrid result before passing to withAutoSync.

### Resolved Questions
- **withDb async support:** RESOLVED -- `withDbAsync()` already exists in `src/cli/db.ts`. Signature: `async function withDbAsync<T>(fn: (db) => Promise<T>): Promise<T>`. Use this for the search command's async paths.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/search/semantic.test.ts tests/search/hybrid.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEM-04 | `searchSemantic()` returns entities ranked by vector similarity | unit+integration | `npx vitest run tests/search/semantic.test.ts -x` | No -- Wave 0 |
| SEM-04 | `generateQueryEmbedding()` uses "search_query:" prefix | unit | `npx vitest run tests/embeddings/pipeline.test.ts -x` | Extend existing |
| SEM-05 | `searchHybrid()` combines FTS5 + vector results with RRF | unit | `npx vitest run tests/search/hybrid.test.ts -x` | No -- Wave 0 |
| SEM-05 | RRF scoring correctly merges overlapping results | unit | `npx vitest run tests/search/hybrid.test.ts -x` | No -- Wave 0 |
| SEM-06 | `searchSemantic()` returns [] when vec unavailable | unit | `npx vitest run tests/search/semantic.test.ts -x` | No -- Wave 0 |
| SEM-06 | `searchHybrid()` degrades to FTS5-only when vec unavailable | unit | `npx vitest run tests/search/hybrid.test.ts -x` | No -- Wave 0 |
| SEM-06 | `searchHybrid()` degrades to FTS5-only when embeddings empty | unit | `npx vitest run tests/search/hybrid.test.ts -x` | No -- Wave 0 |
| SEM-06 | CLI `--semantic` with no vec shows empty results, no crash | unit | `npx vitest run tests/cli/search.test.ts -x` | No -- Wave 0 |
| SEM-07 | `kb_semantic` MCP tool accepts query and returns results | unit | `npx vitest run tests/mcp/tools.test.ts -x` | Extend existing |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/search/semantic.test.ts tests/search/hybrid.test.ts tests/embeddings/pipeline.test.ts -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/search/semantic.test.ts` -- KNN search with mock embeddings, graceful degradation, repo filter
- [ ] `tests/search/hybrid.test.ts` -- RRF scoring logic, dedup, degradation to FTS5-only, limit enforcement
- [ ] Extend `tests/embeddings/pipeline.test.ts` -- add `generateQueryEmbedding` tests (model-dependent with SKIP guard)
- [ ] Extend `tests/mcp/tools.test.ts` -- add `kb_semantic` tool contract test

### Test Strategy Note
Model-dependent tests (actual embedding generation) already exist in Phase 18 tests with `SKIP_EMBEDDING_MODEL` guard. For Phase 19, most tests can use **mock embeddings** -- pre-computed or synthetic Float32Arrays inserted directly into vec0 via `Buffer.from()` -- to test the KNN query, hydration, and RRF logic without needing the model. This approach:
- Avoids 120s model download in test suite
- Tests the SQL + hydration + RRF logic deterministically
- Only a few integration tests need real embeddings (extend existing Phase 18 integration test)

**Mock embedding insertion pattern (for tests):**
```typescript
// Insert synthetic embedding directly into vec0
const fakeVec = new Float32Array(256).fill(0.1);
db.prepare('INSERT INTO entity_embeddings(embedding, entity_type, entity_id) VALUES (?, ?, ?)')
  .run(Buffer.from(fakeVec.buffer), 'module', '1');
```

## Sources

### Primary (HIGH confidence)
- [sqlite-vec KNN docs](https://alexgarcia.xyz/sqlite-vec/features/knn.html) -- MATCH syntax, k parameter, distance column, distance_metric options, default L2 distance
- [sqlite-vec metadata columns blog](https://alexgarcia.xyz/blog/2024/sqlite-vec-metadata-release/index.html) -- metadata column syntax, filtering in WHERE clause, supported operators (=, !=, <, >, IN)
- [nomic-ai/nomic-embed-text-v1.5 HuggingFace](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) -- `search_query:` vs `search_document:` prefix requirement
- Existing codebase: `src/embeddings/pipeline.ts`, `src/search/text.ts`, `src/db/vec.ts`, `src/mcp/tools/search.ts`, `src/cli/db.ts` -- established patterns

### Secondary (MEDIUM confidence)
- [RRF in hybrid search (glaforge.dev)](https://glaforge.dev/posts/2026/02/10/advanced-rag-understanding-reciprocal-rank-fusion-in-hybrid-search/) -- RRF formula, k=60 constant, implementation approach
- [Azure AI Search hybrid scoring](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking) -- RRF k=60 industry usage
- [OpenSearch RRF introduction](https://opensearch.org/blog/introducing-reciprocal-rank-fusion-hybrid-search/) -- RRF as standard for hybrid search

### Tertiary (LOW confidence)
- Empty vec0 table behavior -- not documented; needs empirical testing at implementation time

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies; all Phase 18 infrastructure verified working
- Architecture: HIGH -- RRF is well-understood; KNN query syntax verified from docs; hydration and CLI patterns established
- Pitfalls: HIGH -- most pitfalls identified from codebase inspection and established patterns
- Validation: MEDIUM -- mock embedding test strategy needs validation at implementation

**Research date:** 2026-03-08
**Valid until:** 2026-04-08
