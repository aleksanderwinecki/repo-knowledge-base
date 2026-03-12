# Phase 37: Event Consumer Tracking - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Close the "0 consumers" blind spot in `kb_field_impact` by linking Kafka topic subscriptions to the event schemas published on those topics. A service that subscribes to a topic carrying an event with field X is a consumer of field X — even if it doesn't store the field locally. Does NOT include gRPC request/response field tracing (that's a deeper data lineage feature for a future phase).

</domain>

<decisions>
## Implementation Decisions

### Consumer definition
- A service qualifies as a "consumer" of a field if it subscribes to a Kafka topic that carries an event containing that field — topic-level subscription alone is sufficient
- No requirement for the consumer to also have a local ecto/graphql field with the same name
- Both signals merged: topic-inferred consumers AND ecto-field-match consumers both appear in the consumers list
- A service found by both signals gets stronger confidence

### Topic-to-event bridging
- Use both produces_event/consumes_event AND produces_kafka/consumes_kafka edges for bridging — cover both EventCatalog and Kafka edge types
- If a topic has multiple events published on it, all events' fields are attributed to all consumers of that topic (conservative but correct — the consumer CAN see that field)
- EventCatalog metadata can be used as a bridge source but should not be trusted 100% — it can be outdated

### Consumer confidence & display
- Two confidence tiers: 'inferred' (topic-only, can't prove they use the specific field) and 'confirmed' (ecto field name match)
- Consumer entries show WHY they're a consumer: the topic and event that linked them (e.g., "app-scheduler subscribes to booking.resource via ResourceCreated which has capacity")
- MCP compact format: keep existing shape + add 'via' field showing topic+event chain and confidence

### Claude's Discretion
- Whether to materialize topic→event links at index time or compute at query time
- How to establish topic→event mapping (same-repo co-occurrence, naming convention, or hybrid)
- Whether to show both signals (topic chain + ecto match) when a consumer has both, or just the strongest
- 4KB budget: keep existing or bump for field-impact
- CLI output format for consumer chain verbosity

### Kafka pattern coverage
- Researcher should check how many Fresha services use non-Kafkaesque consumer patterns (Broadway, GenStage, brod, KafkaEx)
- If >10% of services use non-Kafkaesque patterns, include new extraction patterns in this phase
- Researcher should also check producer patterns beyond @topic_name + Kafkaesque.Producer + Outbox.emit
- Researcher should check EventCatalog for explicit topic-to-event mapping in MDX/YAML files

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/indexer/topology/kafka.ts`: Already extracts Kafka producer/consumer edges (Kafkaesque.Consumer, OneOffConsumer, ConsumerSupervisor, @topic_name + Producer, Outbox.emit) — extend for new patterns if needed
- `src/search/graph.ts`: Builds in-memory service graph with Kafka topic resolution (lines 130-192) — already resolves topic→producer/consumer links, can be extended for topic→event bridging
- `src/search/field-impact.ts`: Core function `analyzeFieldImpact()` — the consumer classification logic at lines 179-195 needs the main modification
- `src/search/field-impact.ts`: `formatFieldImpactCompact()` — compact formatter with truncation, needs consumer shape update

### Established Patterns
- All extractors use regex parsing (no AST) — new Kafka patterns should follow the same approach
- `TopologyEdge` interface in `src/indexer/topology/types.ts` — standard edge shape with mechanism, sourceFile, targetServiceName, metadata, confidence
- `FieldImpactResult` and `FieldImpactCompact` interfaces define the output shape — consumers need updated types
- `wrapToolHandler` HOF in MCP — wraps tools with error handling
- Existing edges table stores metadata as JSON — topic, role, confidence already captured

### Integration Points
- `src/search/field-impact.ts`: Main change — extend consumer detection to use topic→event→field chain
- `src/search/graph.ts`: May need topic→event resolution logic alongside existing event and kafka resolution
- `src/indexer/topology/kafka.ts`: Add new consumer patterns if researcher finds significant non-Kafkaesque usage
- `src/mcp/tools/field-impact.ts`: Update MCP response format for new consumer shape
- `src/cli/commands/field-impact.ts`: Update CLI output for consumer chain display

</code_context>

<specifics>
## Specific Ideas

- The user feedback that drove this phase: "kb_field_impact for capacity showed 13 origins and 8 boundaries but 0 consumers. That's a blind spot — I know the field is published in events, but the KB couldn't tell me which services actually read that field from the event payload."
- The core insight: "It's the difference between 'this field exists in a proto' and 'these 3 services actually react to changes in this field.'"
- The KB is an index, not a code duplicator — consumer detection should be structural/topological, not based on reading consumer handler code

</specifics>

<deferred>
## Deferred Ideas

- gRPC field tracing: trace a field through gRPC request/response protos between caller and callee — deeper data lineage, own phase
- Code-level consumer analysis: inspect consumer handler functions to determine which specific fields they access from event payloads — requires AST or deep regex, out of scope for an index

</deferred>

---

*Phase: 37-event-consumer-tracking*
*Context gathered: 2026-03-12*
