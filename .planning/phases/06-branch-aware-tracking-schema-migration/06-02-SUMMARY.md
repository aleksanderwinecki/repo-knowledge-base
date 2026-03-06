---
phase: 06-branch-aware-tracking-schema-migration
plan: 02
subsystem: indexer
tags: [git-plumbing, branch-aware, extractors, pipeline, metadata]

requires:
  - phase: 06-branch-aware-tracking-schema-migration
    plan: 01
    provides: "Schema v3 with default_branch column + 5 branch-aware git utility functions"
provides:
  - "Branch-aware indexing pipeline that reads from main/master, not working tree"
  - "Refactored extractors (elixir, proto, events) using git plumbing for file discovery and reading"
  - "Branch-aware metadata extraction with defaultBranch field"
  - "default_branch persistence in repos table via upsertRepo"
  - "Incremental skip logic comparing against branch commit, not HEAD"
affects: [phase-07, phase-08]

tech-stack:
  added: []
  patterns:
    - "Extractors use listBranchFiles + readBranchFile instead of fs for file discovery/reading"
    - "Pipeline resolves default branch before indexing; repos without main/master are skipped"
    - "LIB_PATH_PATTERNS regex array for matching Elixir lib paths in branch file lists"

key-files:
  created: []
  modified:
    - src/indexer/pipeline.ts
    - src/indexer/metadata.ts
    - src/indexer/elixir.ts
    - src/indexer/proto.ts
    - src/indexer/events.ts
    - src/indexer/writer.ts
    - tests/indexer/pipeline.test.ts
    - tests/indexer/writer.test.ts
    - tests/indexer/metadata.test.ts
    - tests/indexer/elixir.test.ts
    - tests/indexer/proto.test.ts
    - tests/indexer/events.test.ts

key-decisions:
  - "Extractors use shared LIB_PATH_PATTERNS regex for lib path matching (lib/, src/lib/, apps/X/lib/, src/apps/X/lib/)"
  - "events.ts sourceFile now uses branch-relative paths (not path.relative from absolute paths)"
  - "indexSingleRepo auto-resolves branch when called directly without branch param for backward compatibility"
  - "All existing fs-based extractor tests converted to git-repo-based tests to match new API"

patterns-established:
  - "Branch-aware extractors: accept (repoPath, branch) and use listBranchFiles + readBranchFile from git.ts"
  - "metadata.ts branch-aware path: separate functions (extractDescriptionFromBranch etc.) with shared parse logic"
  - "Pipeline resolves branch once in indexAllRepos, passes down to all extractors"

requirements-completed: [IDX2-01, IDX2-05]

duration: 7min
completed: 2026-03-06
---

# Phase 6 Plan 02: Branch-Aware Indexing Pipeline Summary

**Refactored all extractors and pipeline to read from main/master branch via git plumbing commands, eliminating filesystem working tree dependency for indexing**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-06T13:10:19Z
- **Completed:** 2026-03-06T13:18:02Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- All 4 extractors (elixir, proto, events, metadata) now read from git branch tree, not filesystem
- Pipeline resolves default branch (main/master) before indexing; repos without either are skipped with warning
- Incremental skip check compares against branch tip commit instead of HEAD -- feature branch commits don't trigger re-indexing
- default_branch column populated in repos table after indexing
- 263 tests passing (11 new tests added, existing tests converted to git-repo-based)

## Task Commits

Each task was committed atomically (TDD: test then implementation):

1. **Task 1: Refactor extractors and metadata for branch-aware content** (TDD)
   - `16e994b` test(06-02): add failing tests for branch-aware extractors and metadata
   - `ab8ea47` feat(06-02): refactor extractors and metadata for branch-aware content reading
2. **Task 2: Wire pipeline and writer for branch-aware indexing** (TDD)
   - `f676402` test(06-02): add failing tests for branch-aware pipeline and writer
   - `ef44e82` feat(06-02): wire pipeline and writer for branch-aware indexing

## Files Created/Modified
- `src/indexer/elixir.ts` - Uses listBranchFiles + readBranchFile instead of fs; removed findExFiles, collectFiles, SKIP_DIRS
- `src/indexer/proto.ts` - Same pattern as elixir; removed fs-based file discovery
- `src/indexer/events.ts` - Consumer detection reads .ex files from branch; accepts branch parameter
- `src/indexer/metadata.ts` - Branch-aware variants for description, tech stack, key files; adds defaultBranch to RepoMetadata
- `src/indexer/pipeline.ts` - resolveDefaultBranch before indexing; branch-based skip check; passes branch to all extractors
- `src/indexer/writer.ts` - upsertRepo persists default_branch column
- `tests/indexer/elixir.test.ts` - Converted extractElixirModules tests to git repos
- `tests/indexer/proto.test.ts` - Converted extractProtoDefinitions tests to git repos
- `tests/indexer/events.test.ts` - Converted all tests to git repos (signature changed to 4 args)
- `tests/indexer/metadata.test.ts` - Added 5 branch-aware metadata tests
- `tests/indexer/pipeline.test.ts` - Added 5 branch-aware pipeline tests (feature isolation, skip, detached HEAD)
- `tests/indexer/writer.test.ts` - Added default_branch persistence test

## Decisions Made
- **Shared LIB_PATH_PATTERNS regex:** Both elixir.ts and events.ts use the same regex patterns for lib path matching, replacing the old fs-based directory traversal with string matching on branch file paths.
- **indexSingleRepo backward compatibility:** When called without a branch parameter (e.g., from tests or direct usage), it auto-resolves the branch internally. This keeps the API flexible.
- **Full test conversion for events.ts:** Since the `detectEventRelationships` signature changed from 3 to 4 arguments (added branch), all 15 existing event tests had to be converted from fs-based mock repos to git-based repos. This is a larger change than planned but necessary for correctness.
- **events.ts sourceFile paths:** Now uses branch-relative paths directly (e.g., `lib/handler.ex`) instead of `path.relative(repoPath, absolutePath)`, since files come from `listBranchFiles` which already returns relative paths.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Converted all events.test.ts tests to git-based repos**
- **Found during:** Task 1 (events.ts refactor)
- **Issue:** `detectEventRelationships` signature changed from `(repoPath, protos, modules)` to `(repoPath, branch, protos, modules)`. All 15 existing tests used fs-based mock repos and the old 3-arg signature, causing compilation failures.
- **Fix:** Rewrote entire events.test.ts to use `setupGitRepo()` helper creating real git repos with committed files. Updated all call sites to pass `'main'` as branch argument.
- **Files modified:** tests/indexer/events.test.ts
- **Verification:** All 15 event tests pass with new git-based setup
- **Committed in:** ab8ea47

**2. [Rule 3 - Blocking] Added defaultBranch field to writer test makeMetadata helper**
- **Found during:** Task 2 (writer tests)
- **Issue:** `RepoMetadata` interface now requires `defaultBranch` field. The `makeMetadata()` helper in writer.test.ts didn't include it, causing type errors.
- **Fix:** Added `defaultBranch: null` to the makeMetadata default values
- **Files modified:** tests/indexer/writer.test.ts
- **Committed in:** f676402

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Both fixes necessary due to API signature changes. No scope creep -- just cascading test updates from the planned interface changes.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Branch-aware indexing pipeline fully operational
- `kb index` now always reads from main/master, never the working tree
- Schema v3 columns ready for Phase 7 (cross-repo edges) and Phase 8 (new extractors)
- All 263 tests passing -- full regression coverage maintained

## Self-Check: PASSED

- All 12 modified files verified present
- All 4 task commits verified in git log
- 263/263 tests passing
- No fs.readFileSync or fs.readdirSync in any extractor for file content/discovery
- RepoMetadata includes defaultBranch field
- default_branch column persisted in repos table

---
*Phase: 06-branch-aware-tracking-schema-migration*
*Completed: 2026-03-06*
