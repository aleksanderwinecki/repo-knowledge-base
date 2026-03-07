---
phase: 13-mcp-layer-dedup
plan: 02
subsystem: mcp
tags: [fts, auto-sync, dedup, refactor, migration]

# Dependency graph
requires:
  - phase: 13-01
    provides: wrapToolHandler HOF, resolveDbPath, formatSingleResponse
provides:
  - withAutoSync generic helper for query-sync-requery pattern
  - EntityType union including learned_fact
  - Unified FTS indexing path for learned facts via indexEntity/removeEntity
  - V6 migration normalizing legacy bare learned_fact FTS entries
affects: [knowledge, search, mcp-tools]

# Tech tracking
tech-stack:
  added: []
  patterns: [withAutoSync generic helper for sync-requery dedup]

key-files:
  created: []
  modified:
    - src/mcp/sync.ts
    - src/mcp/tools/search.ts
    - src/mcp/tools/entity.ts
    - src/mcp/tools/deps.ts
    - src/types/entities.ts
    - src/knowledge/store.ts
    - src/db/schema.ts
    - src/db/migrations.ts
    - tests/knowledge/store.test.ts
    - tests/db/schema.test.ts

key-decisions:
  - "withAutoSync is generic over T, not restricted to arrays, so deps tool can pass single result objects"
  - "V6 migration normalizes bare 'learned_fact' to 'learned_fact:learned_fact' so removeEntity LIKE pattern works"

patterns-established:
  - "withAutoSync<T>(db, queryFn, extractRepoNames): canonical pattern for sync-requery across all MCP tools"

requirements-completed: [MCP-02, MCP-05]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 13 Plan 02: MCP Layer Dedup Summary

**withAutoSync generic helper eliminating 36-line sync-requery duplication across 3 tools, plus unified FTS indexing for learned_fact through standard indexEntity/removeEntity path**

## Performance

- **Duration:** 3min
- **Started:** 2026-03-07T17:28:47Z
- **Completed:** 2026-03-07T17:31:58Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- Extracted withAutoSync<T> generic helper into sync.ts, replacing inline 36-line sync-requery pattern in search, entity, and deps tools
- Added 'learned_fact' to EntityType union, enabling store.ts to use indexEntity/removeEntity instead of raw FTS SQL
- Added V6 migration to normalize existing bare 'learned_fact' FTS entries to composite 'learned_fact:learned_fact' format
- All 437 tests pass across 28 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract withAutoSync helper and refactor 3 tools** - `9bb04de` (refactor)
2. **Task 2: Unify EntityType and FTS indexing for learned facts** - `df4185d` (feat)

## Files Created/Modified
- `src/mcp/sync.ts` - Added withAutoSync<T> generic helper alongside existing checkAndSyncRepos
- `src/mcp/tools/search.ts` - Replaced inline sync pattern with withAutoSync call
- `src/mcp/tools/entity.ts` - Replaced inline sync pattern with withAutoSync call
- `src/mcp/tools/deps.ts` - Replaced inline sync pattern with withAutoSync call
- `src/types/entities.ts` - Added 'learned_fact' to EntityType union
- `src/knowledge/store.ts` - Replaced raw FTS INSERT/DELETE with indexEntity/removeEntity
- `src/db/schema.ts` - Bumped SCHEMA_VERSION from 5 to 6
- `src/db/migrations.ts` - Added migrateToV6 normalizing bare learned_fact FTS entries
- `tests/knowledge/store.test.ts` - Updated schema version and FTS query assertions for composite type
- `tests/db/schema.test.ts` - Updated schema version assertion from 5 to 6

## Decisions Made
- withAutoSync is generic over T (not restricted to arrays) so the deps tool can pass single result objects
- V6 migration normalizes bare 'learned_fact' to composite 'learned_fact:learned_fact' so removeEntity's LIKE pattern works correctly

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated schema version assertion in schema.test.ts**
- **Found during:** Task 2 (EntityType and FTS indexing unification)
- **Issue:** tests/db/schema.test.ts also asserted SCHEMA_VERSION === 5, not mentioned in plan
- **Fix:** Updated assertion from 5 to 6
- **Files modified:** tests/db/schema.test.ts
- **Verification:** All 437 tests pass
- **Committed in:** df4185d (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Necessary test fix for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 13 (MCP Layer Dedup) is fully complete
- All MCP tool duplications eliminated: shared wrapToolHandler, resolveDbPath, formatSingleResponse (Plan 01) and withAutoSync, unified FTS path (Plan 02)
- Ready for next milestone phase

---
*Phase: 13-mcp-layer-dedup*
*Completed: 2026-03-07*
