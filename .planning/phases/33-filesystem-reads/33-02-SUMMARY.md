---
phase: 33-filesystem-reads
plan: 02
subsystem: indexer
tags: [filesystem, pipeline, git, extractors, working-tree]

# Dependency graph
requires:
  - phase: 33-filesystem-reads/33-01
    provides: "Branch-free extractors using listWorkingTreeFiles/readWorkingTreeFile"
provides:
  - "Pipeline wired to filesystem-based extractors without branch parameter"
  - "Dead git functions (listBranchFiles, readBranchFile) removed"
  - "All tests updated for working tree semantics"
  - "Zero execSync('git show') or execSync('git ls-tree') calls in codebase"
affects: [indexing-performance, reindex-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Pipeline reads from working tree via fs, uses git only for refresh/skip-check"]

key-files:
  created: []
  modified:
    - "src/indexer/pipeline.ts"
    - "src/indexer/git.ts"
    - "tests/indexer/git.test.ts"
    - "tests/indexer/pipeline.test.ts"
    - "tests/indexer/metadata.test.ts"
    - "tests/indexer/gateway.test.ts"
    - "tests/indexer/topology.test.ts"
    - "tests/indexer/elixir.test.ts"
    - "tests/indexer/events.test.ts"
    - "tests/indexer/proto.test.ts"

key-decisions:
  - "Use 'HEAD' ref for incremental change detection instead of named branch"
  - "defaultBranch field now always null (metadata no longer resolves branch)"
  - "Branch-aware tests rewritten to working-tree semantics (feature branch files visible on disk)"

patterns-established:
  - "Pipeline extraction path: no branch parameter, reads working tree directly"
  - "Git operations only for: refresh (fetch+reset), skip-check (branch commit comparison), incremental diff"

requirements-completed: [FS-04, COR-01, COR-02, COR-03]

# Metrics
duration: 13min
completed: 2026-03-10
---

# Phase 33 Plan 02: Pipeline & Tests Summary

**Pipeline wired to branch-free filesystem extractors, dead git functions removed, all 779 tests passing**

## Performance

- **Duration:** 13 min
- **Started:** 2026-03-10T16:05:55Z
- **Completed:** 2026-03-10T16:19:16Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Pipeline no longer passes branch to any extractor -- all read from working tree via fs
- Removed listBranchFiles and readBranchFile from git.ts, eliminating all `git show`/`git ls-tree` spawns
- Updated 8 test files across extractors, pipeline, and git utilities
- All 779 tests pass, TypeScript compiles clean, build succeeds

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor pipeline.ts to drop branch from extraction path** - `5a098b0` (feat)
2. **Task 2: Update all tests and verify full suite passes** - `e2f7af2` (test)

## Files Created/Modified
- `src/indexer/pipeline.ts` - Removed branch from WorkItem, extractRepoData, indexSingleRepo; replaced listBranchFiles with listWorkingTreeFiles
- `src/indexer/git.ts` - Deleted listBranchFiles and readBranchFile functions; cleaned stale comment
- `tests/indexer/git.test.ts` - Replaced branch function tests with listWorkingTreeFiles/readWorkingTreeFile tests
- `tests/indexer/gateway.test.ts` - Updated mocks and extractor calls to working tree functions
- `tests/indexer/topology.test.ts` - Updated mocks and extractor calls to working tree functions
- `tests/indexer/metadata.test.ts` - Rewrote branch-aware section as working-tree tests
- `tests/indexer/pipeline.test.ts` - Updated branch isolation and default_branch tests for working tree semantics
- `tests/indexer/elixir.test.ts` - Removed branch arg from extractElixirModules calls, updated isolation test
- `tests/indexer/events.test.ts` - Removed branch arg from detectEventRelationships calls, updated isolation test
- `tests/indexer/proto.test.ts` - Removed branch arg from extractProtoDefinitions calls, updated isolation test

## Decisions Made
- Used 'HEAD' as the target ref for `getChangedFilesSinceBranch` in incremental mode. After `--refresh`, HEAD equals the default branch tip, so this is correct.
- `defaultBranch` in metadata is now always null since `extractMetadata` no longer resolves branches. This is acceptable because the field was informational only.
- Branch-aware test semantics changed: tests that previously asserted "ignores feature branch files" now assert "sees all files in working tree" since that's the correct filesystem behavior.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed additional test files not listed in plan**
- **Found during:** Task 2 (Test updates)
- **Issue:** Plan only listed 5 test files, but `elixir.test.ts`, `events.test.ts`, and `proto.test.ts` also passed branch args to extractors
- **Fix:** Updated all three files: removed branch args, rewrote branch-isolation tests for working-tree semantics
- **Files modified:** tests/indexer/elixir.test.ts, tests/indexer/events.test.ts, tests/indexer/proto.test.ts
- **Verification:** All 779 tests pass
- **Committed in:** e2f7af2 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug: incomplete file list in plan)
**Impact on plan:** Necessary for test suite to pass. No scope creep.

## Issues Encountered
None -- all changes were straightforward signature updates and test rewrites.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Filesystem reads refactor is complete across all extractors and the pipeline
- The indexing pipeline no longer spawns `git show` or `git ls-tree` child processes
- Ready for performance benchmarking to measure the speedup from eliminating process spawning

## Self-Check: PASSED

All 10 modified files verified on disk. Both task commits (5a098b0, e2f7af2) verified in git log.

---
*Phase: 33-filesystem-reads*
*Completed: 2026-03-10*
