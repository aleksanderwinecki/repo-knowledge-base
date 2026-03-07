---
phase: 12-database-performance
plan: 03
subsystem: database
tags: [fts5, wal, perf_hooks, timing, cli, optimization]

# Dependency graph
requires:
  - phase: 12-01
    provides: "Pragma tuning and V5 migration with WAL mode"
provides:
  - "FTS5 optimize after bulk indexing for faster subsequent searches"
  - "WAL checkpoint(TRUNCATE) after bulk indexing to reclaim disk space"
  - "Shared timing utility (withTiming, withTimingAsync, reportTimings)"
  - "--timing flag on index, search, deps CLI commands"
affects: [cli, indexer, benchmarking]

# Tech tracking
tech-stack:
  added: [perf_hooks]
  patterns: [post-index-optimization, stderr-timing-instrumentation]

key-files:
  created:
    - src/cli/timing.ts
  modified:
    - src/indexer/pipeline.ts
    - src/cli/commands/index-cmd.ts
    - src/cli/commands/search.ts
    - src/cli/commands/deps.ts

key-decisions:
  - "FTS optimize is best-effort with try/catch -- non-critical failure does not break pipeline"
  - "Timing marks always collected (cheap), only reported when --timing flag is set"

patterns-established:
  - "Post-index optimization: FTS optimize + WAL checkpoint gated on success > 0"
  - "CLI timing pattern: wrap with withTiming/withTimingAsync, conditionally reportTimings to stderr"

requirements-completed: [PERF-04, PERF-05, PERF-07]

# Metrics
duration: 2min
completed: 2026-03-07
---

# Phase 12 Plan 03: FTS Optimize + WAL Checkpoint + CLI Timing Summary

**FTS5 optimize and WAL checkpoint after bulk indexing, plus perf_hooks --timing flag on index/search/deps commands**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-07T16:38:45Z
- **Completed:** 2026-03-07T16:40:56Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- FTS5 optimize compacts index segments after bulk indexing for faster subsequent searches
- WAL checkpoint(TRUNCATE) reclaims disk space after bulk writes
- New shared timing utility using node:perf_hooks with sync and async wrappers
- --timing flag on index, search, and deps commands outputs timing to stderr only
- All 437 existing tests pass, including Phase 11 CLI snapshot tests (no output changes)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add FTS optimize and WAL checkpoint to pipeline.ts** - `78fe8d6` (feat)
2. **Task 2: Add --timing flag with perf_hooks instrumentation to CLI commands** - `2fcb981` (feat)

## Files Created/Modified
- `src/indexer/pipeline.ts` - FTS optimize + WAL checkpoint after enrichFromEventCatalog
- `src/cli/timing.ts` - Shared timing utility (withTiming, withTimingAsync, reportTimings)
- `src/cli/commands/index-cmd.ts` - --timing flag, wraps indexAllRepos with withTimingAsync
- `src/cli/commands/search.ts` - --timing flag, wraps searchText/findEntity/listAvailableTypes with withTiming
- `src/cli/commands/deps.ts` - --timing flag, wraps queryDependencies with withTiming

## Decisions Made
- FTS optimize is best-effort with try/catch -- a failure in optimization should never fail the indexing pipeline
- Timing marks are always collected (performance.mark is cheap) but only reported when --timing is set, keeping the code path simple
- Did not add FTS optimize to indexSingleRepo (used by MCP auto-sync for 1-3 repos) -- optimize is only worthwhile after bulk indexing

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FTS optimize and WAL checkpoint are in place for benchmarking
- --timing flag enables before/after performance measurement for remaining Phase 12 work
- Ready for plan 12-02 (connection pooling / prepared statements) if not yet complete

## Self-Check: PASSED

All files and commits verified:
- src/cli/timing.ts: FOUND
- 12-03-SUMMARY.md: FOUND
- Commit 78fe8d6: FOUND
- Commit 2fcb981: FOUND

---
*Phase: 12-database-performance*
*Completed: 2026-03-07*
