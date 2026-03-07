---
phase: 14-core-layer-dedup
plan: 01
subsystem: search
tags: [fts5, deduplication, hydration, entity-lookup, refactoring]

# Dependency graph
requires:
  - phase: 12-db-perf
    provides: hoisted prepared statements pattern
  - phase: 13-mcp-dedup
    provides: EntityType learned_fact in union, FTS unification
provides:
  - executeFtsWithFallback shared helper in db/fts.ts
  - createEntityHydrator shared factory for by-ID entity lookups
  - EntityInfo interface with repoPath field (exported from entity.ts)
affects: [14-02, 14-03, 15-ts-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns: [shared FTS fallback helper, entity hydrator factory pattern]

key-files:
  created: []
  modified:
    - src/db/fts.ts
    - src/search/text.ts
    - src/search/entity.ts
    - tests/db/fts.test.ts

key-decisions:
  - "Hydrator returns null for unknown types (not empty array) -- single-entity semantics vs multi-entity"
  - "learned_fact hydration in shared hydrator uses content for both name and description fields"
  - "repoPath added to EntityInfo as superset field -- cheap extra column, enables both callers"

patterns-established:
  - "executeFtsWithFallback: generic helper for FTS query with phrase-retry fallback"
  - "createEntityHydrator: factory that returns a (type, id) => EntityInfo|null closure with pre-prepared statements"

requirements-completed: [CORE-05, CORE-03, CORE-04]

# Metrics
duration: 4min
completed: 2026-03-07
---

# Phase 14 Plan 01: FTS Fallback + Entity Hydration Dedup Summary

**Shared FTS query fallback helper and consolidated entity hydrator eliminating 150+ lines of duplicated search/hydration code**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-07T18:01:02Z
- **Completed:** 2026-03-07T18:04:53Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- FTS query fallback (try MATCH, catch, retry as phrase) now exists in exactly one place (`executeFtsWithFallback` in db/fts.ts)
- Entity by-ID hydration consolidated into `createEntityHydrator` factory -- one set of prepared statements, one dispatch switch
- Removed 5 hydrate* functions from text.ts (hydrateRepo, hydrateModule, hydrateEvent, hydrateService, hydrateLearnedFact) plus hydrateResult switch
- Net reduction: ~115 lines removed across text.ts and entity.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract executeFtsWithFallback (TDD)**
   - `a057eee` (test: add failing tests for executeFtsWithFallback)
   - `0cddca6` (feat: extract executeFtsWithFallback to db/fts.ts, wire both callers)
2. **Task 2: Consolidate entity hydration and by-ID dispatch** - `035f722` (feat)

## Files Created/Modified
- `src/db/fts.ts` - Added `executeFtsWithFallback<T>` generic helper
- `src/search/text.ts` - Removed 5 hydrate functions + switch, uses shared hydrator
- `src/search/entity.ts` - Added `createEntityHydrator` factory (exported), added repoPath to EntityInfo, simplified createEntityByIdLookup to delegate
- `tests/db/fts.test.ts` - Added 3 tests for executeFtsWithFallback (valid query, fallback on syntax error, empty on double failure)

## Decisions Made
- Hydrator returns `null` for single-entity semantics; `createEntityByIdLookup` wraps it to return `EntityInfo[]` with repo filter for backward compatibility
- learned_fact hydration moved into shared hydrator -- uses `content` field for both `name` (truncated to 100 chars) and `description` (full content), matching prior text.ts behavior
- `getEntitiesByExactName()` intentionally kept separate (queries by name with optional filters -- different dispatch pattern per Research Pitfall 5)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Ready for 14-02 (writer insert helpers + clearRepoEntities consolidation)
- The shared hydrator pattern established here can be referenced by future plans

## Self-Check: PASSED

- All 4 modified files exist on disk
- All 3 task commits verified in git log (a057eee, 0cddca6, 035f722)
- executeFtsWithFallback exported from db/fts.ts (1 occurrence)
- Zero try blocks in text.ts and entity.ts (FTS fallback fully extracted)
- Zero hydrate* functions in text.ts (all removed)
- createEntityHydrator exported from entity.ts (1 occurrence)
- 440/440 tests passing

---
*Phase: 14-core-layer-dedup*
*Completed: 2026-03-07*
