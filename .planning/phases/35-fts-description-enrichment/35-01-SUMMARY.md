---
phase: 35-fts-description-enrichment
plan: 01
subsystem: search
tags: [fts, bm25, indexer, writer, description-enrichment]

requires:
  - phase: 33-or-default-relaxation
    provides: Progressive relaxation and OR query building for FTS

provides:
  - Enriched FTS descriptions with repo name for all entity types
  - Proto field event context (event: prefix) for proto message field discoverability
  - buildFieldDescription shared helper for dual-path consistency
  - Golden tests for repo-name and event-name cross-entity search

affects: [fts-ecto-extraction, reindex, search-quality]

tech-stack:
  added: []
  patterns:
    - "FTS description enrichment at index time via shared helpers"
    - "Repo name threaded through all insert*WithFts helpers"
    - "buildFieldDescription for dual-path (full/surgical) consistency"

key-files:
  created: []
  modified:
    - src/indexer/writer.ts
    - tests/fixtures/seed.ts
    - tests/indexer/writer.test.ts
    - tests/search/golden.test.ts

key-decisions:
  - "Module FTS descriptions include repo name + summary + table but NOT field names to avoid BM25 rank pollution"
  - "Proto field descriptions get event: prefix; ecto/graphql fields do not"
  - "Shared buildFieldDescription helper ensures persistRepoData and persistSurgicalData produce identical FTS descriptions"

patterns-established:
  - "FTS description assembly: repo name always first token for cross-repo disambiguation"
  - "Entity-type-specific suffixes (event: for proto fields) for semantic search enrichment"

requirements-completed: [DESC-01, DESC-02, DESC-03]

duration: 5min
completed: 2026-03-11
---

# Phase 35 Plan 01: FTS Description Enrichment Summary

**Enriched all FTS descriptions with repo name at index time, added event: context prefix for proto fields, shared buildFieldDescription helper for dual-path consistency**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-11T13:42:10Z
- **Completed:** 2026-03-11T13:46:55Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- All entity FTS descriptions (module, event, service, field) now include repo name for cross-repo disambiguation
- Proto field descriptions include `event:{parentName}` prefix enabling event-name -> field discoverability
- Module descriptions enriched with repo name + table context but explicitly exclude field names to prevent BM25 rank pollution
- Shared `buildFieldDescription()` helper used by both `persistRepoData` and `persistSurgicalData`
- 7 new test cases (8 writer integration + 3 golden) all pass, 825 total tests green

## Task Commits

Each task was committed atomically:

1. **Task 1: RED -- Seed fields and write failing tests** - `bf33fa0` (test)
2. **Task 2: GREEN -- Implement FTS description enrichment** - `bd9d130` (feat)

## Files Created/Modified
- `src/indexer/writer.ts` - Added buildFieldDescription helper, threaded repoName through all insert*WithFts helpers, enriched FTS description assembly
- `tests/fixtures/seed.ts` - Added proto fields to booking-service, ecto fields to payments-service seed data
- `tests/indexer/writer.test.ts` - 8 new tests in "FTS description enrichment" describe block
- `tests/search/golden.test.ts` - 3 new golden tests (#19-#21) for repo-name and event-name search

## Decisions Made
- Module FTS descriptions include repo name + summary + table but NOT field names (schemaFields) to avoid collapsing BM25 rank spread
- Proto field descriptions get `event:` prefix for event-name discoverability; ecto/graphql fields do not
- Shared `buildFieldDescription` helper ensures both persist paths produce identical FTS output

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FTS descriptions are enriched; reindexing existing repos will pick up new description format automatically
- Ready for ecto extraction improvements or other search quality phases

---
*Phase: 35-fts-description-enrichment*
*Completed: 2026-03-11*
