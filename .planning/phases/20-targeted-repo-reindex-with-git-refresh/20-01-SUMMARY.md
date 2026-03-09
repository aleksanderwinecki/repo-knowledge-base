---
phase: 20-targeted-repo-reindex-with-git-refresh
plan: 01
subsystem: indexer
tags: [git, cli, pipeline, reindex, targeted]

# Dependency graph
requires:
  - phase: 16-parallel-index-pipeline
    provides: indexAllRepos pipeline with parallel extraction
provides:
  - gitRefresh() function for fetch+reset to latest on default branch
  - IndexOptions.repos for targeted repo filtering
  - IndexOptions.refresh for git refresh before indexing
  - CLI --repo and --refresh flags
affects: [20-02-mcp-reindex-tool]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "gitRefresh pattern: fetch origin, checkout default branch if clean, reset --hard"
    - "Targeted filtering: discoverRepos + Set-based name filter with missing-repo warnings"

key-files:
  created: []
  modified:
    - src/indexer/git.ts
    - src/indexer/pipeline.ts
    - src/cli/commands/index-cmd.ts
    - tests/indexer/git.test.ts
    - tests/indexer/pipeline.test.ts

key-decisions:
  - "gitRefresh uses fetch+reset (not pull) to avoid merge conflicts"
  - "Refresh step runs before Phase 1 so pipeline sees updated branch tips"
  - "--repo and --refresh are independent flags (composable, not coupled)"

patterns-established:
  - "gitRefresh: fetch origin with 30s timeout, check dirty tree before branch switch, reset --hard origin/<branch>"

requirements-completed: [RIDX-01, RIDX-02, RIDX-03, RIDX-04]

# Metrics
duration: 4min
completed: 2026-03-09
---

# Phase 20 Plan 01: Targeted Repo Reindex with Git Refresh Summary

**gitRefresh() with error handling + --repo/--refresh CLI flags for targeted reindex of specific repos with optional git fetch+reset**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-09T09:07:09Z
- **Completed:** 2026-03-09T09:10:48Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- gitRefresh() handles happy path (fetch+reset), no-remote, dirty-tree, already-on-branch, and clean-feature-branch scenarios
- `kb index --repo foo bar` only indexes named repos from discoverRepos output, with warnings for missing repos
- `kb index --refresh` runs gitRefresh for each repo before extraction, ensuring pipeline sees latest code
- 8 new tests (5 unit for gitRefresh, 3 integration for targeted indexing), all 68 combined tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: gitRefresh() function with error handling** - `613ecc1` (test: RED) -> `40d0baf` (feat: GREEN)
2. **Task 2: Targeted repo filtering, refresh wiring, CLI flags** - `00bfc36` (test: RED) -> `343900c` (feat: GREEN)

_TDD tasks have separate test and implementation commits._

## Files Created/Modified
- `src/indexer/git.ts` - Added gitRefresh() with fetch/checkout/reset and error handling
- `src/indexer/pipeline.ts` - Added repos/refresh to IndexOptions, filtering and refresh steps before Phase 1
- `src/cli/commands/index-cmd.ts` - Added --repo and --refresh CLI options
- `tests/indexer/git.test.ts` - 5 new gitRefresh test cases with bare+clone helper
- `tests/indexer/pipeline.test.ts` - 3 new targeted indexing integration tests

## Decisions Made
- gitRefresh uses fetch+reset (not pull) to avoid merge conflicts on default branch
- Refresh step placed before Phase 1 pipeline loop so commit comparison sees updated branch tips
- --repo and --refresh are independent composable flags -- --repo alone reindexes as-is, --refresh alone refreshes all repos
- Used `git init --bare --initial-branch=main` in test helper for reliable bare repo setup

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed bare repo test helper for default branch name**
- **Found during:** Task 1 (RED phase)
- **Issue:** `git push origin main` failed because bare repo defaulted to `master` branch
- **Fix:** Added `--initial-branch=main` to bare init and `git branch -M main` before push
- **Files modified:** tests/indexer/git.test.ts
- **Verification:** All 5 gitRefresh tests pass
- **Committed in:** 613ecc1 (part of RED commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minor test infrastructure fix. No scope creep.

## Issues Encountered
None beyond the bare repo branch naming fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- gitRefresh() and targeted indexing are ready for MCP tool wiring in plan 20-02
- IndexOptions interface extended and exported for MCP consumption

## Self-Check: PASSED

All 5 modified files exist. All 4 commit hashes verified.

---
*Phase: 20-targeted-repo-reindex-with-git-refresh*
*Completed: 2026-03-09*
