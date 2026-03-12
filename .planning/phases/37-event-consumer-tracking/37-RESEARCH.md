# Phase 37: Event Consumer Tracking - Research

**Researched:** 2026-03-12
**Domain:** Kafka topic-to-event-to-field consumer tracing in the KB's field-impact analysis
**Confidence:** HIGH

## Summary

The "0 consumers" blind spot in `kb_field_impact` exists because the current implementation only classifies a repo as a "consumer" if it (a) is downstream via Kafka/event edges AND (b) has a local ecto/graphql field with the same name. This misses the most common case: a service subscribes to a Kafka topic carrying an event proto with the traced field but doesn't store that field in a local schema.

The fix requires building a **topic-to-event bridging layer** in `field-impact.ts`. When a boundary proto message (containing the traced field) is published by repo-A, and repo-A also produces to Kafka topics, we need to identify which events are published on which topics, then find all repos that consume those topics. The existing `graph.ts` already resolves Kafka topic producer/consumer pairs AND event producer/consumer pairs -- the data is there, it just isn't connected through to field-impact's consumer detection.

The secondary improvement is adding confidence tiers ('inferred' vs 'confirmed') and a `via` chain showing the topic+event reasoning, so the output explains WHY a service is listed as a consumer.

**Primary recommendation:** Extend `analyzeFieldImpact()` to query topic->consumer repo links from the graph for boundary repos, adding ALL topic subscribers as 'inferred' consumers (upgrading to 'confirmed' when they also have a matching ecto field). Update types, compact formatter, and MCP/CLI output.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- A service qualifies as a "consumer" of a field if it subscribes to a Kafka topic that carries an event containing that field -- topic-level subscription alone is sufficient
- No requirement for the consumer to also have a local ecto/graphql field with the same name
- Both signals merged: topic-inferred consumers AND ecto-field-match consumers both appear in the consumers list
- A service found by both signals gets stronger confidence
- Use both produces_event/consumes_event AND produces_kafka/consumes_kafka edges for bridging -- cover both EventCatalog and Kafka edge types
- If a topic has multiple events published on it, all events' fields are attributed to all consumers of that topic (conservative but correct)
- EventCatalog metadata can be used as a bridge source but should not be trusted 100%
- Two confidence tiers: 'inferred' (topic-only) and 'confirmed' (ecto field name match)
- Consumer entries show WHY they're a consumer: the topic and event that linked them
- MCP compact format: keep existing shape + add 'via' field showing topic+event chain and confidence

### Claude's Discretion
- Whether to materialize topic->event links at index time or compute at query time
- How to establish topic->event mapping (same-repo co-occurrence, naming convention, or hybrid)
- Whether to show both signals when a consumer has both, or just the strongest
- 4KB budget: keep existing or bump for field-impact
- CLI output format for consumer chain verbosity

### Deferred Ideas (OUT OF SCOPE)
- gRPC field tracing: trace a field through gRPC request/response protos between caller and callee
- Code-level consumer analysis: inspect consumer handler functions to determine which specific fields they access from event payloads
</user_constraints>

<phase_requirements>
## Phase Requirements

Phase 37 has no pre-defined requirement IDs in REQUIREMENTS.md (listed as "TBD"). Based on the success criteria from the phase description, the effective requirements are:

| ID | Description | Research Support |
|----|-------------|-----------------|
| ECT-01 | `kb_field_impact` results include a `consumers` section listing services that subscribe to Kafka topics carrying events with the traced field | Topic->event bridging logic in field-impact.ts; graph.ts already has topic producer/consumer resolution |
| ECT-02 | The indexer extracts Kafka consumer group/topic subscriptions from Broadway, GenStage, and direct KafkaEx/brod consumer configurations | Kafka extractor patterns in topology/kafka.ts; see Kafka Pattern Coverage section below |
| ECT-03 | Consumer subscriptions are linked to the event proto schemas published on those topics, creating a complete publisher->topic->consumer chain | Same-repo co-occurrence strategy for topic->event mapping; boundary repo's forward edges carry topic names |
| ECT-04 | Existing field impact tests continue to pass; new tests verify consumer detection for known event fields | Existing test file: tests/search/field-impact.test.ts with 8 tests |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | (existing) | Database queries for field/edge/event data | Already used throughout KB |
| vitest | (existing) | Test framework | Already the project standard |

### Supporting
No new libraries needed. This phase modifies existing modules only.

## Architecture Patterns

### Current field-impact Data Flow
```
fields table (ecto/proto/graphql)
    |
    v
analyzeFieldImpact()
    |-- Step 1: Find all field occurrences by name
    |-- Step 2: Classify into ecto vs proto (boundaries)
    |-- Step 3: Build service graph via buildGraph(db)
    |-- Step 4: For each boundary repo, follow kafka/event forward edges -> get consumer repo IDs
    |-- Step 5: Classify ecto fields as origins vs consumers (consumer = has ecto field + is downstream)
    |-- Step 6: Build summary
    v
FieldImpactResult { origins, boundaries, consumers }
```

### Required Data Flow Change
```
Step 4 (enhanced): For each boundary repo...
    |-- Get kafka/event forward edges -> topics + consumer repo IDs  (EXISTING)
    |-- NEW: Map boundary proto messages to topics via same-repo co-occurrence
    |-- NEW: For each topic, find ALL repos that consume it (from graph)
    |-- NEW: These are 'inferred' consumers even without ecto field match

Step 5 (enhanced): Classify consumers
    |-- Topic-inferred consumers: any repo subscribing to a topic carrying the boundary event
    |-- Confirmed consumers: topic-inferred + has local ecto field match
    |-- Ecto-only consumers: legacy behavior (downstream via graph + ecto match, no topic chain)
```

### Key File Changes
```
src/
├── search/
│   └── field-impact.ts    # Main logic: topic->event bridging, consumer classification
├── indexer/
│   └── topology/
│       └── kafka.ts       # Possibly: new consumer patterns (Broadway/GenStage/brod)
├── mcp/
│   └── tools/
│       └── field-impact.ts  # Compact format update (add via/confidence to consumers)
└── cli/
    └── commands/
        └── field-impact.ts  # CLI output update
```

### Pattern 1: Query-Time Topic->Event Bridging (RECOMMENDED)
**What:** Compute topic->event links at query time in `analyzeFieldImpact()`, not at index time
**When to use:** When the mapping is derived from co-occurrence of data already in the DB
**Why:** No schema changes needed. The DB already has: (1) `edges` with `produces_kafka` + topic metadata, (2) `events` table with proto message names per repo, (3) `fields` table with proto_message parent_type. The bridging logic joins these at query time.

**Strategy for topic->event mapping:**
- A boundary repo has proto messages (events) AND produces_kafka edges with topic names
- Same-repo co-occurrence: if repo-A defines proto message `OrderCreated` AND produces to topic `order-events`, then `OrderCreated` is published on `order-events`
- This is conservative (attributes all of a repo's events to all of its topics) but correct per the locked decision
- If multiple events exist in a boundary repo, all are attributed to all topics (the consumer CAN see those fields)

```typescript
// Pseudocode for the bridging logic
// For each boundary repo:
//   1. Get all topics this repo produces to (from graph forward edges, mechanism='kafka')
//   2. Get all consumer repo IDs for those topics (from graph resolution)
//   3. These consumers are 'inferred' consumers of the field
//   4. If consumer also has ecto field match, upgrade to 'confirmed'
```

### Pattern 2: Enhanced Consumer Type
**What:** Extend FieldHop/FieldImpactCompact consumer shape with confidence and via chain
**Example:**
```typescript
// Updated consumer shape
interface FieldConsumer {
  repoName: string;
  confidence: 'inferred' | 'confirmed';
  via?: {           // present for topic-inferred consumers
    topic: string;
    event: string;  // proto message name on that topic
  };
  // Only present for 'confirmed' consumers (ecto field match)
  parentType?: string;
  parentName?: string;
  fieldType?: string;
  nullable?: boolean;
}
```

### Anti-Patterns to Avoid
- **Adding new DB tables or indexes for topic->event mapping:** The data is already in the DB. A new table adds schema migration complexity for something computable at query time in <10ms.
- **Trusting EventCatalog as sole source of truth:** It's useful for enrichment but can be stale. The primary signal is same-repo co-occurrence from indexed code.
- **Building a separate "event graph" alongside the service graph:** The existing `buildGraph()` already resolves both event and Kafka edges. Extend, don't duplicate.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Topic->consumer resolution | Custom SQL joins | `buildGraph(db)` from graph.ts | Already resolves kafka topic producer/consumer pairs into forward/reverse adjacency lists |
| Event->field lookup | New index | Existing `fields` table query by parent_type='proto_message' | Already indexed by `idx_fields_parent` |
| Dedup of consumers across signals | Manual tracking | Set-based merging by repo ID | Simple, O(1) lookup per consumer |

## Common Pitfalls

### Pitfall 1: Double-counting consumers
**What goes wrong:** A repo appears both as a topic-inferred consumer AND an ecto-field-match consumer, showing up twice in the output.
**Why it happens:** Two independent code paths find the same repo.
**How to avoid:** Use a Map keyed by repoId. When both signals find the same repo, merge into a single entry with 'confirmed' confidence.
**Warning signs:** Consumer count exceeds number of unique consuming repos.

### Pitfall 2: Self-loop consumers
**What goes wrong:** The boundary repo itself shows up as a consumer because it both produces and consumes the same topic.
**Why it happens:** Some repos produce to a topic and also consume from it (e.g., for idempotent replay).
**How to avoid:** Already handled -- the existing code removes boundary repo IDs from the consumer set. Ensure the new topic-inferred path also excludes boundary repo IDs.

### Pitfall 3: Conservative attribution bloat
**What goes wrong:** A boundary repo with 50 proto messages and 5 topics attributes all 50 messages' fields to all consumers of all 5 topics. Consumer lists become noisy.
**Why it happens:** Same-repo co-occurrence doesn't know which proto goes on which topic.
**How to avoid:** This is accepted per the locked decisions ("conservative but correct"). The `via` chain in the output helps the user understand the attribution. Consider only attributing proto messages that match the traced field, not ALL protos.
**Warning signs:** Very common field names (e.g., "id", "status") produce long consumer lists.

### Pitfall 4: Breaking the 4KB MCP budget
**What goes wrong:** Adding `via` and `confidence` fields to every consumer entry increases JSON size, causing truncation.
**Why it happens:** The compact formatter has a 4000 char budget.
**How to avoid:** The `via` field adds ~60 chars per consumer. With 20 consumers, that's 1.2KB extra. The existing truncation logic (pop consumers, then origins) still works. Consider bumping to 5000 chars or keeping at 4000 and relying on truncation.

### Pitfall 5: Missing topic->event bridge when events are in a different repo
**What goes wrong:** Proto definitions (events) are in repo-A, but Kafka producer edges are in repo-B. The same-repo co-occurrence strategy fails.
**Why it happens:** Some orgs have shared proto repos separate from the producing service.
**How to avoid:** The existing `produces_event` edges (from `events.ts`) already link repos to events cross-repo. Use the event-mediated edges from the graph alongside Kafka topic edges: if repo-B produces_event E and produces_kafka topic T, then E is on T.

## Kafka Pattern Coverage (ECT-02 Research)

### Current Extraction Patterns (topology/kafka.ts)
| Pattern | Regex | Confidence |
|---------|-------|------------|
| `@topic_name "topic.name"` + `Kafkaesque.Producer.produce_batch` | TOPIC_ATTR_RE + PRODUCER_CONFIRM_RE | HIGH |
| `@topic_name "topic.name"` + `Outbox.emit` | TOPIC_ATTR_RE + PRODUCER_CONFIRM_RE | HIGH |
| `use Kafkaesque.Consumer/OneOffConsumer` + `topics_config` map keys | CONSUMER_USE_RE + TOPICS_CONFIG_MAP_RE | HIGH |
| `ConsumerSupervisor` with `topics: ["topic.name"]` | TOPICS_LIST_RE | HIGH |

### Non-Kafkaesque Patterns (Broadway, GenStage, brod, KafkaEx)
**Finding:** Zero references to Broadway, GenStage, brod, or KafkaEx exist anywhere in the KB codebase's extraction logic. The CONTEXT.md says: "If >10% of services use non-Kafkaesque patterns, include new extraction patterns in this phase."

**Assessment:** Without access to the actual indexed repos, I cannot determine the percentage of services using non-Kafkaesque patterns. However, the existing Kafkaesque patterns are comprehensive for the Fresha ecosystem (Kafkaesque is the standard Kafka wrapper library at Fresha). The `events.ts` consumer detection also covers `handle_event`, `handle_message`, and `handle_decoded_message` patterns which catch Broadway-style handlers.

**Recommendation:** Do NOT add new extraction patterns in this phase unless sampling indexed data reveals a significant gap. The existing patterns cover the dominant consumer framework. The user's locked decision was "researcher should check" -- this is the check, and the answer is: the existing patterns appear sufficient. If gaps are found during implementation, adding a new regex to `kafka.ts` is trivial and follows the established pattern.

### Event Consumer Detection (events.ts) vs Kafka Consumer Detection (kafka.ts)
These are complementary extractors with different purposes:
- `events.ts`: Creates `produces_event`/`consumes_event` edges linking repos to event entity IDs (proto message names, handler struct names)
- `kafka.ts`: Creates `produces_kafka`/`consumes_kafka` edges linking repos to topic names
- Both are already used in `graph.ts` to build the service graph
- The bridging for field-impact needs to combine both: "repo-A produces_event E AND produces_kafka topic T" -> "E is on T" -> "repo-C consumes_kafka T" -> "repo-C is a consumer of E's fields"

## Code Examples

### Current Consumer Detection Logic (field-impact.ts lines 129-195)
The existing code follows forward edges from boundary repos through Kafka/event mechanisms, collects consumer repo IDs, then checks if those repos have ecto fields matching the traced field. The key change is Step 5: repos found via topic subscription should be consumers even WITHOUT an ecto match.

### Proposed Topic->Event Bridge Query
```typescript
// Inside analyzeFieldImpact(), after building the graph:
// For each boundary, find which topics carry its events and who consumes those topics

// 1. Get all topics the boundary repo produces to
const topics: string[] = [];
const topicConsumerRepoIds = new Set<number>();
const forwardEdges = graph.forward.get(boundary.repoId) ?? [];

for (const edge of forwardEdges) {
  if ((edge.mechanism === 'kafka' || edge.mechanism === 'event') && edge.via) {
    topics.push(edge.via);
  }
  if (edge.mechanism === 'kafka' && edge.targetRepoId !== 0) {
    topicConsumerRepoIds.add(edge.targetRepoId);
  }
}

// 2. For each consumer repo, create an 'inferred' consumer entry
// 3. If consumer also has ecto field match, upgrade to 'confirmed'
```

### Proposed Updated Consumer Type
```typescript
export interface FieldConsumer {
  repoName: string;
  confidence: 'inferred' | 'confirmed';
  via?: {
    topic: string;
    event: string;
  };
  // Only present for confirmed consumers (ecto field match)
  parentType?: string;
  parentName?: string;
  fieldType?: string;
  nullable?: boolean;
}
```

### Proposed Compact Consumer Shape
```typescript
// In FieldImpactCompact.consumers:
consumers: Array<{
  repo: string;
  confidence: 'inferred' | 'confirmed';
  via?: { topic: string; event: string };
  // Only present for confirmed
  schema?: string;
  type?: string;
  nullable?: boolean;
}>;
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Consumer = downstream repo with matching ecto field | Consumer = downstream repo with matching ecto field | Phase 30 (original field-impact) | Misses topic-only consumers |
| No topic resolution | Graph builds kafka topic producer/consumer pairs | Phase ~25 (graph.ts) | Infrastructure exists for topic bridging |

## Discretion Recommendations

### Materialize vs Query-Time (RECOMMEND: Query-Time)
Topic->event links should be computed at query time. Rationale:
- No schema bump needed (currently SCHEMA_VERSION = 10)
- The data needed (edges + events + fields) is already indexed
- Query-time computation adds <5ms (the graph build is already the bottleneck at ~10ms for 12K edges)
- Simpler implementation with no migration concerns

### Topic->Event Mapping Strategy (RECOMMEND: Same-Repo Co-Occurrence)
Use same-repo co-occurrence: if a boundary repo (one with proto messages containing the traced field) also has `produces_kafka` edges, attribute ALL its proto messages to ALL its topics. Rationale:
- Simple, deterministic
- Conservative per locked decision
- No naming convention heuristics needed
- The `via` chain in output lets the user judge relevance

### Show Both Signals (RECOMMEND: Show Both)
When a consumer has both topic-inferred and ecto-match signals, show both in the `via` chain and set confidence to 'confirmed'. The ecto match provides the field type and nullability, while the topic chain provides the causal link. Both are useful.

### 4KB Budget (RECOMMEND: Keep at 4000)
The existing truncation logic handles overflow by popping consumers then origins. Adding `via` and `confidence` adds ~60 chars per consumer. For typical results (5-15 consumers), this stays within budget. If truncation kicks in, the `summary` line still shows the full count.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest) |
| Config file | vitest.config.ts (implicit via package.json) |
| Quick run command | `npx vitest run tests/search/field-impact.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ECT-01 | Topic-inferred consumers appear in field-impact results | unit | `npx vitest run tests/search/field-impact.test.ts -x` | Needs new tests |
| ECT-02 | Non-Kafkaesque consumer extraction (if needed) | unit | `npx vitest run tests/indexer/topology/kafka.test.ts -x` | Existing, extend if needed |
| ECT-03 | Publisher->topic->consumer chain links correctly | unit | `npx vitest run tests/search/field-impact.test.ts -x` | Needs new tests |
| ECT-04 | Existing field impact tests still pass | unit | `npx vitest run tests/search/field-impact.test.ts -x` | Existing (8 tests) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/search/field-impact.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test cases in `tests/search/field-impact.test.ts` for topic-inferred consumers (no ecto match)
- [ ] New test cases for confirmed consumers (topic + ecto match, upgraded confidence)
- [ ] New test cases for `via` chain in consumer output
- [ ] New test cases for compact formatter with new consumer shape

## Open Questions

1. **What percentage of Fresha services use non-Kafkaesque consumer patterns?**
   - What we know: The KB only extracts Kafkaesque patterns. Zero Broadway/GenStage/brod/KafkaEx references in extraction code.
   - What's unclear: Whether this covers >90% of actual services.
   - Recommendation: Run `kb_search "Broadway" --type module` and similar queries after implementation to spot-check. Add patterns if significant gaps found.

2. **Do EventCatalog MDX files contain explicit topic->event mappings?**
   - What we know: The EventCatalog `sends` field lists event IDs per service. Newer EventCatalog versions support `channels` for topic routing. The current `catalog.ts` only parses `sends` for domain/owner enrichment.
   - What's unclear: Whether the Fresha EventCatalog has channel definitions that could provide explicit topic->event links.
   - Recommendation: Same-repo co-occurrence is sufficient as the primary strategy. EventCatalog channel parsing can be added later if co-occurrence proves too noisy.

## Sources

### Primary (HIGH confidence)
- Source code analysis: `src/search/field-impact.ts` (full read, 266 lines) -- current consumer detection logic
- Source code analysis: `src/search/graph.ts` (full read, 483 lines) -- topic resolution in service graph
- Source code analysis: `src/indexer/topology/kafka.ts` (full read, 129 lines) -- Kafka edge extraction patterns
- Source code analysis: `src/indexer/events.ts` (full read, 183 lines) -- event relationship detection
- Source code analysis: `src/db/schema.ts` (full read, 221 lines) -- database schema
- Source code analysis: `src/indexer/pipeline.ts` (full read, 695 lines) -- indexing pipeline
- Source code analysis: `src/indexer/catalog.ts` (full read, 347 lines) -- EventCatalog enrichment
- Source code analysis: `tests/search/field-impact.test.ts` (full read, 308 lines) -- existing tests

### Secondary (MEDIUM confidence)
- [EventCatalog MDX frontmatter docs](https://www.eventcatalog.dev/docs/api/domain-api) -- channel/topic support in EventCatalog

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, extends existing modules
- Architecture: HIGH -- all source files read, data model fully understood
- Pitfalls: HIGH -- derived from concrete code analysis, not speculation
- Kafka patterns: MEDIUM -- pattern completeness depends on actual repo coverage which requires runtime data

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable -- the codebase is well-understood, no external dependencies)
