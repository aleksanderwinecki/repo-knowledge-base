---
phase: 12-database-performance
plan: 02
subsystem: database
tags: [sqlite, better-sqlite3, prepared-statements, performance]

# Dependency graph
requires:
  - phase: 12-database-performance/01
    provides: pragma tuning, V5 migration infrastructure
provides:
  - Hoisted prepared statements eliminating redundant db.prepare() in hot loops
  - Closure-based entity/relationship lookups for FTS hydration
affects: [12-database-performance]

# Tech tracking
tech-stack:
  added: []
  patterns: [closure-based statement lookup, hoist-before-loop]

key-files:
  created: []
  modified:
    - src/db/fts.ts
    - src/indexer/writer.ts
    - src/search/entity.ts
    - src/search/dependencies.ts

key-decisions:
  - "Inline FTS DELETE in clearRepoEntities instead of calling removeEntity per-entity in loops"
  - "Closure-based createEntityByIdLookup/createRelationshipLookup pattern for pre-prepared statement reuse"
  - "Removed dead getEntityById/getRelationships/resolveEntityName after replacement by closures"

patterns-established:
  - "Hoist-before-loop: all db.prepare() calls placed at function top, reused via bound variables in loops"
  - "Closure lookup factories: createXxxLookup(db) returns a function with pre-prepared statements captured in closure"

requirements-completed: [PERF-02]

# Metrics
duration: 4min
completed: 2026-03-07
---

# Phase 12 Plan 02: Statement Hoisting Summary

**Hoisted all db.prepare() calls out of hot loops in 4 files, replacing per-iteration SQL parsing with reusable prepared statements and closure-based lookups**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-07T16:38:36Z
- **Completed:** 2026-03-07T16:42:33Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Eliminated all db.prepare() calls inside for/while loops in fts.ts, writer.ts, entity.ts, and dependencies.ts
- clearRepoEntities now inlines FTS DELETE with a single hoisted statement instead of calling removeEntity per entity
- clearRepoFiles hoists all 8 db.prepare() calls above the filePath iteration loop
- clearRepoEdges hoists 5 db.prepare() calls above the consumer event loop
- findLinkedRepos hoists all 6 db.prepare() calls above the BFS traversal
- entity.ts hydration uses closure-based createEntityByIdLookup (4 stmts) and createRelationshipLookup (7 stmts)
- Full test suite (437 tests) passes with zero modifications

## Task Commits

Each task was committed atomically:

1. **Task 1: Hoist statements in fts.ts and writer.ts** - `ae2610d` (perf)
2. **Task 2: Hoist statements in entity.ts and dependencies.ts** - `9d5e852` (perf)

## Files Created/Modified
- `src/db/fts.ts` - Hoisted prepare calls in indexEntity (2 stmts) and removeEntity (1 stmt)
- `src/indexer/writer.ts` - Hoisted stmts in clearRepoEntities (9), clearRepoFiles (8), clearRepoEdges (5)
- `src/search/entity.ts` - New createEntityByIdLookup/createRelationshipLookup closures; removed dead functions
- `src/search/dependencies.ts` - Hoisted all 6 stmts in findLinkedRepos above BFS loop

## Decisions Made
- Inlined FTS DELETE in clearRepoEntities rather than calling removeEntity in loops -- removeEntity still exported for non-hot-path callers (knowledge/store.ts, persistSurgicalData)
- Used closure factory pattern (createEntityByIdLookup, createRelationshipLookup) in entity.ts to pre-prepare all type-specific + edge + name-resolution statements once per search call
- Removed dead getEntityById, getRelationships, resolveEntityName functions since closures fully replace them (private, no test/export references)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Statement hoisting complete across all 4 target files
- Ready for Plan 03 (if any further database performance work remains)
- All 437 tests green, behavior unchanged

## Self-Check: PASSED

All 4 modified files exist. Both task commits (ae2610d, 9d5e852) verified in git log.

---
*Phase: 12-database-performance*
*Completed: 2026-03-07*
