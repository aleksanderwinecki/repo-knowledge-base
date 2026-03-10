---
phase: 30-field-search-shared-concepts
plan: 02
subsystem: search
tags: [entity-cards, field-search, shared-concepts, sqlite]

# Dependency graph
requires:
  - phase: 30-field-search-shared-concepts/01
    provides: Field FTS indexing, field EntityType, field hydrator case
provides:
  - Field entity card query path in findEntity (getEntitiesByExactName 'field' case)
  - Shared concept detection for fields appearing in 2+ repos
  - FieldOccurrence interface for downstream consumers
  - Field name resolution in relationship lookup (nameStmts)
affects: [field impact queries, MCP field entity tool, CLI --entity field search]

# Tech tracking
tech-stack:
  added: []
  patterns: [shared concept enrichment via post-query card decoration, field description format "parentType parentName.fieldName: fieldType (nullable|required)"]

key-files:
  created: []
  modified:
    - src/search/entity.ts
    - src/search/types.ts
    - tests/search/entity.test.ts

key-decisions:
  - "Shared concept detection uses already-fetched cards to count distinct repos -- no extra DB query needed"
  - "Field description format: 'parentType parentName.fieldName: fieldType (nullable|required)' for rich per-occurrence detail"
  - "Shared concept prefix prepended to description string for compatibility with existing EntityCard interface"

patterns-established:
  - "Shared concept enrichment: post-query decoration of entity cards based on cross-repo count"

requirements-completed: [SHARED-01, SHARED-02]

# Metrics
duration: 3min
completed: 2026-03-10
---

# Phase 30 Plan 02: Field Entity Cards & Shared Concepts Summary

**Field entity cards with per-occurrence parent/type/nullable detail and cross-repo shared concept detection via description enrichment**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-10T13:26:34Z
- **Completed:** 2026-03-10T13:29:30Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments
- findEntity handles type=field queries returning one EntityCard per occurrence across repos
- Each card description shows parent_type, parent_name, field_type, and nullable/required status
- Fields appearing in 2+ repos get "[shared across N repos]" prefix in description
- Fields in single repo have no shared prefix
- Unfiltered findEntity queries now include field exact matches
- Field name resolution added to relationship lookup for future edge support

## Task Commits

Each task was committed atomically:

1. **Task 1: Add field entity card query path with shared concept detection** - `128c8e8` (test) + `5fca223` (feat)

_Note: TDD task has separate test and implementation commits_

## Files Created/Modified
- `src/search/entity.ts` - Added 'field' case to getEntitiesByExactName, shared concept enrichment in findExact, 'field' in default types and nameStmts
- `src/search/types.ts` - Added FieldOccurrence interface
- `tests/search/entity.test.ts` - 7 new tests for field entity cards and shared concept detection

## Decisions Made
- Shared concept detection reuses already-fetched card data to count distinct repos -- avoids extra DB roundtrip
- Field description format includes parentType for schema provenance: "ecto_schema Employee.employee_id: integer (required)"
- Shared concept prefix prepended to existing description string rather than adding new EntityCard fields, maintaining backward compatibility with MCP/CLI

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 30 complete: field search and shared concepts fully operational
- Ready for Phase 31 (field edges and field impact queries)
- All 772 tests pass

## Self-Check: PASSED

- All 3 source files verified present on disk
- Commit 128c8e8 (test) verified in git log
- Commit 5fca223 (feat) verified in git log
- 772/772 tests pass

---
*Phase: 30-field-search-shared-concepts*
*Completed: 2026-03-10*
