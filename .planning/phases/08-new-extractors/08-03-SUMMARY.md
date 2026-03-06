---
phase: 08-new-extractors
plan: 03
subsystem: indexer
tags: [pipeline, grpc, graphql, ecto, absinthe, event-catalog, fts, surgical]

# Dependency graph
requires:
  - phase: 08-new-extractors/01
    provides: "ElixirModule with schemaFields, associations, absintheTypes, grpcStubs"
  - phase: 08-new-extractors/02
    provides: "GraphQL SDL extractor, ServiceData interface, service persistence"
provides:
  - "Full pipeline wiring for all 5 extractor outputs to persistence"
  - "Event Catalog enrichment post-processing (domain + owner_team)"
  - "Ecto association edges between modules"
  - "gRPC client call edges from repo to service"
  - "FTS searchability for table names and gRPC service names"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["multi-strategy event matching (name, LIKE, path)", "catalog enrichment as post-processing pass after repo loop"]

key-files:
  created:
    - src/indexer/catalog.ts
    - tests/indexer/catalog.test.ts
  modified:
    - src/indexer/pipeline.ts
    - src/indexer/writer.ts
    - tests/indexer/pipeline.test.ts

key-decisions:
  - "FTS description includes table_name for Ecto schema searchability (Pitfall 6 fix)"
  - "Event Catalog multi-strategy matching: exact CamelCase, LIKE suffix, path-based for Payload events"
  - "Domain derived by traversing domain->service->event chain in catalog MDX files"
  - "Ecto association edges skip cross-repo targets not in DB (RESEARCH.md Pitfall 1)"
  - "gRPC client edges deduplicated per service ID to avoid duplicate edges"
  - "Surgical mode: all modules (Elixir + GraphQL + Absinthe) filtered by changedSet consistently"

patterns-established:
  - "Post-processing enrichment pattern: enrichFromEventCatalog runs after indexAllRepos loop"
  - "Edge insertion pattern: look up entity IDs from DB, skip if not found"

requirements-completed: [EXT-01, EXT-02, EXT-03, EXT-04, EXT-05, EXT-06]

# Metrics
duration: 7min
completed: 2026-03-06
---

# Phase 08 Plan 03: Pipeline Wiring and Event Catalog Enrichment Summary

**Full pipeline wiring connecting gRPC services, GraphQL types, Ecto fields/associations, Absinthe macros, and gRPC client edges to persistence, plus Event Catalog enrichment with multi-strategy matching for domain and team ownership**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-06T15:47:55Z
- **Completed:** 2026-03-06T15:54:36Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Pipeline wires all 5 extractor outputs (gRPC services, GraphQL types, Ecto fields/edges, Absinthe modules, gRPC client edges) to persistence in both full and surgical modes
- Event Catalog enrichment populates domain and owner_team on matching events using domain->service->event chain traversal
- Multi-strategy matching handles both named events (85%) and Payload events (15%) via source_file path matching
- End-to-end integration test proves all new data is FTS-searchable (table names, service names)
- IndexStats extended with services and graphqlTypes counts
- 355 tests green across 25 test files, clean TypeScript build

## Task Commits

Each task was committed atomically:

1. **Task 1: Pipeline wiring for all new extractors (RED)** - `79e1cbe` (test)
2. **Task 1: Pipeline wiring for all new extractors (GREEN)** - `e6356a1` (feat)
3. **Task 2: Event Catalog enrichment (RED)** - `27c1493` (test)
4. **Task 2: Event Catalog enrichment (GREEN)** - `dc626b6` (feat)
5. **Task 3: Full integration verification and FTS sanity check** - `e7b36a0` (test)

## Files Created/Modified
- `src/indexer/catalog.ts` - Event Catalog enrichment: parseFrontmatter, catalogIdToMatchers, enrichFromEventCatalog
- `src/indexer/pipeline.ts` - Full pipeline wiring for all extractors, gRPC client edges, Ecto association edges, catalog integration
- `src/indexer/writer.ts` - ModuleData extended with tableName/schemaFields, INSERT/FTS updated for both full and surgical modes
- `tests/indexer/pipeline.test.ts` - 11 new tests: extractor wiring (9) + e2e search integration (1) + FTS import
- `tests/indexer/catalog.test.ts` - 15 new tests: parseFrontmatter, catalogIdToMatchers, enrichFromEventCatalog integration

## Decisions Made
- FTS description includes table_name so `kb search "bookings"` finds the Ecto schema module (Pitfall 6 from RESEARCH.md)
- Event Catalog matching uses 3 strategies: exact CamelCase name, LIKE suffix, and source_file path for Payload events
- Domain is derived by inverting the domain->services->sends chain from catalog MDX files (deterministic from catalog data)
- Ecto association edges silently skip targets not found in DB (handles cross-repo references per RESEARCH.md Pitfall 1)
- gRPC client edges deduplicated by service ID to prevent duplicate edges from multiple stubs
- enrichFromEventCatalog wrapped in try/catch in pipeline to prevent catalog failures from blocking indexing

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 8 complete: all 6 extractor requirements (EXT-01 through EXT-06) implemented and tested
- All new data types (gRPC services, GraphQL types, Ecto schemas, Absinthe macros, Event Catalog enrichment) are searchable via `kb search`
- Surgical re-indexing handles all new entity types correctly

## Self-Check: PASSED

- All 5 task commits verified (79e1cbe, e6356a1, 27c1493, dc626b6, e7b36a0)
- All 6 files verified (src/indexer/catalog.ts, tests/indexer/catalog.test.ts, src/indexer/pipeline.ts, src/indexer/writer.ts, tests/indexer/pipeline.test.ts, 08-03-SUMMARY.md)
- 355/355 tests passing across 25 test files
- Clean TypeScript build

---
*Phase: 08-new-extractors*
*Completed: 2026-03-06*
