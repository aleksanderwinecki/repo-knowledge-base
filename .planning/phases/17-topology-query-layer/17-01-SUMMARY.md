---
phase: 17-topology-query-layer
plan: 01
subsystem: search
tags: [topology, dependencies, grpc, http, gateway, kafka, mechanism-filter, confidence, bfs]

# Dependency graph
requires:
  - phase: 16-topology-extraction-03
    provides: Topology edges persisted in DB with JSON metadata (confidence, targetName)
provides:
  - Generalized BFS dependency traversal for all edge types (gRPC, HTTP, gateway, Kafka, events)
  - Mechanism filter restricting traversal to specific edge types
  - Confidence extraction from edge metadata JSON
  - VALID_MECHANISMS export for CLI/MCP validation
  - Unresolved edges visible as leaf nodes
  - Kafka topic-based matching across repos
affects: [17-topology-query-02-cli-mcp]

# Tech tracking
tech-stack:
  added: []
  patterns: [multi-pattern-edge-traversal, mechanism-filter-map, confidence-extraction, kafka-topic-matching]

key-files:
  created: []
  modified:
    - src/search/types.ts
    - src/search/dependencies.ts
    - src/search/index.ts
    - tests/search/dependencies.test.ts

key-decisions:
  - "Event-mediated edges display as 'event (EventName)' instead of old 'Kafka consumer (EventName)' format"
  - "Kafka topic matching done via metadata.topic field comparison across repos"
  - "Unresolved edges only shown in upstream direction (they represent outgoing calls from the queried repo)"
  - "findLinkedRepos split into 4 dedicated functions: direct, event-mediated, kafka-topic, unresolved"

patterns-established:
  - "Edge pattern handler: separate functions per edge category (direct/event/kafka/unresolved) combined in findLinkedRepos"
  - "MECHANISM_FILTER_MAP: user-facing mechanism name -> relationship_type array mapping"
  - "extractConfidence/extractMetadataField: safe JSON metadata parsing with null fallback"

requirements-completed: [TOPO-05, TOPO-06, TOPO-07]

# Metrics
duration: 5min
completed: 2026-03-08
---

# Phase 17 Plan 01: Dependency Query Engine Summary

**Generalized BFS dependency traversal for all topology edge types with mechanism filtering, confidence extraction, and kafka topic matching**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-08T12:03:38Z
- **Completed:** 2026-03-08T12:08:34Z
- **Tasks:** 1 (TDD)
- **Files modified:** 4

## Accomplishments
- Rewrote findLinkedRepos into 4 edge pattern handlers covering direct (gRPC/HTTP/gateway), event-mediated, kafka topic-matched, and unresolved edges
- DependencyNode now includes confidence field (string | null), DependencyOptions accepts mechanism filter
- MECHANISM_FILTER_MAP maps user-facing names (grpc, http, gateway, kafka, event) to relationship_type arrays
- Kafka edges matched across repos by topic name from metadata JSON
- Unresolved edges appear as leaf nodes with target name from metadata
- 24 dependency tests pass (12 existing + 12 new), 484 total tests green

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: Failing tests for generalized traversal** - `248420e` (test)
2. **Task 1 GREEN: Implement generalized query engine** - `f510fc7` (feat)

_TDD task: RED committed failing tests, GREEN committed implementation + test fixes._

## Files Created/Modified
- `src/search/types.ts` - Added confidence to DependencyNode, mechanism to DependencyOptions
- `src/search/dependencies.ts` - Rewritten with 4 edge pattern handlers, MECHANISM_FILTER_MAP, VALID_MECHANISMS export
- `src/search/index.ts` - Added VALID_MECHANISMS to barrel export
- `tests/search/dependencies.test.ts` - 12 new tests for direct edges, unresolved, kafka, mechanism filter, confidence, mixed multi-hop

## Decisions Made
- Event-mediated edges now display as "event (EventName)" instead of the old "Kafka consumer (EventName)" -- the old format was misleading since not all events are Kafka
- Split findLinkedRepos into 4 dedicated functions rather than one monolithic function with conditionals
- Unresolved edges only appear in upstream direction since they represent outgoing calls from the queried repo
- Kafka topic matching uses metadata.topic field comparison across all repos with complementary edge types

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing test assertion for new mechanism format**
- **Found during:** Task 1 GREEN (test verification)
- **Issue:** Existing test expected mechanism to contain "Kafka" but new format for event-mediated edges is "event (EventName)"
- **Fix:** Updated assertion from `.toContain('Kafka')` to `.toContain('event')`
- **Files modified:** tests/search/dependencies.test.ts
- **Verification:** All 24 tests pass
- **Committed in:** f510fc7

**2. [Rule 1 - Bug] Isolated kafka topic test to avoid visited-set collision**
- **Found during:** Task 1 GREEN (test verification)
- **Issue:** Kafka topic test used repos already connected by event edges, so the kafka path was deduplicated by BFS visited set
- **Fix:** Created dedicated kafka-producer-svc and kafka-consumer-svc repos with only kafka edges
- **Files modified:** tests/search/dependencies.test.ts
- **Verification:** Kafka topic matching test passes in isolation
- **Committed in:** f510fc7

---

**Total deviations:** 2 auto-fixed (2 bugs in tests)
**Impact on plan:** Test corrections only. No scope creep.

## Issues Encountered
None beyond the test deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Query engine fully generalized for all edge types
- VALID_MECHANISMS exported for CLI --mechanism option and MCP tool param
- Ready for Plan 02: CLI/MCP integration (add --mechanism flag, update output formatting)

## Self-Check: PASSED

All files verified on disk and commits verified in git log.

---
*Phase: 17-topology-query-layer*
*Completed: 2026-03-08*
