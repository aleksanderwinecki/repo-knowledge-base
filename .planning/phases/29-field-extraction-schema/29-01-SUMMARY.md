---
phase: 29-field-extraction-schema
plan: 01
subsystem: database, indexer
tags: [sqlite, migration, ecto, protobuf, graphql, field-extraction, nullability]

# Dependency graph
requires: []
provides:
  - V8 migration creating fields table with indexes
  - FieldData interface contract in writer.ts
  - extractRequiredFields() for Elixir validate_required parsing
  - ProtoField.optional boolean for proto3 optional keyword
  - parseGraphqlFields() for GraphQL type body field extraction
  - GraphqlField interface
affects: [29-02-PLAN, field-persistence, pipeline-mapping]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "V8 migration pattern: fields table with parent_type discriminant"
    - "Extractor enhancement pattern: add metadata to existing interfaces without breaking consumers"
    - "TDD for extractor functions: test regex behavior in isolation"

key-files:
  created:
    - tests/indexer/fields.test.ts
  modified:
    - src/db/migrations.ts
    - src/db/schema.ts
    - src/indexer/writer.ts
    - src/indexer/elixir.ts
    - src/indexer/proto.ts
    - src/indexer/graphql.ts
    - tests/db/schema.test.ts

key-decisions:
  - "FieldData uses union type discriminant parentType: 'ecto_schema' | 'proto_message' | 'graphql_type'"
  - "nullable stored as INTEGER (SQLite boolean) with default 1 (nullable) for safety"
  - "extractRequiredFields unions across all validate_required calls in a module"
  - "Proto optional detection is keyword-based: only explicit 'optional' prefix = true"
  - "GraphQL field regex naturally skips enum values and comments via \\w+ match start"

patterns-established:
  - "Fields table: polymorphic parent via parent_type + parent_name columns"
  - "Module-level nullability extraction: requiredFields populated during parseElixirFile"

requirements-completed: [FLD-01, FLD-02, FLD-03, FLD-04, NULL-01, NULL-02]

# Metrics
duration: 7min
completed: 2026-03-10
---

# Phase 29 Plan 01: Field Extraction Schema Summary

**V8 migration for fields table, FieldData contract, and field/nullability extraction for Elixir/proto/GraphQL extractors**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-10T12:47:06Z
- **Completed:** 2026-03-10T12:53:40Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- V8 migration creates `fields` table with 11 columns, 5 indexes, and FK cascade from repos
- FieldData interface exported from writer.ts with typed parentType discriminant union
- Elixir extractor: extractRequiredFields() parses validate_required calls (pipe form, multi-line, union across changesets)
- Proto extractor: ProtoField.optional boolean captures the optional keyword prefix
- GraphQL extractor: parseGraphqlFields() parses field declarations from type/input/interface bodies with full type expressions

## Task Commits

Each task was committed atomically:

1. **Task 1: V8 migration + FieldData interface contract** - `bb747b6` (feat)
2. **Task 2: Elixir validate_required + Proto optional capture** - `5e9278c` (feat)
3. **Task 3: GraphQL field parsing from type bodies** - `d5d096d` (feat)
4. **Fix: SCHEMA_VERSION assertion in store test** - `a4e1c8f` (fix)

## Files Created/Modified
- `src/db/migrations.ts` - Added migrateToV8 function creating fields table with indexes
- `src/db/schema.ts` - Bumped SCHEMA_VERSION from 7 to 8
- `src/indexer/writer.ts` - Added FieldData interface and fields? property on RepoData
- `src/indexer/elixir.ts` - Added extractRequiredFields(), requiredFields on ElixirModule
- `src/indexer/proto.ts` - Added optional: boolean to ProtoField, updated extractFields regex
- `src/indexer/graphql.ts` - Added GraphqlField interface and parseGraphqlFields() function
- `tests/db/schema.test.ts` - 6 new V8 migration tests
- `tests/indexer/fields.test.ts` - 22 tests for all three extractors' field capabilities
- `tests/knowledge/store.test.ts` - Updated SCHEMA_VERSION assertion
- `tests/indexer/proto.test.ts` - Updated toEqual assertions for new optional property
- `tests/indexer/topology.test.ts` - Updated makeModule helper for requiredFields

## Decisions Made
- FieldData parentType uses string literal union type for compile-time safety
- nullable defaults to 1 (true) in SQLite -- safe default for unknown nullability
- extractRequiredFields searches entire module content (not just schema block) because validate_required appears in changeset functions
- Proto optional detection is purely keyword-based (matches requirement NULL-02 exactly)
- GraphQL parseGraphqlFields uses simple regex that naturally handles all edge cases via character class constraints

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing proto test assertions for new optional property**
- **Found during:** Task 2 (Proto optional capture)
- **Issue:** Existing proto tests used toEqual() without the new optional field, causing deep equality failures
- **Fix:** Added `optional: false` to 4 test assertions in proto.test.ts
- **Files modified:** tests/indexer/proto.test.ts
- **Verification:** All 11 proto tests pass
- **Committed in:** 5e9278c (Task 2 commit)

**2. [Rule 1 - Bug] Updated topology test helper for new requiredFields property**
- **Found during:** Task 2 (Elixir validate_required)
- **Issue:** makeModule() helper in topology.test.ts constructs full ElixirModule without requiredFields
- **Fix:** Added `requiredFields: []` to the helper defaults
- **Files modified:** tests/indexer/topology.test.ts
- **Verification:** All 15 topology tests pass
- **Committed in:** 5e9278c (Task 2 commit)

**3. [Rule 1 - Bug] Updated SCHEMA_VERSION assertion in store test**
- **Found during:** Verification (full suite run)
- **Issue:** tests/knowledge/store.test.ts hardcoded SCHEMA_VERSION check to 7
- **Fix:** Updated to expect 8
- **Files modified:** tests/knowledge/store.test.ts
- **Verification:** Full suite (739 tests) passes
- **Committed in:** a4e1c8f (separate fix commit)

---

**Total deviations:** 3 auto-fixed (3 Rule 1 - Bug)
**Impact on plan:** All fixes were necessary test updates caused by interface changes. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- V8 migration, FieldData interface, and all three extractors are ready for Plan 02
- Plan 02 will wire field persistence into the pipeline (map extractor output to FieldData[], insert into fields table)
- extractRequiredFields, ProtoField.optional, and parseGraphqlFields provide the nullability signals Plan 02 needs

## Self-Check: PASSED

All 9 artifact files verified on disk. All 4 commit hashes verified in git log.

---
*Phase: 29-field-extraction-schema*
*Completed: 2026-03-10*
