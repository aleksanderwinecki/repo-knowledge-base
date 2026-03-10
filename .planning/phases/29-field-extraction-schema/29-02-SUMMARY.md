---
phase: 29-field-extraction-schema
plan: 02
subsystem: indexer, database
tags: [pipeline, field-persistence, ecto, protobuf, graphql, nullability, surgical-indexing]

# Dependency graph
requires:
  - phase: 29-01
    provides: V8 migration (fields table), FieldData interface, extractRequiredFields, ProtoField.optional, parseGraphqlFields
provides:
  - Field mapping from all three extractors (Elixir, proto, GraphQL) to FieldData[] in pipeline
  - Field persistence in both full and surgical persist paths
  - Field cleanup in clearRepoEntities and clearRepoFiles
  - IndexStats.fields count
  - module_id/event_id foreign key resolution for field rows
affects: [field-search, field-impact, field-edges]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pipeline field mapping: extractors -> FieldData[] -> writer persist"
    - "Parent ID resolution: insert fields AFTER modules/events so lookup finds just-inserted rows"
    - "Surgical field scoping: filter FieldData by changedSet for minimal re-insert"

key-files:
  created: []
  modified:
    - src/indexer/pipeline.ts
    - src/indexer/writer.ts
    - tests/indexer/pipeline.test.ts
    - tests/indexer/writer.test.ts

key-decisions:
  - "Fields inserted after modules and events in transaction to enable parent ID resolution via lookup queries"
  - "GraphQL nullable derived from ! suffix on type expression (no ! = nullable)"
  - "Surgical mode filters fields by sourceFile membership in changedSet"

patterns-established:
  - "Field persistence follows same pattern as modules/events: clearRepoEntities wipes, persistRepoData re-inserts"
  - "clearRepoFiles deletes fields by (repo_id, source_file) for surgical cleanup"

requirements-completed: [FLD-01, FLD-02, FLD-03, FLD-04, NULL-01, NULL-02]

# Metrics
duration: 5min
completed: 2026-03-10
---

# Phase 29 Plan 02: Pipeline Field Wiring Summary

**End-to-end field persistence: three extractors mapped to FieldData[], persisted with parent FK resolution, cleanup in both full and surgical paths**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-10T12:55:52Z
- **Completed:** 2026-03-10T13:01:04Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Pipeline maps Elixir/proto/GraphQL extractor outputs to FieldData[] with correct parentType, nullability, and source file
- Fields persisted to DB with module_id resolved for ecto_schema/graphql_type and event_id resolved for proto_message
- Field cleanup integrated into clearRepoEntities (full re-index) and clearRepoFiles (surgical re-index)
- Surgical mode scopes fields to changed files only, preventing unnecessary re-inserts
- IndexStats includes field count for reporting
- 14 new tests covering pipeline mapping (6) and writer persistence (8), all 753 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Pipeline field mapping + writer wiring** - `9afb5fc` (feat)
2. **Task 2: Writer field persistence tests** - `c14e6fb` (test)

## Files Created/Modified
- `src/indexer/pipeline.ts` - Added FieldData mapping from all three extractors, fields on ExtractedRepoData, surgical field filtering, fields count in IndexStats
- `src/indexer/writer.ts` - Added field INSERT in persistRepoData and persistSurgicalData, field DELETE in clearRepoEntities and clearRepoFiles, parent ID resolution
- `tests/indexer/pipeline.test.ts` - 6 integration tests for field extraction mapping (Ecto, proto, GraphQL, nullable, stats, surgical)
- `tests/indexer/writer.test.ts` - 8 unit tests for field persistence (insert, columns, module_id, event_id, clear, surgical, no-dupes)

## Decisions Made
- Fields inserted after modules and events in the transaction so parent ID lookup queries find the just-inserted parent rows (avoids null FK for known parents)
- GraphQL nullable determined by absence of `!` suffix on the type expression
- Surgical mode filters the full fields array by changedSet membership (same pattern as surgicalModules and surgicalEvents)
- Task 1 and Task 2 implemented together because the pipeline integration tests require writer persistence to verify end-to-end behavior

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Fields table is fully populated during indexing with correct parent references and nullability metadata
- Ready for Phase 30 (field search/concepts) to query field data
- All must_have truths from the plan verified: Ecto fields stored with nullable from validate_required, proto fields with nullable from optional keyword, GraphQL fields stored for type/input/interface only, re-indexing produces no duplicates, surgical re-indexing only affects changed files

## Self-Check: PASSED

All 4 artifact files verified on disk. All 2 commit hashes verified in git log.

---
*Phase: 29-field-extraction-schema*
*Completed: 2026-03-10*
