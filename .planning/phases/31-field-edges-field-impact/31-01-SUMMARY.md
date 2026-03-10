---
phase: 31-field-edges-field-impact
plan: 01
subsystem: search
tags: [sqlite, field-edges, impact-analysis, maps_to, better-sqlite3]

requires:
  - phase: 29-field-extraction-nullability
    provides: fields table with ecto/proto/graphql field data
  - phase: 30-field-search-shared-concepts
    provides: field FTS indexing and entity cards
provides:
  - maps_to edges between ecto/proto fields with matching names within same repo
  - insertFieldEdges() function in writer.ts for edge creation during indexing
  - analyzeFieldImpact() core query tracing fields across service boundaries
  - formatFieldImpactCompact() for MCP-safe output
affects: [31-02, mcp-tools, cli-commands]

tech-stack:
  added: []
  patterns: [field-edge-creation-during-persist, field-impact-stitching-db-and-graph]

key-files:
  created:
    - src/search/field-impact.ts
    - tests/search/field-impact.test.ts
  modified:
    - src/types/entities.ts
    - src/indexer/writer.ts
    - tests/indexer/writer.test.ts

key-decisions:
  - "Field edges cleaned via both source_id and target_id subqueries to handle surgical re-index where one end is deleted before cleanup runs"
  - "Ecto fields in downstream consumer repos classified as consumers, not origins, based on graph topology"
  - "Kafka topics extracted from graph.forward edges with mechanism kafka/event for boundary enrichment"

patterns-established:
  - "Field edge creation: insertFieldEdges runs after field INSERT in both full and surgical persist paths"
  - "Field impact stitching: SQL query for field occurrences + buildGraph for inter-repo kafka/event traversal"

requirements-completed: [FEDGE-01, FEDGE-02, FIMPACT-01, FIMPACT-02]

duration: 6min
completed: 2026-03-10
---

# Phase 31 Plan 01: Field Edges & Field Impact Core Summary

**maps_to edges created between ecto/proto fields during indexing, analyzeFieldImpact traces fields from origins through proto boundaries (with Kafka topics) to consumers with nullability at each hop**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-10T13:46:39Z
- **Completed:** 2026-03-10T13:53:23Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- maps_to edges created between matching ecto/proto field names within same repo during both full and surgical indexing
- Cleanup paths (clearRepoEntities, clearRepoEdges) prevent duplicate edges on re-index via bidirectional field edge deletion
- analyzeFieldImpact traces a field name across repos: ecto origins -> proto boundaries (enriched with Kafka topics) -> downstream consumers with nullability at every hop
- Compact formatter respects 4000 char MCP response budget

## Task Commits

Each task was committed atomically:

1. **Task 1: Field edge creation in writer + cleanup paths** - `f014381` (feat)
2. **Task 2: analyzeFieldImpact core function + formatters** - `ef6edf7` (feat)

_Both tasks followed TDD: failing tests first, then implementation._

## Files Created/Modified
- `src/types/entities.ts` - Added 'maps_to' to RelationshipType union
- `src/indexer/writer.ts` - insertFieldEdges(), field edge cleanup in clearRepoEntities/clearRepoEdges, wired into persistRepoData and persistSurgicalData
- `src/search/field-impact.ts` - analyzeFieldImpact() + formatFieldImpactCompact() + result types
- `tests/indexer/writer.test.ts` - 7 new tests for field edge creation, N:M matching, no-dups, surgical, graphql exclusion
- `tests/search/field-impact.test.ts` - 8 tests for field impact analysis (origins, boundaries, consumers, topics, nullability, compact format)

## Decisions Made
- Field edges are deleted via both `source_id IN (fields)` and `target_id IN (fields)` subqueries, because surgical re-index may delete one side (ecto field) before cleanup runs on the other side (proto field). This prevents orphaned edges.
- Ecto fields in repos that are downstream via Kafka are classified as consumers, not origins. Origins are ecto fields in repos that aren't downstream consumers.
- Kafka topics for boundaries are extracted from the in-memory service graph's forward edges (mechanism=kafka/event), not from raw edges table, for consistency with the graph model.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Bidirectional field edge cleanup in clearRepoEdges**
- **Found during:** Task 1 (field edge cleanup)
- **Issue:** Plan specified `DELETE FROM edges WHERE source_type = 'field' AND source_id IN (...)` which misses edges where the source field was already deleted by clearRepoFiles in surgical path
- **Fix:** Added both source_id and target_id deletion queries to catch edges where either end's field still exists
- **Files modified:** src/indexer/writer.ts
- **Verification:** Surgical persist test passes (edge count goes to 0 after field rename)
- **Committed in:** f014381

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for surgical re-index correctness. No scope creep.

## Issues Encountered
- Kafka topic tests initially failed because test edges used direct repo-to-repo inserts. The graph resolves kafka edges via topic-mediated producer/consumer pairs. Fixed tests to use proper produces_kafka/consumes_kafka pairs with topic metadata.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- analyzeFieldImpact and formatFieldImpactCompact ready for MCP tool + CLI wiring in Plan 02
- insertFieldEdges exported and available for any future callers
- 786 tests passing, zero regressions

---
*Phase: 31-field-edges-field-impact*
*Completed: 2026-03-10*
