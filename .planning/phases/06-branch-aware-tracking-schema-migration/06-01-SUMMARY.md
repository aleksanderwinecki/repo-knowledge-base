---
phase: 06-branch-aware-tracking-schema-migration
plan: 01
subsystem: database, indexer
tags: [sqlite, migrations, git-plumbing, schema-v3, branch-aware]

requires:
  - phase: 05-mcp-server
    provides: "v2 schema with learned_facts table"
provides:
  - "Schema v3 with 6 new columns for enriched metadata"
  - "5 branch-aware git utility functions (resolveDefaultBranch, getBranchCommit, listBranchFiles, readBranchFile, getChangedFilesSinceBranch)"
  - "v2->v3 automatic migration preserving existing data"
affects: [06-02, phase-07, phase-08]

tech-stack:
  added: []
  patterns:
    - "ALTER TABLE ADD COLUMN migration pattern for non-destructive schema evolution"
    - "git plumbing commands (ls-tree, show, rev-parse --verify) for branch-aware file reading"

key-files:
  created: []
  modified:
    - src/db/migrations.ts
    - src/db/schema.ts
    - src/indexer/git.ts
    - tests/db/schema.test.ts
    - tests/indexer/git.test.ts
    - tests/knowledge/store.test.ts

key-decisions:
  - "Fixed runMigrations to respect toVersion parameter (was silently ignored, caused duplicate column errors during v2 test setup)"
  - "readBranchFile uses git show with maxBuffer 500KB matching existing MAX_FILE_SIZE convention"
  - "listBranchFiles uses 10MB maxBuffer for large repos"

patterns-established:
  - "Branch-aware git functions follow existing pattern: execSync with cwd, encoding, stdio pipe, try/catch returning null/empty on failure"
  - "Migration functions gate on both fromVersion AND toVersion for correct partial migration in tests"

requirements-completed: [IDX2-05, IDX2-01]

duration: 4min
completed: 2026-03-06
---

# Phase 6 Plan 01: Schema v3 Migration & Branch-Aware Git Functions Summary

**Schema v3 migration adding 6 metadata columns (default_branch, table_name, schema_fields, service_type, domain, owner_team) plus 5 branch-aware git plumbing functions for non-disruptive file reading**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-06T13:03:53Z
- **Completed:** 2026-03-06T13:07:50Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Schema v3 migration adds 6 columns across 4 tables (repos, modules, services, events) via ALTER TABLE
- v2 databases auto-migrate to v3 on open, preserving all existing data
- 5 new branch-aware git functions using plumbing commands (never touch working tree)
- 36 tests across schema and git modules, 252 total suite tests passing

## Task Commits

Each task was committed atomically (TDD: test then implementation):

1. **Task 1: Schema v3 migration** (TDD)
   - `c445f95` test(06-01): add failing tests for schema v3 migration
   - `e908686` feat(06-01): implement schema v3 migration with 6 new columns
2. **Task 2: Branch-aware git utility functions** (TDD)
   - `0f2067a` test(06-01): add failing tests for branch-aware git functions
   - `05d6358` feat(06-01): add branch-aware git utility functions

## Files Created/Modified
- `src/db/migrations.ts` - Added migrateToV3 function, fixed toVersion gating
- `src/db/schema.ts` - Bumped SCHEMA_VERSION from 2 to 3
- `src/indexer/git.ts` - Added 5 branch-aware exported functions
- `tests/db/schema.test.ts` - 3 new v3 migration tests + updated column assertions
- `tests/indexer/git.test.ts` - 13 new tests for branch-aware functions
- `tests/knowledge/store.test.ts` - Updated schema version assertion from 2 to 3

## Decisions Made
- Fixed `runMigrations` to gate on `toVersion` (previously ignored), which was necessary for tests to create v2-only databases. This is a correctness fix, not a behavior change for production code since `initializeSchema` always passes `SCHEMA_VERSION` as toVersion.
- `readBranchFile` maxBuffer set to 500KB matching existing `MAX_FILE_SIZE` convention in the codebase.
- `listBranchFiles` maxBuffer set to 10MB to handle large monorepos.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed runMigrations toVersion parameter being ignored**
- **Found during:** Task 1 (Schema v3 migration)
- **Issue:** `runMigrations(db, fromVersion, toVersion)` only checked `fromVersion < N` but never gated on `toVersion`. When tests called `runMigrations(db, 0, 2)` to create a v2 database, v3 migration ran anyway, causing "duplicate column" errors on reopen.
- **Fix:** Added `&& toVersion >= N` condition to each migration gate in `runMigrations`
- **Files modified:** src/db/migrations.ts
- **Verification:** All 252 tests pass
- **Committed in:** e908686

**2. [Rule 1 - Bug] Updated hardcoded schema version assertion in store tests**
- **Found during:** Task 1 (full suite regression check)
- **Issue:** `tests/knowledge/store.test.ts` asserted `SCHEMA_VERSION === 2`
- **Fix:** Changed assertion to expect `3`
- **Files modified:** tests/knowledge/store.test.ts
- **Verification:** All 252 tests pass
- **Committed in:** e908686

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema v3 columns ready for Plan 02 (branch-aware indexing pipeline)
- Git utility functions ready for extractors to read files from default branch without checkout
- `resolveDefaultBranch` will be called during indexing to populate `repos.default_branch`

## Self-Check: PASSED

- All 7 files verified present
- All 4 commits verified in git log
- SCHEMA_VERSION = 3 confirmed
- 8 exported functions in git.ts (3 existing + 5 new)
- 252/252 tests passing

---
*Phase: 06-branch-aware-tracking-schema-migration*
*Completed: 2026-03-06*
