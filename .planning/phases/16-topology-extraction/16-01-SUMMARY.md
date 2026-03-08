---
phase: 16-topology-extraction
plan: 01
subsystem: indexer
tags: [topology, grpc, http, kafka, elixir, regex, migration, sqlite]

# Dependency graph
requires: []
provides:
  - TopologyEdge interface and TopologyMechanism type (src/indexer/topology/types.ts)
  - gRPC client edge extractor with 3 pattern variants (src/indexer/topology/grpc-clients.ts)
  - HTTP client edge extractor with external domain filtering (src/indexer/topology/http-clients.ts)
  - Kafka producer/consumer edge extractor (src/indexer/topology/kafka.ts)
  - V7 schema migration adding edges.metadata TEXT column
  - RelationshipType union expanded with calls_http, routes_to, produces_kafka, consumes_kafka
affects: [16-02, 16-03, 17-topology-queries]

# Tech tracking
tech-stack:
  added: []
  patterns: [topology-extractor-pattern, domain-based-dedup, lib-path-filtering]

key-files:
  created:
    - src/indexer/topology/types.ts
    - src/indexer/topology/grpc-clients.ts
    - src/indexer/topology/http-clients.ts
    - src/indexer/topology/kafka.ts
    - tests/indexer/topology.test.ts
  modified:
    - src/types/entities.ts
    - src/db/migrations.ts
    - src/db/schema.ts
    - tests/db/schema.test.ts
    - tests/knowledge/store.test.ts

key-decisions:
  - "gRPC dedup extracts domain name from qualified Elixir module path, prioritizing MockableRpcClient over generated clients"
  - "HTTP edges all get confidence low per research -- inter-service HTTP is rare in Fresha codebase"
  - "Kafka extractors use produces_kafka/consumes_kafka as new edge types complementary to existing produces_event/consumes_event"
  - "V7 migration is additive ALTER TABLE only -- no data transformation needed"

patterns-established:
  - "Topology extractor pattern: pure function (repoPath, branch, ...) -> TopologyEdge[] with no DB access"
  - "Domain-based dedup for gRPC: normalize qualified Elixir module names to service domain for dedup key"
  - "External URL filtering: maintain blocklist of known third-party domains to exclude from HTTP edge detection"

requirements-completed: [TOPO-01, TOPO-02, TOPO-04]

# Metrics
duration: 5min
completed: 2026-03-08
---

# Phase 16 Plan 01: Topology Extractors Summary

**Three Elixir-based topology extractors (gRPC 3-pattern, HTTP with external filtering, Kafka producer/consumer) plus V7 schema migration adding edges.metadata column**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-08T11:17:52Z
- **Completed:** 2026-03-08T11:23:30Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments
- TopologyEdge interface and TopologyMechanism type exported for all extractors
- gRPC extractor detects MockableRpcClient, RpcClient.Client, and Stub.method patterns with domain-based dedup
- HTTP extractor detects Tesla BaseUrl and @base_url patterns, filtering 35+ known external domains
- Kafka extractor detects @topic_name producers (Kafkaesque.Producer/Outbox.emit) and Kafkaesque.Consumer/ConsumerSupervisor consumers
- V7 migration adds metadata TEXT column to edges table
- SCHEMA_VERSION bumped from 6 to 7
- RelationshipType expanded with 4 new topology edge types
- 15 extractor unit tests + 4 V7 migration tests -- all 464 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: TopologyEdge types, V7 migration, and RelationshipType expansion** - `aa7a036` (feat)
2. **Task 2: gRPC, HTTP, and Kafka topology extractors with tests** - `0403b02` (feat)

## Files Created/Modified
- `src/indexer/topology/types.ts` - TopologyEdge interface and TopologyMechanism type
- `src/indexer/topology/grpc-clients.ts` - gRPC client edge extraction with 3 patterns + domain-based dedup
- `src/indexer/topology/http-clients.ts` - HTTP client edge extraction with external domain filtering
- `src/indexer/topology/kafka.ts` - Kafka producer/consumer edge extraction
- `tests/indexer/topology.test.ts` - 15 unit tests for all three extractors
- `src/types/entities.ts` - Added metadata to Edge interface, expanded RelationshipType union
- `src/db/migrations.ts` - Added migrateToV7 (ALTER TABLE edges ADD COLUMN metadata TEXT)
- `src/db/schema.ts` - SCHEMA_VERSION 6 -> 7
- `tests/db/schema.test.ts` - 4 new V7 migration tests
- `tests/knowledge/store.test.ts` - Updated SCHEMA_VERSION assertion 6 -> 7

## Decisions Made
- gRPC domain extraction uses positional analysis of qualified Elixir module names (Rpc at index 0 vs embedded) to correctly identify service domain for dedup
- HTTP confidence is universally "low" -- research confirmed Fresha uses gRPC/Kafka for inter-service, HTTP is mostly external APIs
- Kafka produces_kafka/consumes_kafka are new edge types complementary to existing proto-message-based produces_event/consumes_event

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed gRPC domain extraction for embedded Rpc namespaces**
- **Found during:** Task 2 (gRPC extractor implementation)
- **Issue:** `extractServiceDomain("Fresha.Customers.Protobuf.Rpc.V1.CustomersRpcService")` returned "V1" instead of "Customers" because naive "take part after Rpc" logic didn't account for version segments
- **Fix:** Added backward search from Rpc position for domain-like names, skipping known non-domain parts (Protobuf, Proto, Fresha)
- **Files modified:** src/indexer/topology/grpc-clients.ts
- **Verification:** Dedup test passes (MockableRpcClient + RpcClient.Client for same service -> 1 edge)
- **Committed in:** 0403b02 (Task 2 commit)

**2. [Rule 3 - Blocking] Updated store.test.ts SCHEMA_VERSION assertion**
- **Found during:** Task 2 (full regression suite)
- **Issue:** tests/knowledge/store.test.ts had hard-coded `expect(SCHEMA_VERSION).toBe(6)` which failed after V7 bump
- **Fix:** Updated assertion to expect 7
- **Files modified:** tests/knowledge/store.test.ts
- **Verification:** Full test suite passes (464/464)
- **Committed in:** 0403b02 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both fixes necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three extractors ready for pipeline integration (Plan 16-02)
- TopologyEdge[] output compatible with ExtractedRepoData pattern
- V7 migration ready -- edges.metadata column available for persistence
- Gateway extractor (gateway.ts) already exists as a preliminary file, ready for Plan 16-02/03

## Self-Check: PASSED

All 6 created files verified on disk. Both task commits (aa7a036, 0403b02) verified in git log.

---
*Phase: 16-topology-extraction*
*Completed: 2026-03-08*
