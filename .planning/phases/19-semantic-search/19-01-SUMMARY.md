---
phase: 19-semantic-search
plan: 01
subsystem: search
tags: [vector-search, knn, rrf, semantic-search, sqlite-vec, embeddings]

requires:
  - phase: 18-embedding-infrastructure
    provides: vec0 table, generateEmbedding, isVecAvailable, MATRYOSHKA_DIM
provides:
  - generateQueryEmbedding with search_query: prefix
  - searchSemantic KNN vector similarity search with graceful degradation
  - searchHybrid RRF merge of FTS5 + KNN with k=60
  - withAutoSyncAsync for MCP async query functions
affects: [19-02 CLI/MCP wiring, future search quality tuning]

tech-stack:
  added: []
  patterns: [RRF scoring k=60, post-hydration repo filtering, distance-to-relevance 1/(1+d)]

key-files:
  created:
    - src/search/semantic.ts
    - src/search/hybrid.ts
    - tests/search/semantic.test.ts
    - tests/search/hybrid.test.ts
  modified:
    - src/embeddings/pipeline.ts
    - src/search/index.ts
    - src/mcp/sync.ts

key-decisions:
  - "RRF k=60 constant per original paper, 1-indexed ranks via 1/(k+i+1)"
  - "FTS-only degradation preserves original FTS relevance scores (no RRF wrapping)"
  - "searchSemantic fetches limit*2 from KNN to allow for post-hydration filtering"

patterns-established:
  - "Graceful degradation: searchSemantic returns [] when vec unavailable or embeddings empty"
  - "searchHybrid degrades to FTS-only when vector leg returns nothing"
  - "Mock embeddings in tests: synthetic Float32Arrays via fakeVec(seed) with L2 normalization"

requirements-completed: [SEM-04, SEM-05, SEM-06]

duration: 5min
completed: 2026-03-08
---

# Phase 19 Plan 01: Semantic & Hybrid Search Core Summary

**KNN vector similarity search via searchSemantic, RRF hybrid merge via searchHybrid (k=60), and search_query: prefix for generateQueryEmbedding**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-08T19:13:02Z
- **Completed:** 2026-03-08T19:18:15Z
- **Tasks:** 2 (TDD, 4 commits)
- **Files modified:** 7

## Accomplishments
- searchSemantic performs KNN vector similarity via vec0, converts distance to relevance, degrades gracefully
- searchHybrid merges FTS5 + KNN using Reciprocal Rank Fusion with k=60 and deduplication
- generateQueryEmbedding uses search_query: prefix (vs search_document: for indexing)
- withAutoSyncAsync handles async query functions for MCP tool integration
- 17 new tests, 535 total tests passing, TypeScript compiles clean

## Task Commits

Each task was committed atomically (TDD: RED then GREEN):

1. **Task 1: generateQueryEmbedding + searchSemantic**
   - `16eb620` (test) - failing tests for semantic search
   - `9e1a3cf` (feat) - implement generateQueryEmbedding and searchSemantic
2. **Task 2: searchHybrid + withAutoSyncAsync + exports**
   - `727d3c0` (test) - failing tests for hybrid search
   - `24f1a6a` (feat) - implement searchHybrid with RRF and withAutoSyncAsync

## Files Created/Modified
- `src/embeddings/pipeline.ts` - Added generateQueryEmbedding with search_query: prefix
- `src/search/semantic.ts` - KNN vector similarity search with graceful degradation
- `src/search/hybrid.ts` - RRF hybrid merge of FTS5 + KNN results
- `src/search/index.ts` - Added searchSemantic and searchHybrid exports
- `src/mcp/sync.ts` - Added withAutoSyncAsync for async query functions
- `tests/search/semantic.test.ts` - 9 tests: KNN search, degradation, filters, hydration
- `tests/search/hybrid.test.ts` - 8 tests: RRF merge, dedup, degradation, limits, rank formula

## Decisions Made
- RRF k=60 per the original paper; 1-indexed ranks: score = 1/(k + i + 1) for loop index i
- FTS-only degradation path returns raw FTS results (preserves original relevance, no RRF wrapping)
- searchSemantic over-fetches (limit*2) to compensate for post-hydration filtering losses
- vec0 entity_id parsed with parseInt since vec0 stores text IDs (consistent with 18-02 decision)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- vi.mock factory hoisting: Cannot reference outer functions using mocked module's exports. Fixed by duplicating fakeVec logic inside the mock factory.
- vi.doMock for vec unavailability test: Required vi.resetModules() to clear module cache before re-mocking.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- searchSemantic and searchHybrid exported and ready for Plan 02's CLI/MCP wiring
- withAutoSyncAsync ready for MCP hybrid search tool
- All graceful degradation paths tested and working

## Self-Check: PASSED

All 4 created files verified. All 4 commits verified.

---
*Phase: 19-semantic-search*
*Completed: 2026-03-08*
