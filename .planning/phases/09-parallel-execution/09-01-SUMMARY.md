---
phase: 09-parallel-execution
plan: 01
subsystem: indexer
tags: [p-limit, promise-allsettled, concurrency, parallel-extraction, async]

# Dependency graph
requires:
  - phase: 08-new-extractors
    provides: "Full extractor pipeline with Elixir, proto, GraphQL, Ecto, Absinthe, gRPC, EventCatalog"
provides:
  - "Async indexAllRepos with parallel extraction and serial persistence"
  - "extractRepoData pure function (no DB dependency)"
  - "persistExtractedData function (DB writes only)"
  - "KB_CONCURRENCY env var for concurrency control"
  - "withDbAsync helper for async CLI commands"
affects: [09-parallel-execution]

# Tech tracking
tech-stack:
  added: [p-limit]
  patterns: [parallel-extract-serial-persist, three-phase-pipeline, promise-allsettled-isolation]

key-files:
  created: []
  modified:
    - src/indexer/pipeline.ts
    - src/cli/db.ts
    - src/cli/commands/index-cmd.ts
    - package.json
    - tests/indexer/pipeline.test.ts
    - tests/cli/commands.test.ts

key-decisions:
  - "p-limit v7 for ESM-native concurrency control (project is ESM-only)"
  - "Three-phase pipeline: sequential DB prep, parallel extraction, serial persistence"
  - "extractRepoData takes dbSnapshot instead of DB handle for thread safety"
  - "indexSingleRepo unchanged for MCP sync backward compatibility"

patterns-established:
  - "Parallel-extract-serial-persist: separate CPU-bound extraction from DB-bound writes"
  - "DbSnapshot pattern: snapshot DB state before parallel phase to avoid concurrent reads"

requirements-completed: [IDX2-04]

# Metrics
duration: 6min
completed: 2026-03-07
---

# Phase 09 Plan 01: Parallel Extraction Pipeline Summary

**Async indexAllRepos with p-limit concurrency, Promise.allSettled failure isolation, and extractRepoData/persistExtractedData split**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-07T10:43:21Z
- **Completed:** 2026-03-07T10:49:29Z
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Refactored indexAllRepos into 3-phase async pipeline: sequential DB prep -> parallel extraction -> serial persistence
- Created extractRepoData (pure extraction, no DB) and persistExtractedData (DB writes only) functions
- Added KB_CONCURRENCY env var (default 4) to control concurrency; KB_CONCURRENCY=1 for sequential behavior
- All 355 existing tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Install p-limit and create extractRepoData / persistExtractedData split** - `25881fc` (feat)
2. **Task 2: Wire async CLI and update withDb helper** - `acd2c5d` (feat)
3. **Task 3: Update existing tests for async indexAllRepos** - `ac131fc` (test)

## Files Created/Modified
- `src/indexer/pipeline.ts` - Async indexAllRepos with extractRepoData/persistExtractedData split, p-limit, Promise.allSettled
- `src/cli/db.ts` - Added withDbAsync helper for async callbacks
- `src/cli/commands/index-cmd.ts` - Async CLI action using withDbAsync + await indexAllRepos
- `package.json` - Added p-limit dependency
- `tests/indexer/pipeline.test.ts` - All indexAllRepos calls now use async/await
- `tests/cli/commands.test.ts` - CLI index test updated to use withDbAsync

## Decisions Made
- Used p-limit v7 (ESM-native) since project is ESM-only
- extractRepoData takes a DbSnapshot (repoId + lastCommit) instead of a DB handle, keeping all DB reads in the sequential Phase 1
- indexSingleRepo remains completely unchanged for MCP sync backward compatibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed CLI commands test for async indexAllRepos**
- **Found during:** Task 3 (Update existing tests)
- **Issue:** `tests/cli/commands.test.ts` called indexAllRepos synchronously via withDb, getting a Promise object instead of results
- **Fix:** Changed test to use withDbAsync and async/await
- **Files modified:** tests/cli/commands.test.ts
- **Verification:** All 355 tests pass
- **Committed in:** ac131fc (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary fix for test that also called indexAllRepos. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Parallel extraction pipeline is complete and tested
- Ready for Plan 02 (concurrency-specific tests: failure isolation, KB_CONCURRENCY behavior)

---
*Phase: 09-parallel-execution*
*Completed: 2026-03-07*
