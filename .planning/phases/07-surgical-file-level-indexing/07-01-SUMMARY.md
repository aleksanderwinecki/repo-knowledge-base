---
phase: 07-surgical-file-level-indexing
plan: 01
subsystem: database
tags: [sqlite, migration, schema-v4, file-id, surgical-indexing, writer]

# Dependency graph
requires:
  - phase: 06-branch-aware-tracking
    provides: "branch-aware file reading, v3 schema with default_branch"
provides:
  - "Schema v4 with file_id FK on events table"
  - "persistSurgicalData() for per-file wipe-and-rewrite"
  - "clearRepoEdges() for edge + consumer event cleanup"
  - "Updated clearRepoFiles() using file_id FK join"
  - "persistRepoData() now populates file_id on events"
affects: [07-02-pipeline-integration, indexer, search]

# Tech tracking
tech-stack:
  added: []
  patterns: [surgical-file-persist, file-id-fk-cleanup, source-file-fallback]

key-files:
  created: []
  modified:
    - src/db/migrations.ts
    - src/db/schema.ts
    - src/indexer/writer.ts
    - tests/db/schema.test.ts
    - tests/indexer/writer.test.ts
    - tests/knowledge/store.test.ts

key-decisions:
  - "V1 CREATE TABLE keeps original schema without file_id; V4 ALTER TABLE adds it -- avoids coupling old migrations to new features"
  - "clearRepoFiles uses dual-path cleanup: file_id FK join primary, source_file text match fallback for pre-v4 data"
  - "persistSurgicalData clears edges for entire repo (caller re-inserts) rather than per-file edge tracking"

patterns-established:
  - "Surgical persist pattern: clear changed files only, insert new data, leave unchanged files untouched"
  - "Consumer event cleanup: events with schema_definition LIKE 'consumed:%' are transient and cleared with edges"

requirements-completed: [IDX2-02, IDX2-03]

# Metrics
duration: 6min
completed: 2026-03-06
---

# Phase 7 Plan 1: Schema v4 + Surgical Writer Summary

**Schema v4 migration adding file_id FK to events, plus persistSurgicalData and clearRepoEdges functions for per-file incremental indexing**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-06T14:37:59Z
- **Completed:** 2026-03-06T14:43:30Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Schema v4 migration adds file_id INTEGER FK to events table, auto-migrates from v3
- clearRepoFiles updated to use file_id FK join for event cleanup with source_file text fallback for backward compat
- persistRepoData now populates file_id when inserting events (lookup-or-create file record)
- persistSurgicalData enables per-file wipe-and-rewrite -- only touches changed files, leaving others intact
- clearRepoEdges removes all repo/service-sourced edges and consumer-created events
- 9 new tests added (40 total across schema + writer), full suite at 279 passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Schema v4 migration + file_id-based clearRepoFiles** - `1b43a37` (feat)
2. **Task 2: persistSurgicalData + clearRepoEdges** - `c01e08b` (feat)

## Files Created/Modified
- `src/db/migrations.ts` - Added migrateToV4 (file_id column on events), V4 gate in runMigrations
- `src/db/schema.ts` - Bumped SCHEMA_VERSION from 3 to 4
- `src/indexer/writer.ts` - Updated clearRepoFiles (file_id join + fallback), updated persistRepoData (file_id on events), added clearRepoEdges, added persistSurgicalData
- `tests/db/schema.test.ts` - V4 migration tests, updated v3 tests to use SCHEMA_VERSION constant
- `tests/indexer/writer.test.ts` - clearRepoFiles file_id tests, persistSurgicalData tests, clearRepoEdges tests
- `tests/knowledge/store.test.ts` - Updated hardcoded SCHEMA_VERSION assertion from 3 to 4

## Decisions Made
- V1 CREATE TABLE retains original schema (no file_id). V4 migration adds it via ALTER TABLE. This keeps migration history accurate.
- clearRepoFiles uses dual-path event cleanup: file_id FK join is primary, source_file text match is fallback for pre-v4 rows without file_id.
- persistSurgicalData clears ALL repo edges (not per-file), since edge resolution is repo-wide and caller will re-insert.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed v3 migration tests expecting hardcoded version 3**
- **Found during:** Task 1
- **Issue:** Existing v3 migration tests asserted `user_version == 3` after `openDatabase()`, but `openDatabase` now migrates to v4
- **Fix:** Changed assertions to use `SCHEMA_VERSION` constant instead of hardcoded 3
- **Files modified:** tests/db/schema.test.ts
- **Verification:** All schema tests pass
- **Committed in:** 1b43a37

**2. [Rule 1 - Bug] Fixed store.test.ts hardcoded SCHEMA_VERSION assertion**
- **Found during:** Task 1 (full test suite regression check)
- **Issue:** tests/knowledge/store.test.ts had `expect(SCHEMA_VERSION).toBe(3)`
- **Fix:** Updated to `expect(SCHEMA_VERSION).toBe(4)`
- **Files modified:** tests/knowledge/store.test.ts
- **Verification:** Full suite passes (279 tests)
- **Committed in:** 1b43a37

---

**Total deviations:** 2 auto-fixed (2 bugs -- hardcoded version assertions)
**Impact on plan:** Both fixes were necessary test updates for the version bump. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Schema v4 in place with file_id FK on events
- persistSurgicalData, clearRepoEdges, and updated clearRepoFiles ready for pipeline integration
- Plan 02 can wire these into the indexing pipeline with diff detection

## Self-Check: PASSED

All files verified present. Commits 1b43a37 and c01e08b confirmed in git log.

---
*Phase: 07-surgical-file-level-indexing*
*Completed: 2026-03-06*
