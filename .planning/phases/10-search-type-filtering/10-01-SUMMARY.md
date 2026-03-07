---
phase: 10-search-type-filtering
plan: 01
subsystem: search
tags: [fts5, sqlite, type-filtering, composite-types]

# Dependency graph
requires:
  - phase: 03-search
    provides: FTS5 search infrastructure, searchText, findEntity
  - phase: 08-new-extractors
    provides: module sub-types (schema, context, graphql_query, etc.), service types (grpc)
provides:
  - parent:subtype composite FTS entity_type convention
  - resolveTypeFilter for coarse and granular type queries
  - parseCompositeType for composite entity_type parsing
  - listAvailableTypes for type discovery
  - subType field on TextSearchResult
  - Sub-type filtering in searchText and findEntity
affects: [10-02-PLAN, cli, mcp-server]

# Tech tracking
tech-stack:
  added: []
  patterns: [composite-type-convention, coarse-vs-granular-filtering]

key-files:
  created: []
  modified:
    - src/db/fts.ts
    - src/search/types.ts
    - src/search/text.ts
    - src/search/entity.ts
    - src/indexer/writer.ts
    - tests/db/fts.test.ts
    - tests/search/text.test.ts
    - tests/search/entity.test.ts
    - tests/indexer/writer.test.ts
    - tests/indexer/pipeline.test.ts

key-decisions:
  - "FTS entity_type stores parent:subtype composite (e.g., module:schema) with fallback parent:parent when no subType"
  - "entity_type marked UNINDEXED in FTS5 to prevent type strings from polluting MATCH results"
  - "COARSE_TYPES set distinguishes parent types (module, service, etc.) from sub-types (schema, grpc, etc.)"
  - "removeEntity uses LIKE pattern (entity_type LIKE 'module:%') for safe composite matching"
  - "Sub-type to parent mapping uses known sets (MODULE_SUB_TYPES, SERVICE_SUB_TYPES) with fallback"

patterns-established:
  - "Composite type convention: parent:subtype format in FTS entity_type column"
  - "resolveTypeFilter pattern: coarse types get prefix LIKE, granular types get suffix LIKE"
  - "parseCompositeType as standard way to decompose composite entity_type values"

requirements-completed: [TF-01, TF-02, TF-03, TF-04, TF-05, TF-06]

# Metrics
duration: 9min
completed: 2026-03-07
---

# Phase 10 Plan 01: FTS Type Filtering Foundation Summary

**Parent:subtype FTS convention with resolveTypeFilter, coarse/granular search filtering, subType on results, and listAvailableTypes discovery**

## Performance

- **Duration:** 9 min
- **Started:** 2026-03-07T12:14:44Z
- **Completed:** 2026-03-07T12:24:00Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- FTS entity_type column stores parent:subtype composite format (e.g., module:schema, service:grpc)
- resolveTypeFilter enables both coarse (--type module) and granular (--type schema) filtering
- TextSearchResult includes subType field populated on all results
- findEntity supports sub-type filtering in both exact-match and FTS fallback paths
- listAvailableTypes returns grouped type counts for discovery
- All 384 tests pass, TypeScript compiles cleanly

## Task Commits

Each task was committed atomically:

1. **Task 1: FTS parent:subtype convention and writer updates** - `b414b6d` (feat)
2. **Task 2: Search layer sub-type filtering and subType result field** - `04d893f` (feat)

## Files Created/Modified
- `src/db/fts.ts` - Added UNINDEXED entity_type, subType param, resolveTypeFilter, parseCompositeType, listAvailableTypes, COARSE_TYPES
- `src/indexer/writer.ts` - All 6 indexEntity calls pass subType (3 persistRepoData + 3 persistSurgicalData)
- `src/search/types.ts` - Added subType to TextSearchResult, widened entityTypeFilter and type to string
- `src/search/text.ts` - executeFtsQuery uses resolveTypeFilter, hydrateResult parses composites, all hydrate functions include subType
- `src/search/entity.ts` - findExact maps sub-types to parent tables with column filters, findByFts uses resolveTypeFilter
- `tests/db/fts.test.ts` - 12 new tests for composite types, resolveTypeFilter, parseCompositeType, listAvailableTypes
- `tests/search/text.test.ts` - 6 new tests for sub-type filtering, subType field population
- `tests/search/entity.test.ts` - 4 new tests for sub-type entity filtering
- `tests/indexer/writer.test.ts` - Updated existing tests for composite entity_type format
- `tests/indexer/pipeline.test.ts` - Updated FTS integration tests for composite format

## Decisions Made
- FTS entity_type stores `parent:subtype` composite (e.g., `module:schema`) with fallback `parent:parent` when no subType provided
- entity_type marked UNINDEXED in FTS5 to prevent type tokens from appearing in MATCH results
- COARSE_TYPES set (`repo`, `file`, `module`, `service`, `event`, `learned_fact`) distinguishes parent types from granular sub-types
- removeEntity uses LIKE pattern (`entity_type LIKE 'module:%'`) for safe matching regardless of sub-type
- Sub-type to parent mapping in findExact uses known sets (MODULE_SUB_TYPES, SERVICE_SUB_TYPES) with fallback to query all tables

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing tests for composite entity_type format**
- **Found during:** Task 2 (search layer changes)
- **Issue:** 8 existing tests in writer.test.ts and pipeline.test.ts compared raw `search()` entityType against bare strings (e.g., 'service'), but search() now returns composite format ('service:grpc')
- **Fix:** Updated comparisons to use `parseCompositeType(r.entityType as string).entityType` for parent type extraction
- **Files modified:** tests/indexer/writer.test.ts, tests/indexer/pipeline.test.ts
- **Verification:** npm test -- 384/384 pass
- **Committed in:** 04d893f (Task 2 commit)

**2. [Rule 1 - Bug] Fixed TypeScript compilation error for learned_fact switch case**
- **Found during:** Task 2 (build verification)
- **Issue:** `switch (entityType)` in hydrateResult didn't allow `'learned_fact'` case since EntityType union doesn't include it
- **Fix:** Changed to `switch (entityType as string)` matching original pattern
- **Files modified:** src/search/text.ts
- **Verification:** npm run build -- compiles clean
- **Committed in:** 04d893f (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs caused by current task's changes)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FTS convention and search layer ready for CLI/MCP integration (Plan 02)
- `resolveTypeFilter`, `parseCompositeType`, `listAvailableTypes` exported and available for CLI --type flag and MCP tools
- Backward compatible: existing coarse type filters still work

---
*Phase: 10-search-type-filtering*
*Completed: 2026-03-07*
