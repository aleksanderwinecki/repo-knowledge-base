---
phase: 14-core-layer-dedup
plan: 03
subsystem: indexer
tags: [pipeline, deduplication, async, refactoring, indexSingleRepo]

# Dependency graph
requires:
  - phase: 14-core-layer-dedup
    provides: "Writer insert helpers (14-02) and hydration consolidation (14-01)"
  - phase: 13-mcp-dedup
    provides: "knowledge/store.ts unified FTS path via db/fts.ts (CORE-02 pre-satisfied)"
provides:
  - "Unified indexSingleRepo delegating to extractRepoData + persistExtractedData"
  - "Single code path for extraction, persistence, and edge insertion"
  - "Async checkAndSyncRepos and withAutoSync in sync.ts"
affects: [14-core-layer-dedup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "indexSingleRepo as thin async wrapper over extractRepoData + persistExtractedData"
    - "wrapToolHandler accepts sync or async inner handlers"

key-files:
  created: []
  modified:
    - src/indexer/pipeline.ts
    - src/mcp/sync.ts
    - src/mcp/handler.ts
    - src/mcp/tools/search.ts
    - src/mcp/tools/entity.ts
    - src/mcp/tools/deps.ts

key-decisions:
  - "Made indexSingleRepo async rather than creating sync extraction wrapper -- minimal-change path since all callers handle promises"
  - "Updated wrapToolHandler to accept string | Promise<string> so MCP tool handlers can use async withAutoSync"

patterns-established:
  - "indexSingleRepo delegates to extractRepoData + persistExtractedData (same path as indexAllRepos)"
  - "Edge insertion (event, gRPC, Ecto) has exactly one call site: persistExtractedData"

requirements-completed: [CORE-01, CORE-02, CORE-08]

# Metrics
duration: 4min
completed: 2026-03-07
---

# Phase 14 Plan 03: Pipeline Unification Summary

**Unified indexSingleRepo as thin async wrapper delegating to extractRepoData + persistExtractedData, eliminating ~165 lines of duplicated extraction/persistence/edge logic**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-07T18:09:56Z
- **Completed:** 2026-03-07T18:14:46Z
- **Tasks:** 1
- **Files modified:** 8 (6 source + 2 test)

## Accomplishments
- Replaced ~190-line inline indexSingleRepo with ~28-line delegation to extractRepoData + persistExtractedData
- Edge insertion (insertEventEdges, insertGrpcClientEdges, insertEctoAssociationEdges) now has exactly one call path through persistExtractedData
- Made checkAndSyncRepos and withAutoSync async in sync.ts to handle async indexSingleRepo
- Updated wrapToolHandler to accept sync or async handlers for MCP tool compatibility
- Verified CORE-02 pre-satisfied: knowledge/store.ts imports and uses indexEntity/removeEntity from db/fts.ts
- All 440 tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Unify indexSingleRepo to delegate to extractRepoData + persistExtractedData** - `5cac667` (refactor)

**Plan metadata:** [pending] (docs: complete plan)

## Files Created/Modified
- `src/indexer/pipeline.ts` - Replaced ~190-line indexSingleRepo with ~28-line async wrapper delegating to extractRepoData + persistExtractedData
- `src/mcp/sync.ts` - Made checkAndSyncRepos and withAutoSync async; await indexSingleRepo
- `src/mcp/handler.ts` - wrapToolHandler accepts sync or async handlers (string | Promise<string>)
- `src/mcp/tools/search.ts` - Async handler, await withAutoSync
- `src/mcp/tools/entity.ts` - Async handler, await withAutoSync
- `src/mcp/tools/deps.ts` - Async handler, await withAutoSync
- `tests/indexer/pipeline.test.ts` - All 42 test callbacks async, await indexSingleRepo calls
- `tests/mcp/sync.test.ts` - All 6 test callbacks async, await checkAndSyncRepos calls

## Decisions Made
- Made indexSingleRepo async rather than creating a sync extraction wrapper -- all callers already run in async contexts (MCP handlers, CLI async functions), so this is the minimal-change path
- Updated wrapToolHandler to accept `string | Promise<string>` return type so MCP tool inner handlers can be async when using withAutoSync
- Did NOT move edge functions from pipeline.ts to writer.ts -- CORE-08 is satisfied by single call path, moving is cosmetic churn

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated wrapToolHandler to support async inner handlers**
- **Found during:** Task 1 (updating MCP tool handlers)
- **Issue:** wrapToolHandler only accepted `(args: Args) => string` but MCP tools now need `async` handlers to await withAutoSync
- **Fix:** Changed handler type to `(args: Args) => string | Promise<string>` and added `await` in the outer wrapper
- **Files modified:** src/mcp/handler.ts
- **Verification:** All 59 MCP tests pass
- **Committed in:** 5cac667

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary for async propagation. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pipeline fully unified: both indexSingleRepo and indexAllRepos use the same extractRepoData + persistExtractedData path
- CORE-01, CORE-02, CORE-08 all satisfied
- Phase 14 complete pending remaining plans (if any)

## Self-Check: PASSED

All files and commits verified.

---
*Phase: 14-core-layer-dedup*
*Completed: 2026-03-07*
