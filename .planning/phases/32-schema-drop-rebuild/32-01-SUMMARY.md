---
phase: 32-schema-drop-rebuild
plan: 01
subsystem: database
tags: [sqlite, schema, migrations, fts5, drop-rebuild]

# Dependency graph
requires: []
provides:
  - "Drop+rebuild schema management replacing incremental migrations"
  - "createSchema() single-function DDL for all 8 tables and 13 indexes"
  - "Learned fact preservation across schema rebuilds"
affects: [33-filesystem-indexing]

# Tech tracking
tech-stack:
  added: []
  patterns: ["drop+rebuild instead of incremental migrations", "fact preservation across schema rebuilds"]

key-files:
  created: []
  modified:
    - src/db/schema.ts
    - src/db/migrations.ts
    - tests/db/schema.test.ts
    - tests/knowledge/store.test.ts

key-decisions:
  - "IDs of learned facts change after rebuild (content-identified, not ID-identified)"
  - "Re-index facts in FTS immediately during rebuild rather than deferring to next kb index"

patterns-established:
  - "Schema changes: edit createSchema() DDL, bump SCHEMA_VERSION -- no migration functions"
  - "Fact preservation: export before drop, re-import after rebuild with FTS re-indexing"

requirements-completed: [SCH-01, SCH-02, SCH-03]

# Metrics
duration: 7min
completed: 2026-03-10
---

# Phase 32 Plan 01: Schema Drop & Rebuild Summary

**Drop+rebuild schema management replacing 9 incremental migrations with single createSchema() DDL and learned fact preservation**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-10T15:33:39Z
- **Completed:** 2026-03-10T15:41:04Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments
- Eliminated all 9 migrateToVN functions and runMigrations (297 lines -> 16 lines in migrations.ts)
- Single createSchema() creates 8 tables and 13 indexes in one DDL block
- initializeSchema() handles 3 paths: fresh DB, matching version (no-op), version mismatch (drop+rebuild)
- Learned facts survive schema rebuilds with content, repo, and created_at preserved
- Facts are re-indexed in FTS immediately during rebuild

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace migration system with createSchema + drop-rebuild** (TDD)
   - RED: `c9a0e8b` (test: failing tests for drop+rebuild)
   - GREEN: `75e17fa` (feat: implementation of drop+rebuild)

## Files Created/Modified
- `src/db/schema.ts` - New createSchema() with full DDL, initializeSchema() with drop+rebuild logic, SCHEMA_VERSION=10
- `src/db/migrations.ts` - Stripped to getCurrentVersion + setVersion only (16 lines)
- `tests/db/schema.test.ts` - Rewrote: removed v3/v4/v5/v7/v8 migration tests, added drop+rebuild, fresh DB, idempotent open test suites (25 tests)
- `tests/knowledge/store.test.ts` - Updated SCHEMA_VERSION assertion to 10

## Decisions Made
- Fact IDs change after rebuild (acceptable: facts identified by content, not ID)
- Re-index facts in FTS during rebuild rather than deferring to next `kb index` call
- SCHEMA_VERSION bumped to 10 to trigger rebuild on existing v9 databases

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed SCHEMA_VERSION assertion in store.test.ts**
- **Found during:** Task 1 (GREEN phase)
- **Issue:** tests/knowledge/store.test.ts expected SCHEMA_VERSION=9, which was a pre-existing uncommitted change from 8->9
- **Fix:** Updated assertion to expect 10
- **Files modified:** tests/knowledge/store.test.ts
- **Verification:** All 780 tests pass
- **Committed in:** 75e17fa (part of GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Trivial version number fix in a test file. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Drop+rebuild mechanism in place for Phase 33 (filesystem indexing)
- Future schema changes are a single edit to createSchema() + version bump
- All 780 tests pass, build compiles cleanly

---
*Phase: 32-schema-drop-rebuild*
*Completed: 2026-03-10*
