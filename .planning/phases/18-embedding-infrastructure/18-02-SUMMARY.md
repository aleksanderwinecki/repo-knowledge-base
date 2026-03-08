---
phase: 18-embedding-infrastructure
plan: 02
subsystem: embeddings
tags: [transformers-js, nomic-embed-text, matryoshka, onnx, vector-generation, pipeline]

# Dependency graph
requires:
  - phase: 18-embedding-infrastructure
    plan: 01
    provides: sqlite-vec loading, vec0 table, composeEmbeddingText, isVecAvailable, clearRepoEmbeddings
provides:
  - Transformers.js singleton pipeline for nomic-embed-text-v1.5 (lazy-loaded)
  - generateEmbedding producing 256d Float32Array with Matryoshka truncation
  - generateEmbeddingsBatch for batched inference with search_document prefix
  - generateAllEmbeddings orchestrating entity query/compose/embed/persist cycle
  - Phase 4 embedding step in indexAllRepos (post-persistence, pre-FTS optimize)
  - IndexStats.embeddings field for reporting
affects: [19-semantic-search]

# Tech tracking
tech-stack:
  added: ["@huggingface/transformers ^3.x"]
  patterns: [singleton pipeline pattern, async-generate-then-sync-persist, Matryoshka layer_norm+slice+normalize]

key-files:
  created:
    - src/embeddings/pipeline.ts
    - src/embeddings/generate.ts
    - tests/embeddings/pipeline.test.ts
    - tests/embeddings/integration.test.ts
  modified:
    - src/indexer/pipeline.ts
    - package.json

key-decisions:
  - "Use (pipeline as any)() cast to avoid TS2590 union type complexity error from @huggingface/transformers pipeline() overloads"
  - "Model cached at ~/.kb/models/ for stability across npm reinstalls"
  - "Buffer.from(embedding.buffer) for vec0 insertion (consistent with 18-01 pattern)"

patterns-established:
  - "Embedding pipeline singleton: getEmbeddingPipeline() lazy-loads once, reused across all calls"
  - "Async generate, sync persist: generateEmbeddingsBatch returns Float32Array[], then db.transaction() inserts"
  - "SKIP_EMBEDDING_MODEL env var for CI environments without network/model access"

requirements-completed: [SEM-02]

# Metrics
duration: 6min
completed: 2026-03-08
---

# Phase 18 Plan 02: Embedding Generation Pipeline Summary

**Transformers.js nomic-embed-text-v1.5 pipeline producing 256d Matryoshka embeddings, wired into indexer as Phase 4 post-persistence step with batch generation and graceful degradation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-08T16:27:13Z
- **Completed:** 2026-03-08T16:33:09Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Singleton Transformers.js pipeline loads nomic-embed-text-v1.5 with model caching at ~/.kb/models/
- generateEmbedding and generateEmbeddingsBatch produce L2-normalized 256d Float32Array vectors via Matryoshka truncation (layer_norm -> slice -> normalize)
- generateAllEmbeddings orchestrates entity query from 5 tables, text composition, batch embedding in chunks of 32, and vec0 persistence
- Phase 4 embedding step in indexAllRepos runs after Event Catalog enrichment, with graceful degradation when sqlite-vec unavailable
- Full test suite green (518 tests, 35 files, zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Embedding pipeline and batch generation orchestrator** - `149281b` (feat, TDD)
2. **Task 2: Wire embedding step into indexer pipeline and integration tests** - `2d50a17` (feat)

## Files Created/Modified
- `src/embeddings/pipeline.ts` - Singleton Transformers.js pipeline, generateEmbedding, generateEmbeddingsBatch with Matryoshka truncation
- `src/embeddings/generate.ts` - generateAllEmbeddings orchestrator: query entities, compose text, batch embed, persist to vec0
- `src/indexer/pipeline.ts` - Phase 4 embedding step after Event Catalog enrichment, IndexStats.embeddings field
- `tests/embeddings/pipeline.test.ts` - 5 tests: Float32Array output, L2 normalization, batch dimensions, vec-unavailable guard
- `tests/embeddings/integration.test.ts` - 5 tests: end-to-end embed+store, incremental mode, force mode, KNN query, learned_facts
- `package.json` - Added @huggingface/transformers dependency

## Decisions Made
- Used `(pipeline as any)()` cast to work around TS2590 "union type too complex" error from @huggingface/transformers pipeline() type overloads
- Model cached at `~/.kb/models/` (not node_modules) for persistence across reinstalls per research recommendation
- Used `Buffer.from(embedding.buffer)` for vec0 insertion, consistent with 18-01's established pattern
- Added `SKIP_EMBEDDING_MODEL` env var for CI environments without network or model access

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TS2590 union type complexity error from pipeline() call**
- **Found during:** Task 1 (pipeline.ts implementation)
- **Issue:** `pipeline('feature-extraction', ...)` return type produces a union too complex for TypeScript to represent, causing TS2590 error
- **Fix:** Cast pipeline function via `(pipeline as any)()` and explicitly type result as `FeatureExtractionPipeline`
- **Files modified:** src/embeddings/pipeline.ts
- **Verification:** `npm run build` compiles cleanly
- **Committed in:** 149281b (Task 1 commit)

**2. [Rule 3 - Blocking] noUncheckedIndexedAccess on tensor dims**
- **Found during:** Task 1 (pipeline.ts implementation)
- **Issue:** `output.dims[1]` typed as `number | undefined` due to project's `noUncheckedIndexedAccess: true` tsconfig
- **Fix:** Added fallback: `output.dims[1] ?? MATRYOSHKA_DIM` for both single and batch paths
- **Files modified:** src/embeddings/pipeline.ts
- **Verification:** `npm run build` compiles cleanly
- **Committed in:** 149281b (Task 1 commit)

**3. [Rule 3 - Blocking] Corrupted model cache from test timeout**
- **Found during:** Task 1 (first test run)
- **Issue:** Default 5s vitest timeout killed model download mid-stream, leaving corrupted 57MB partial file (should be 547MB)
- **Fix:** Cleared cache, added 120s timeout to model-dependent tests
- **Files modified:** tests/embeddings/pipeline.test.ts
- **Verification:** Full model downloaded and cached; subsequent test runs complete in <1s
- **Committed in:** 149281b (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3 blocking)
**Impact on plan:** All fixes necessary for compilation and test infrastructure. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations.

## User Setup Required
None - no external service configuration required. Model downloads automatically on first `kb index` run.

## Next Phase Readiness
- Embedding pipeline fully operational: generates and stores 256d vectors for all 5 entity types
- Phase 19 (semantic search) can use entity_embeddings table for KNN queries
- Query-time prefix should use "search_query: " (vs "search_document: " used at index time)
- isVecAvailable() gate ensures graceful degradation throughout

## Self-Check: PASSED

All 5 created/modified source files verified present. Both task commits (149281b, 2d50a17) verified in git log. 518 tests passing.

---
*Phase: 18-embedding-infrastructure*
*Completed: 2026-03-08*
