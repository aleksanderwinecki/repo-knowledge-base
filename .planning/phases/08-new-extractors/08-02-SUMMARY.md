---
phase: 08-new-extractors
plan: 02
subsystem: indexer
tags: [graphql, sdl, grpc, services, fts, extractor]

# Dependency graph
requires:
  - phase: 07-surgical-indexing
    provides: "persistSurgicalData, clearRepoEntities, file_id FK infrastructure"
provides:
  - "GraphQL SDL extractor (parseGraphqlFile, extractGraphqlDefinitions)"
  - "ServiceData interface and service persistence in writer"
  - "Service FTS indexing (name + description searchable)"
  - "Service surgical wipe-and-reinsert support"
affects: [08-03-pipeline-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns: ["extractor pattern: pure parse function + branch-aware scan function", "service FTS indexing via description field for RPC searchability"]

key-files:
  created:
    - src/indexer/graphql.ts
    - tests/indexer/graphql.test.ts
  modified:
    - src/indexer/writer.ts
    - tests/indexer/writer.test.ts

key-decisions:
  - "GraphQL types stored as body text (no field-level extraction per user decision)"
  - "Services use ON CONFLICT upsert for idempotent persistence"
  - "Surgical mode wipes ALL repo services and re-inserts (no file_id on services table)"
  - "Service FTS includes description for RPC method searchability"

patterns-established:
  - "GraphQL extractor follows proto.ts pattern: pure parse + branch scan"
  - "ServiceData interface is extractor-agnostic (serviceType field differentiates grpc vs future types)"

requirements-completed: [EXT-03, EXT-01]

# Metrics
duration: 3min
completed: 2026-03-06
---

# Phase 08 Plan 02: GraphQL SDL Extractor and Service Persistence Summary

**GraphQL SDL parser extracting type/input/enum/interface/union/scalar definitions, plus gRPC service persistence with FTS indexing in the writer**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-06T15:40:50Z
- **Completed:** 2026-03-06T15:44:24Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- GraphQL SDL extractor that parses all definition kinds (type, input, enum, interface, union, scalar) including extend types and implements clauses
- ServiceData interface and full service persistence pipeline: insert with FTS, clear with FTS cleanup, surgical wipe-and-reinsert
- 24 new tests (17 graphql + 7 writer service tests) -- all 330 project tests green

## Task Commits

Each task was committed atomically:

1. **Task 1: GraphQL SDL extractor** - `6cb4644` (feat)
2. **Task 2: ServiceData interface and gRPC service persistence in writer** - `af9e908` (feat)

_Both tasks used TDD: tests written first (RED), implementation to pass (GREEN)._

## Files Created/Modified
- `src/indexer/graphql.ts` - GraphQL SDL parser with parseGraphqlFile and extractGraphqlDefinitions
- `tests/indexer/graphql.test.ts` - 17 tests covering all definition kinds and branch-aware extraction
- `src/indexer/writer.ts` - ServiceData interface, RepoData extended, service persistence with FTS, surgical support
- `tests/indexer/writer.test.ts` - 7 new tests for service persistence, FTS, upsert, and surgical mode

## Decisions Made
- GraphQL body stored as raw text string (no individual field extraction) per user decision in CONTEXT.md
- Services use ON CONFLICT(repo_id, name) DO UPDATE for idempotent upsert
- Surgical mode does full service wipe-and-reinsert since services table has no file_id column (cost negligible: 1-5 services per repo)
- clearRepoEntities now removes service FTS entries before deleting service records (was missing)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- graphql.ts and ServiceData are ready for Plan 03 pipeline wiring
- GraphqlDefinition will be consumed by the pipeline to create module records with graphql_* types
- ServiceData will carry gRPC services from proto.ts through the pipeline into the services table

## Self-Check: PASSED

All 5 files verified present. Both task commits (6cb4644, af9e908) confirmed in git log. 330/330 tests passing.

---
*Phase: 08-new-extractors*
*Completed: 2026-03-06*
