---
phase: 26-service-explanation
plan: 01
subsystem: search
tags: [sqlite, sql-aggregation, service-card, explain]

requires:
  - phase: 23-edge-extraction
    provides: "edge-utils.ts with DIRECT_EDGE_TYPES, EVENT_EDGE_TYPES, KAFKA_EDGE_TYPES, extractMetadataField"
provides:
  - "explainService(db, name) function for structured service cards"
  - "ExplainResult type with identity, connections, events, modules, counts, hints"
  - "Barrel export from src/search/index.ts"
affects: [26-02-mcp-cli-wiring]

tech-stack:
  added: []
  patterns: [pure-sql-aggregation, event-mediated-connection-resolution, kafka-topic-matching, connection-truncation]

key-files:
  created:
    - src/search/explain.ts
    - tests/search/explain.test.ts
  modified:
    - src/search/index.ts

key-decisions:
  - "Short mechanism keys (grpc, http, gateway, event, kafka) for connection map keys -- matches MECHANISM_FILTER_MAP and CLI --mechanism values"
  - "Static agent hints with <this-service> placeholder -- simpler than dynamic, all three tools always relevant"
  - "Summary line uses pre-truncation counts for accuracy"
  - "Truncation trims largest mechanism groups first, keeps at least 1 per group"

patterns-established:
  - "Pure SQL aggregation pattern: no buildGraph dependency for single-service queries"
  - "Connection resolution: direct + event-mediated + kafka-mediated with self-exclusion and deduplication"

requirements-completed: [EXPLAIN-02, EXPLAIN-03, EXPLAIN-04, EXPLAIN-05]

duration: 4min
completed: 2026-03-09
---

# Phase 26 Plan 01: Core Explain Module Summary

**explainService with pure SQL aggregation: identity, grouped connections (direct/event/kafka), events, module counts, file/gRPC counts, and agent hints**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-09T16:32:27Z
- **Completed:** 2026-03-09T16:36:13Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 3

## Accomplishments
- Built `explainService(db, name)` that aggregates repos, edges, events, modules, files, and services tables into a structured `ExplainResult`
- Full connection resolution: direct edges (grpc/http/gateway), event-mediated (produces_event -> consumes_event chain), kafka-mediated (topic matching via metadata)
- 28 unit tests covering identity, all connection types, summary line, events, modules, counts, hints, truncation, deduplication, self-exclusion, and empty/error cases

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests** - `64ab0a7` (test)
2. **Task 1 GREEN: Implementation** - `79434df` (feat)

_TDD task: test -> implementation commits_

## Files Created/Modified
- `src/search/explain.ts` - Core explain module: ExplainResult type, explainService function, connection resolution helpers, truncation, summary builder
- `tests/search/explain.test.ts` - 28 unit tests covering all card sections, edge cases, and truncation
- `src/search/index.ts` - Barrel export for explainService and ExplainResult type

## Decisions Made
- Used short mechanism keys (grpc, http, gateway, event, kafka) as map keys in talks_to/called_by -- consistent with MECHANISM_FILTER_MAP and CLI --mechanism filter values
- Static agent hints chosen over dynamic -- all three tools (kb_impact, kb_trace, kb_deps) always relevant for any service
- Summary line computed from pre-truncation data for accurate total counts
- Truncation strategy: trim from largest mechanism groups first, always keep at least 1 entry per group, add single "...and N more" marker

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `explainService` and `ExplainResult` are exported and ready for MCP/CLI wiring in Plan 02
- 667 total tests pass (28 new + 639 existing)

---
*Phase: 26-service-explanation*
*Completed: 2026-03-09*
