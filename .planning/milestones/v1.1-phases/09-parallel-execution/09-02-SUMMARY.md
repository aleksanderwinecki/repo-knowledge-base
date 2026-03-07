---
phase: 09-parallel-execution
plan: 02
subsystem: testing
tags: [parallel-indexing, concurrency, error-isolation, vitest, kb-concurrency]

# Dependency graph
requires:
  - phase: 09-parallel-execution
    plan: 01
    provides: "Async indexAllRepos with parallel extraction, KB_CONCURRENCY env var, Promise.allSettled isolation"
provides:
  - "Parallel indexing test suite covering concurrency, consistency, error isolation, config"
  - "DB consistency proof: sequential vs parallel produce identical state"
  - "Error isolation proof: sabotaged repo doesn't prevent others"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [db-reset-for-consistency-comparison, env-var-save-restore-in-tests]

key-files:
  created: []
  modified:
    - tests/indexer/pipeline.test.ts

key-decisions:
  - "Error isolation test uses directory-to-file replacement sabotage since pipeline is resilient to git corruption"
  - "DB consistency test uses close/reopen cycle for clean comparison between sequential and parallel runs"

patterns-established:
  - "KB_CONCURRENCY env save/restore in beforeEach/afterEach for test isolation"

requirements-completed: [IDX2-04]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 09 Plan 02: Parallel Indexing Tests Summary

**5-test suite proving DB consistency, error isolation, sequential fallback, default concurrency, and async signature for parallel indexAllRepos**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T10:52:27Z
- **Completed:** 2026-03-07T10:55:57Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added 5 parallel indexing tests covering all IDX2-04 sub-requirements
- Proved sequential (KB_CONCURRENCY=1) and parallel (KB_CONCURRENCY=3) produce identical DB state for modules, events, and repos
- Proved error isolation: sabotaged repo directory doesn't prevent good repos from indexing
- Verified sequential fallback (KB_CONCURRENCY=1) and default concurrency (no env var) both work
- Full suite green: 360 tests (355 baseline + 5 new), zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add parallel indexing test suite** - `0f3c9fa` (test)

## Files Created/Modified
- `tests/indexer/pipeline.test.ts` - Added `describe('parallel indexing')` block with 5 tests after existing surgical indexing tests

## Decisions Made
- Error isolation test uses directory-to-file replacement (same pattern as existing IDX-07 test) rather than git object corruption, since the pipeline gracefully handles corrupted git repos without erroring
- DB consistency test uses closeDatabase + unlinkSync + openDatabase cycle for a truly clean comparison between sequential and parallel runs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Adjusted error isolation sabotage strategy**
- **Found during:** Task 1 (parallel indexing tests)
- **Issue:** Plan specified deleting `.git` directory to sabotage bad-repo, but `discoverRepos` requires `.git` to exist -- repo was never discovered. Tried corrupting git objects instead, but pipeline gracefully handles corrupted repos (returns 0 modules, still succeeds).
- **Fix:** Used directory-to-file replacement sabotage (same pattern as existing IDX-07 test), which causes extraction to fail at the filesystem level
- **Files modified:** tests/indexer/pipeline.test.ts
- **Verification:** All 5 parallel tests pass, error isolation proven
- **Committed in:** 0f3c9fa (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test strategy)
**Impact on plan:** Necessary adjustment to match actual pipeline behavior. Error isolation is still proven.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 9 (Parallel Execution) is fully complete
- All parallel indexing behavior is tested and verified
- v1.1 milestone is complete

---
*Phase: 09-parallel-execution*
*Completed: 2026-03-07*
