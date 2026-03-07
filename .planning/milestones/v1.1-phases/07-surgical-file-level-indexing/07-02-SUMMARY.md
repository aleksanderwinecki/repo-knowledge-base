---
phase: 07-surgical-file-level-indexing
plan: 02
subsystem: indexer
tags: [surgical-indexing, pipeline, incremental, diff-detection, fallback]

# Dependency graph
requires:
  - phase: 07-surgical-file-level-indexing
    plan: 01
    provides: "persistSurgicalData, clearRepoEdges, schema v4 with file_id FK"
provides:
  - "Surgical vs full branching in indexSingleRepo based on change analysis"
  - "IndexResult.mode field reporting actual indexing mode (full/surgical/skipped)"
  - "Automatic fallback to full mode for unreachable commits or large diffs"
  - "Edge recalculation repo-wide after surgical update"
affects: [cli, search, mcp-server]

# Tech tracking
tech-stack:
  added: []
  patterns: [surgical-pipeline-branching, diff-based-mode-selection, silent-fallback]

key-files:
  created: []
  modified:
    - src/indexer/pipeline.ts
    - tests/indexer/pipeline.test.ts

key-decisions:
  - "Extractors always run on ALL branch files (both modes); surgical filtering happens only at persistence layer"
  - "Surgical threshold: <=200 changed files AND <=50% of repo files; above triggers silent full fallback"
  - "Edges always re-derived from full extractor output after surgical persist (correctness over speed)"

patterns-established:
  - "Surgical pipeline pattern: detect changes -> run all extractors -> filter entities to changed files -> persist surgically -> re-derive edges"
  - "Silent fallback: large diffs and unreachable commits handled without user-visible behavior change"

requirements-completed: [IDX2-02, IDX2-03]

# Metrics
duration: 9min
completed: 2026-03-06
---

# Phase 7 Plan 2: Surgical Pipeline Integration Summary

**Surgical file-level re-indexing in indexSingleRepo with automatic fallback to full mode for large diffs and unreachable commits**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-06T14:46:08Z
- **Completed:** 2026-03-06T14:55:00Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- indexSingleRepo now branches into surgical vs full mode based on git diff analysis
- Surgical mode: only changed files' entities cleared and re-inserted via persistSurgicalData
- Automatic silent fallback to full mode when commit unreachable or diff exceeds thresholds (>200 files or >50% ratio)
- IndexResult.mode field reports actual mode used (full/surgical/skipped) across all paths
- Edges recalculated from ALL files after surgical update for correctness
- 11 new integration tests covering surgical modify/add/delete, equivalence, fallbacks, mode reporting, edge recalculation
- Full suite: 290 tests pass (up from 279)

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 RED: Failing tests for surgical indexing** - `c8157fb` (test)
2. **Task 1 GREEN: Implement surgical mode in pipeline** - `9de6f41` (feat)

## Files Created/Modified
- `src/indexer/pipeline.ts` - Added surgical vs full branching, mode field on IndexResult and indexSingleRepo return type, imports for persistSurgicalData and listBranchFiles
- `tests/indexer/pipeline.test.ts` - 11 new tests in `surgical indexing` describe block

## Decisions Made
- Extractors run on ALL branch files in both modes (not just changed files) because edge detection needs full context. Surgical filtering only at persistence layer.
- Surgical threshold: <=200 changed files AND <=50% of repo files. Above this, full mode is more efficient and avoids edge cases with large partial updates.
- Edges always re-derived repo-wide after surgical persist. This costs slightly more but ensures correctness -- per-file edge tracking would be fragile.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Surgical file-level indexing is fully operational
- Phase 7 complete: schema v4 (Plan 01) + pipeline integration (Plan 02)
- `kb index` automatically uses surgical mode for small changes, full mode for large changes or --force
- Ready for Phase 8 (EventCatalog integration) or Phase 9 (performance optimization)

## Self-Check: PASSED

All files verified present. Commits c8157fb and 9de6f41 confirmed in git log.

---
*Phase: 07-surgical-file-level-indexing*
*Completed: 2026-03-06*
