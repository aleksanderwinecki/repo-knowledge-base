---
phase: 27-progress-reporting-error-grouping
plan: 01
subsystem: indexer
tags: [tty, progress-reporting, error-handling, streams]

requires:
  - phase: none
    provides: standalone foundation module
provides:
  - ProgressReporter class with TTY-aware in-place counter
  - ErrorCollector class with categorized git error grouping
  - PipelineCallbacks interface for pipeline wiring
  - ErrorCategory and CollectedError types
affects: [27-02-pipeline-wiring]

tech-stack:
  added: []
  patterns: [stream-injection for testability, mock WriteStream pattern]

key-files:
  created:
    - src/indexer/progress.ts
    - tests/indexer/progress-reporter.test.ts
  modified: []

key-decisions:
  - "Separate refreshErrors/indexErrors arrays instead of single errors array with flag -- cleaner printSummary grouping"
  - "classifyGitError as module-private function -- only ErrorCollector needs it"

patterns-established:
  - "Mock WriteStream pattern: createMockStream(isTTY) with tracked writes/calls arrays for TTY testing"

requirements-completed: [PROG-01, PROG-02, PROG-03, ERR-01, ERR-02]

duration: 2min
completed: 2026-03-10
---

# Phase 27 Plan 01: ProgressReporter & ErrorCollector Summary

**TTY-aware ProgressReporter with in-place counters and ErrorCollector with 4-category git error classification and grouped summary output**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T11:04:24Z
- **Completed:** 2026-03-10T11:06:37Z
- **Tasks:** 1 (TDD: RED + GREEN + REFACTOR)
- **Files modified:** 2

## Accomplishments
- ProgressReporter handles TTY (clearLine/cursorTo) and non-TTY (plain newlines) output modes
- ErrorCollector classifies git errors into worktree_conflict, dirty_tree, timeout, and other categories
- printSummary produces grouped output with per-category counts and per-repo details
- PipelineCallbacks interface exported for Plan 02 pipeline wiring
- 23 unit tests covering all specified behaviors

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests** - `44fc8d1` (test)
2. **Task 1 GREEN: Implementation** - `2744439` (feat)

_TDD task: test-first then implementation._

## Files Created/Modified
- `src/indexer/progress.ts` - ProgressReporter, ErrorCollector, PipelineCallbacks, types
- `tests/indexer/progress-reporter.test.ts` - 23 unit tests covering TTY/non-TTY progress and error categorization

## Decisions Made
- Separate `refreshErrors` and `indexErrors` arrays instead of a single array with flags -- produces cleaner grouping logic in `printSummary`
- `classifyGitError` kept as module-private function since only `ErrorCollector` needs it

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- `ProgressReporter` and `ErrorCollector` ready for Plan 02 to wire into the indexing pipeline
- `PipelineCallbacks` interface provides the integration surface
- All 695 tests pass (23 new + 672 existing)

## Self-Check: PASSED

All artifacts verified:
- src/indexer/progress.ts: FOUND
- tests/indexer/progress-reporter.test.ts: FOUND
- 27-01-SUMMARY.md: FOUND
- Commit 44fc8d1 (RED): FOUND
- Commit 2744439 (GREEN): FOUND

---
*Phase: 27-progress-reporting-error-grouping*
*Completed: 2026-03-10*
