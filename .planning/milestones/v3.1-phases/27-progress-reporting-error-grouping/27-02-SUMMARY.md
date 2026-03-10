---
phase: 27-progress-reporting-error-grouping
plan: 02
subsystem: indexer
tags: [pipeline-wiring, cli, progress-reporting, error-grouping, callbacks]

requires:
  - phase: 27-01
    provides: ProgressReporter, ErrorCollector, PipelineCallbacks from progress.ts
provides:
  - indexAllRepos with optional PipelineCallbacks parameter for live progress and deferred errors
  - CLI index command wired with ProgressReporter (stderr) and ErrorCollector
  - MCP reindex tool continues to work silently (no callbacks = no-op)
affects: []

tech-stack:
  added: []
  patterns: [optional-callbacks with null-propagation (callbacks?.progress?.update), stderr for progress/errors with stdout reserved for JSON]

key-files:
  created: []
  modified:
    - src/indexer/pipeline.ts
    - src/cli/commands/index-cmd.ts

key-decisions:
  - "Re-export PipelineCallbacks from pipeline.ts for convenience import"
  - "Keep success count computation for Event Catalog enrichment guard after removing summary console.log"

patterns-established:
  - "Optional callbacks pattern: pipeline functions accept optional callbacks, callers opt-in (CLI passes them, MCP does not)"

requirements-completed: [PROG-01, PROG-02, PROG-03, ERR-01, ERR-02, ERR-03]

duration: 3min
completed: 2026-03-10
---

# Phase 27 Plan 02: Pipeline Wiring Summary

**ProgressReporter and ErrorCollector wired into indexAllRepos with optional PipelineCallbacks, replacing 7 inline console calls with live counters and grouped error output**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T11:09:00Z
- **Completed:** 2026-03-10T11:12:02Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Replaced all 7 console.log/warn/error calls in the indexing pipeline with optional callback invocations
- CLI index command creates ProgressReporter (stderr) and ErrorCollector, passes them to indexAllRepos
- MCP reindex tool remains completely unaffected -- no third arg means all callbacks?.X calls are no-ops
- Full test suite (695 tests) passes with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PipelineCallbacks to indexAllRepos and replace all console output** - `4838c48` (feat)
2. **Task 2: Wire ProgressReporter and ErrorCollector in CLI index command** - `ee1e16b` (feat)

## Files Created/Modified
- `src/indexer/pipeline.ts` - Added optional PipelineCallbacks third parameter, replaced 7 console output points with callback invocations, re-exported PipelineCallbacks type
- `src/cli/commands/index-cmd.ts` - Creates ProgressReporter/ErrorCollector, passes to indexAllRepos, prints error summary to stderr after completion

## Decisions Made
- Re-exported PipelineCallbacks type from pipeline.ts so consumers can import from either progress.ts or pipeline.ts
- Kept the `success` count computation (previously derived alongside the removed summary log) since it guards Event Catalog enrichment and FTS optimization

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved success count for enrichment guard**
- **Found during:** Task 1
- **Issue:** Removing the summary console.log also removed the `success`/`skipped`/`errors` count computation, but `success` is used by the Event Catalog enrichment and FTS optimize guards below
- **Fix:** Re-added `const success = results.filter(...)` after the progress.finish() call
- **Files modified:** src/indexer/pipeline.ts
- **Verification:** Build passes, all 695 tests pass
- **Committed in:** 4838c48 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary for correctness -- without the success count, enrichment would never run.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 27 is complete: both progress reporting and error grouping are fully wired
- `kb index` now shows TTY-aware live counters and grouped error summaries
- MCP tool operates silently as before

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 27-progress-reporting-error-grouping*
*Completed: 2026-03-10*
