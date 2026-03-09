---
phase: 22-fixes-metadata
plan: 01
subsystem: indexer
tags: [pipeline, scanner, symlinks, ux-fix]

# Dependency graph
requires:
  - phase: none
    provides: existing indexer pipeline and scanner
provides:
  - "Implicit force when --repo flag is set (targeted reindex always re-indexes)"
  - "Symlink-aware repo discovery in scanner"
affects: [indexer, cli]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Symlink resolution with statSync fallback for broken links"
    - "Options-based guard bypass (repos implies force)"

key-files:
  created: []
  modified:
    - src/indexer/pipeline.ts
    - src/indexer/scanner.ts
    - src/cli/commands/docs.ts
    - tests/indexer/pipeline.test.ts
    - tests/indexer/scanner.test.ts

key-decisions:
  - "options.repos?.length check added alongside options.force to bypass staleness"
  - "isSymbolicLink() check added before isDirectory() with statSync resolution"

patterns-established:
  - "Targeted reindex always bypasses skip check"

requirements-completed: [FIX-01, FIX-02]

# Metrics
duration: 4min
completed: 2026-03-09
---

# Phase 22 Plan 01: Indexer UX Fixes Summary

**Implicit force for --repo targeted reindex and symlink-aware repo discovery in scanner**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-09T10:34:02Z
- **Completed:** 2026-03-09T10:38:00Z
- **Tasks:** 1 (TDD: red, green)
- **Files modified:** 5

## Accomplishments
- `kb index --repo foo` always re-indexes without needing `--force` (staleness check bypassed)
- Scanner discovers repos that are symlinks under the root directory
- Broken/dangling symlinks are silently skipped (no crashes)
- Documentation updated to reflect `--repo` always re-indexes
- 506 tests pass (3 new: implicit force, symlink discovery, broken symlink handling)

## Task Commits

Each task was committed atomically:

1. **Task 1: Implicit force for --repo and symlink support in scanner**
   - `8fa72e6` (test: failing tests for implicit force and symlink support)
   - `40ff79f` (feat: implementation passing all tests)

## Files Created/Modified
- `src/indexer/pipeline.ts` - Added `!options.repos?.length` guard to bypass staleness check for targeted reindex
- `src/indexer/scanner.ts` - Added `isSymbolicLink()` check with `statSync` resolution for symlinked repos
- `src/cli/commands/docs.ts` - Added `--repo` usage example documenting implicit force behavior
- `tests/indexer/pipeline.test.ts` - New test: --repo bypasses staleness check
- `tests/indexer/scanner.test.ts` - New tests: symlinked repos discovered, broken symlinks ignored

## Decisions Made
- Used `options.repos?.length` alongside `options.force` in the guard condition (simple, no behavior change for full index)
- Symlink resolution uses `statSync` with try/catch for broken links (consistent with existing fs error handling patterns)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Both UX fixes complete and tested
- Build passes with no TypeScript errors

---
*Phase: 22-fixes-metadata*
*Completed: 2026-03-09*
