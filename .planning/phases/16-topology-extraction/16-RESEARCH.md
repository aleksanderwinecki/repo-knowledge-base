# Phase 16: Topology Extraction - Research

**Researched:** 2026-03-08
**Domain:** Service-to-service communication edge extraction from Elixir source code (gRPC, HTTP, Kafka) and TypeScript gateway config
**Confidence:** HIGH

## Summary

Phase 16 adds four topology extractors to the indexing pipeline: gRPC client detection, HTTP client detection, gateway routing extraction, and Kafka producer/consumer wiring. All four produce edges in the existing polymorphic `edges` table with a new `metadata` JSON column (V7 migration) that stores mechanism-specific context (service name, topic, endpoint, confidence).

The existing codebase already has partial gRPC stub extraction (`extractGrpcStubs()` in elixir.ts) and Kafka consumer detection (`detectConsumers()` in events.ts). The new extractors will extend these and add HTTP client and gateway routing as new extraction sources. The key architectural constraint is that extractors run in Phase 2 (parallel, no DB access) and produce data structures that Phase 3 (sequential) resolves to entity IDs and persists.

Real-world investigation of ~10 Fresha repos reveals three distinct gRPC client patterns, two Kafka patterns (Kafkaesque consumer/producer and Outbox-based producer), minimal HTTP client usage (mostly `Req.post` to external APIs, not inter-service), and two gateway architectures (GraphQL Mesh with TypeScript `compose/services/*.ts` definitions, and Envoy with YAML route configs). The gateway patterns are TypeScript/YAML -- not Elixir -- which means the gateway extractor must handle non-Elixir file types.

**Primary recommendation:** Build four extractors in `src/indexer/topology/`, add `edges.metadata` column via V7 migration, add `topologyEdges` to `ExtractedRepoData`, and integrate into the pipeline. Do NOT generalize `findLinkedRepos()` or add `--mechanism` filter in this phase -- those are Phase 17 (TOPO-05/06/07).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TOPO-01 | gRPC client/server call extraction across all repos (proto imports, service stubs) | Three real patterns identified: `use RpcClient.Client stub:`, `use RpcClient.MockableRpcClient behaviour:`, and direct `.Stub.method()` calls. Existing `extractGrpcStubs()` covers pattern 3; patterns 1-2 need new regexes. The `stub:` and `behaviour:` keywords contain the service name. |
| TOPO-02 | HTTP client module extraction (Tesla/HTTPoison base_url, endpoint patterns) | Real repos show `Req.post(api_url <> path, ...)` and `HTTPoison.get!(url, ...)` patterns. These call external APIs (LLM, Google OAuth), NOT inter-service. Tesla `base_url` middleware pattern not found in sampled repos. Low extraction yield expected -- mark with `confidence: "low"`. |
| TOPO-03 | Gateway routing config extraction (compose/services definitions, schema sources) | Two gateway patterns found: (1) Partners API gateway uses TypeScript `compose/services/*.ts` with `describe({ name, schemaSource: { repo } })` pattern; (2) Internal gateway uses Envoy YAML with `route.cluster` mappings. Both are non-Elixir. |
| TOPO-04 | Kafka producer/consumer wiring extraction (topic names, handler modules) | Two producer patterns: `Kafkaesque.Producer.produce_batch(@worker_name, @topic_name, ...)` and `Outbox.emit(@topic_name, ...)`. Consumer pattern: `use Kafkaesque.Consumer, topics_config: %{ "topic.name" => ... }`. Existing `events.ts` already catches consumers but doesn't extract topic names as metadata. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.0.0 | DB with edges table | Already in use; edges table handles all relationship types |
| TypeScript | ^5.7.0 | Implementation language | Strict mode with noUncheckedIndexedAccess |
| vitest | ^3.0.0 | Testing | Existing test framework |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| js-yaml | - | Parse Envoy YAML configs | Only if internal gateway extraction is in scope (see Open Questions) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex extraction | tree-sitter-elixir | AST accuracy vs. heavy dependency; regex is sufficient for well-structured macro patterns (REQUIREMENTS.md: "AST-based parsing out of scope") |
| js-yaml for Envoy configs | Manual regex on YAML | YAML parsing is fragile with regex; but internal gateway may be deferred |

**Installation:**
```bash
# No new dependencies needed for TOPO-01, TOPO-02, TOPO-04
# Only if TOPO-03 includes Envoy YAML parsing:
npm install js-yaml && npm install -D @types/js-yaml
```

## Architecture Patterns

### Recommended Project Structure
```
src/indexer/topology/
  index.ts           # Barrel export + orchestrator: extractTopologyEdges()
  grpc-clients.ts    # TOPO-01: gRPC client detection from Elixir files
  http-clients.ts    # TOPO-02: HTTP client detection from Elixir files
  gateway.ts         # TOPO-03: Gateway routing config extraction
  kafka.ts           # TOPO-04: Kafka producer/consumer topic wiring
  types.ts           # TopologyEdge interface, shared types
```

### Pattern 1: TopologyEdge Intermediate Type
**What:** A new intermediate data structure produced by extractors, consumed by the persistence layer.
**When to use:** Always -- this is the output of all four extractors.
**Example:**
```typescript
// Source: codebase analysis of EdgeData + research findings
export interface TopologyEdge {
  mechanism: 'grpc' | 'http' | 'gateway' | 'kafka';
  sourceFile: string;
  targetServiceName: string;    // Unresolved name (e.g., "Rpc.Partners.V1.RPCService")
  metadata: Record<string, string>;  // mechanism-specific: { stub, rpc, topic, endpoint, etc. }
  confidence: 'high' | 'medium' | 'low';
}
```

### Pattern 2: Extractor Function Signature
**What:** Each topology extractor follows the established `(repoPath, branch) => Data[]` pattern.
**When to use:** All extractors.
**Example:**
```typescript
// Matches existing extractElixirModules, extractProtoDefinitions patterns
export function extractGrpcClientEdges(
  repoPath: string,
  branch: string,
  elixirModules: ElixirModule[],  // Reuse already-parsed data when possible
): TopologyEdge[];
```

### Pattern 3: Integration into ExtractedRepoData
**What:** Add `topologyEdges: TopologyEdge[]` to the `ExtractedRepoData` interface.
**When to use:** Pipeline integration.
**Example:**
```typescript
interface ExtractedRepoData {
  // ... existing fields ...
  topologyEdges: TopologyEdge[];  // NEW: from extractTopologyEdges()
}
```

### Pattern 4: Edge Persistence with Metadata
**What:** Persist TopologyEdge[] to the edges table with JSON metadata column.
**When to use:** Phase 3 persistence.
**Example:**
```typescript
function insertTopologyEdges(
  db: Database.Database,
  repoId: number,
  edges: TopologyEdge[],
): void {
  const insertEdge = db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  for (const edge of edges) {
    // Resolve targetServiceName to entity ID (service or repo)
    const target = resolveTarget(db, edge);
    if (!target) continue;

    insertEdge.run(
      'repo', repoId,
      target.type, target.id,
      mapMechanismToRelationshipType(edge),
      edge.sourceFile,
      JSON.stringify({ ...edge.metadata, confidence: edge.confidence }),
    );
  }
}
```

### Anti-Patterns to Avoid
- **DB access in extractors:** Topology extractors MUST NOT query the DB to resolve service names. Return raw names; resolve in Phase 3.
- **Duplicating existing gRPC edges:** The current `insertGrpcClientEdges()` already creates `calls_grpc` edges. The new topology extractor must either replace it or coordinate to avoid duplicate edges.
- **Separate tables per edge type:** DO NOT create `grpc_edges`, `http_edges`, `kafka_edges` tables. Use the existing polymorphic `edges` table with `metadata` JSON.
- **Over-extracting from test files:** Filter out files in `test/`, `spec/`, `*_test.exs` paths to avoid false positives from mocks and test fixtures.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing for Envoy configs | Custom regex YAML parser | `js-yaml` (if needed) | YAML is too complex for regex; template variables add complexity |
| Service name resolution | Custom fuzzy matcher | DB lookups with exact + LIKE fallback | Follow existing `insertGrpcClientEdges()` pattern which already does exact + LIKE |
| Elixir file reading from git | Custom git plumbing | Existing `readBranchFile()` / `listBranchFiles()` | Already battle-tested across 400+ repos |

**Key insight:** The gateway extractor is the only one that touches non-Elixir files (TypeScript, YAML). The other three all process `.ex` files that are already available from the Elixir extractor's file listing.

## Common Pitfalls

### Pitfall 1: Duplicate gRPC Edges
**What goes wrong:** The existing `insertGrpcClientEdges()` in pipeline.ts already creates `calls_grpc` edges from `elixirModules[].grpcStubs`. If the new topology gRPC extractor also produces `calls_grpc` edges, you get duplicates.
**Why it happens:** Two code paths creating the same edge type without awareness of each other.
**How to avoid:** The new topology gRPC extractor should REPLACE the existing `insertGrpcClientEdges()`. Move that logic into `topology/grpc-clients.ts`, delete the standalone function from pipeline.ts, and ensure the dedup logic (using `seenServiceIds` set) carries over. The existing `extractGrpcStubs()` in elixir.ts stays -- it's an extractor, not a writer.
**Warning signs:** Edge count doubles after integration; `kb deps` shows the same service twice.

### Pitfall 2: Gateway Config Is Not Elixir
**What goes wrong:** You build the gateway extractor assuming Elixir `.ex` files. But the Partners API gateway is TypeScript (`compose/services/*.ts`) and the Internal gateway is Envoy YAML.
**Why it happens:** The rest of the extractors process Elixir; the gateway is the exception.
**How to avoid:** The gateway extractor must: (1) detect gateway repos by checking for `compose/services/` directory or `config/*.yaml.template` files, (2) parse TypeScript with regex (the `describe({ name, schemaSource: { repo } })` pattern is simple enough), (3) optionally parse YAML with `js-yaml`.
**Warning signs:** Gateway repos show zero topology edges; gateway extractor only looks for `.ex` files.

### Pitfall 3: Conflating Kafka Event Edges with Topology Edges
**What goes wrong:** The existing `detectEventRelationships()` already creates `produces_event` / `consumes_event` edges. The new Kafka topology extractor creates similar edges but with topic metadata. Now you have two parallel systems creating Kafka-related edges with different semantics.
**Why it happens:** The original event detection was proto-message-centric (message name as event identity). The new topology extraction is topic-centric (topic name as the communication channel).
**How to avoid:** Keep the existing event edges for proto-message-level relationships (essential for event catalog and `kb deps` event traversal). Add NEW `produces_kafka` / `consumes_kafka` edge types for topic-level wiring, with topic name in metadata. These are complementary, not overlapping: event edges answer "who produces/consumes this proto message?", topic edges answer "which repos talk over this Kafka topic?".
**Warning signs:** If you try to merge them, the `insertEventEdges()` function breaks because it expects proto message names, not topic names.

### Pitfall 4: Generated Client Files Overwhelm Edge Count
**What goes wrong:** Generated gRPC client files (e.g., `lib/generated/rpc/customers/v1/customers_service_client_impl.ex`) contain `use RpcClient.Client, stub:` declarations. These represent the SERVICE DEFINITION, not the actual CLIENT USAGE. A repo that imports a generated client doesn't necessarily call every RPC. Counting these creates noise.
**Why it happens:** Generated files exist alongside hand-written client modules (`lib/checkout/grpc_clients/customers.ex`). Both patterns match the stub regex.
**How to avoid:** Deduplicate by service name, not by file. The `MockableRpcClient` pattern (`behaviour: Rpc.Customers.V1.RPCService.ClientBehaviour`) is the actual client binding. The `RpcClient.Client` in generated files is the implementation. Prioritize `MockableRpcClient` matches (they indicate the repo actively calls this service). If only generated `RpcClient.Client` matches exist, still include them but note the generated provenance in metadata.
**Warning signs:** Every repo appears to call every service; edge count is unrealistically high.

### Pitfall 5: HTTP Client Extraction Returns External API Calls, Not Inter-Service
**What goes wrong:** You extract `HTTPoison.get!`, `Req.post`, etc. and assume they're inter-service HTTP calls. In reality, most Fresha HTTP calls are to EXTERNAL services (Google OAuth, LLM APIs, Adyen, etc.), not to other Fresha microservices.
**Why it happens:** Inter-service communication at Fresha is done via gRPC and Kafka, not HTTP. HTTP clients talk to third-party APIs.
**How to avoid:** Look for patterns that indicate inter-service HTTP: Tesla middleware with `base_url` pointing to internal domains, or module names containing "Client" + an internal service name. If a URL contains `google.com`, `openai`, `adyen`, etc., skip it. Set `confidence: "low"` on all HTTP edges.
**Warning signs:** HTTP edges point to "google", "openai", "adyen" instead of internal services.

## Code Examples

### gRPC Client Detection Patterns (Verified from Real Repos)

```typescript
// Source: analysis of app-checkout, app-appointments, app-availability repos

// Pattern 1: MockableRpcClient (hand-written client wrappers)
// Example: Checkout.GrpcClients.Appointments
// File: src/apps/checkout/lib/checkout/grpc_clients/appointments.ex
const MOCKABLE_RPC_RE = /use\s+RpcClient\.MockableRpcClient,\s*\n?\s*behaviour:\s*([\w.]+)/g;
// Captures: "Rpc.Appointments.V1.RPCService.ClientBehaviour"
// Target service: extract from "Rpc.{ServiceName}.V1" -> "Appointments"

// Pattern 2: Generated RpcClient.Client (auto-generated client impls)
// Example: Fresha.Catalog.Protobuf.Rpc.V1.CatalogRpcService.Client
// File: src/apps/availability/lib/generated/.../catalog_service_client_impl.ex
const RPCCLIENT_CLIENT_RE = /use\s+RpcClient\.Client,\s*service:\s*([\w.]+),\s*stub:\s*([\w.]+)/g;
// Captures: service = "Fresha.Catalog.Protobuf.Rpc.V1.CatalogRpcService",
//           stub = "Fresha.Catalog.Protobuf.Rpc.V1.CatalogRpcService.Stub"

// Pattern 3: Direct Stub.method() calls (already in extractGrpcStubs)
// Example: Rpc.Partners.V1.RPCService.Stub.get_provider(request)
const STUB_CALL_RE = /(\w+(?:\.\w+)*)\.Stub\.(\w+)\s*\(/g;
// Already handled by existing extractGrpcStubs() -- reuse
```

### Kafka Topic Detection Patterns (Verified from Real Repos)

```typescript
// Source: analysis of app-appointments, app-checkout repos

// Producer Pattern 1: @topic_name module attribute + Kafkaesque.Producer
// Example: Appointments.Events.AppointmentsHydration
const TOPIC_ATTR_RE = /@topic_name\s+"([\w.-]+)"/g;
// Captures: "appointments.hydration-events-v1"

// Producer Pattern 2: Outbox.emit(@topic_name, ...) -- topic in module attribute
// Already covered by @topic_name extraction above

// Consumer Pattern: Kafkaesque.Consumer topics_config
// Example: AppointmentsEventsConsumers.OrderEvents.MessageHandler
const TOPICS_CONFIG_RE = /topics:\s*\["([\w.-]+)"\]/g;
// ConsumerSupervisor variant -- captures topic name
// Also: topics_config with map keys (already in events.ts)
```

### Gateway Service Detection Patterns (Verified from Real Repos)

```typescript
// Source: analysis of app-partners-api-gateway (TypeScript)

// Pattern: compose/services/*.ts files with describe({ name, schemaSource: { repo } })
// Each service definition maps a gateway service name to a source repo
const DESCRIBE_RE = /describe\(\{\s*name:\s*"(\w+)",\s*schemaSource:\s*\{\s*repo:\s*"([\w-]+)"/g;
// Captures: name = "Appointments", repo = "app-appointments"
// Creates edge: gateway-repo --routes_to--> app-appointments
```

### V7 Migration (edges.metadata column)

```typescript
// Source: codebase analysis of migrations.ts pattern
function migrateToV7(db: Database.Database): void {
  db.exec(`
    ALTER TABLE edges ADD COLUMN metadata TEXT;
  `);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `extractGrpcStubs()` only finds `.Stub.method()` calls | Three gRPC patterns: MockableRpcClient, RpcClient.Client, Stub.method() | This phase | Captures 3x more gRPC connections |
| Event edges are proto-message-centric only | Topic-level Kafka edges complement proto-message edges | This phase | Enables topic-based dependency traversal |
| No HTTP or gateway edge detection | HTTP + gateway extractors added | This phase | First inter-service HTTP and gateway routing visibility |
| Edges have no metadata | `edges.metadata` JSON column stores mechanism-specific context | V7 migration | Enables rich context on dependency queries |

**Deprecated/outdated:**
- The standalone `insertGrpcClientEdges()` function in pipeline.ts should be absorbed into the topology framework to avoid duplicate edge creation.

## Open Questions

1. **Should the internal gateway (Envoy YAML) be in scope?**
   - What we know: It uses Envoy YAML templates (`config/partners-app-grpc.yaml.template`) that map gRPC RPC paths to backend clusters. Complex format with template variables.
   - What's unclear: Whether the value (mapping RPC paths to clusters) justifies the implementation cost (YAML parsing, template variable handling). The Partners API gateway (TypeScript compose/services) is simpler and higher value.
   - Recommendation: Start with the Partners API gateway only. Defer internal gateway to a follow-up. The Envoy YAML is a config template, not source code -- it's harder to parse reliably.

2. **How to handle the overlap between existing gRPC edge insertion and new topology edges?**
   - What we know: `insertGrpcClientEdges()` already creates `calls_grpc` edges. The new topology extractor also produces gRPC edges with richer metadata.
   - What's unclear: Whether to keep both (deduplicate at write time) or replace the old function entirely.
   - Recommendation: Replace `insertGrpcClientEdges()` with the new topology framework. The topology gRPC extractor is a superset -- it captures the same `.Stub.method()` pattern PLUS `MockableRpcClient` and `RpcClient.Client` patterns. Migrate the existing `seenServiceIds` dedup logic.

3. **How to map extracted service names to repo names?**
   - What we know: gRPC stub references like `Rpc.Customers.V1.RPCService.Stub` need to be mapped to the repo `app-customers`. The mapping is: extract the domain name ("Customers"), lowercase it, and look for repos with that name in the DB or do a fuzzy match.
   - What's unclear: Whether the mapping is reliable enough across 400+ repos.
   - Recommendation: Use the existing service entity table for resolution. The proto extractor already creates service entities with names like "RPCService" from proto files. Use the stub's qualified name to match services, then join to repos. For cases where service resolution fails, store the edge with `target_type: 'service_name'` (unresolved) and `metadata.unresolved: true`.

4. **Should HTTP client edges even be created given the findings?**
   - What we know: Real Fresha repos primarily use HTTP clients for external API calls (Google, OpenAI, Adyen), not inter-service communication. Inter-service is gRPC + Kafka.
   - What's unclear: Whether any repos use Tesla with `BaseUrl` pointing to internal services.
   - Recommendation: Still implement the HTTP extractor but with very conservative matching: only extract when the module name or URL pattern suggests an internal service. Set `confidence: "low"` on all HTTP edges. This fulfills TOPO-02 while being honest about the signal quality.

## Validation Architecture

> Skipped: `workflow.nyquist_validation` not present in config, but `mode: "yolo"` suggests light validation approach.

### Test Strategy
| Test Type | Scope | Command |
|-----------|-------|---------|
| Unit tests for each extractor | Parse sample Elixir/TS content, verify edges | `npx vitest run tests/indexer/topology/` |
| Integration test | Full pipeline with topology edges persisted to DB | `npx vitest run tests/indexer/` |
| Regression test | Existing dependency query still works with new edge types | `npx vitest run tests/search/dependencies.test.ts` |

### Test Fixtures Needed
- Sample Elixir files with `use RpcClient.MockableRpcClient, behaviour: ...`
- Sample Elixir files with `use RpcClient.Client, service: ..., stub: ...`
- Sample Elixir files with `@topic_name "..."` and `Kafkaesque.Producer.produce_batch`
- Sample Elixir files with `use Kafkaesque.Consumer, topics_config: %{ "topic" => ... }`
- Sample TypeScript gateway service definitions with `describe({ name, schemaSource: { repo } })`

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all `src/` files in repo-knowledge-base (pipeline.ts, writer.ts, elixir.ts, events.ts, dependencies.ts, schema.ts, migrations.ts, types/entities.ts)
- Direct analysis of real Fresha repos: app-appointments, app-checkout, app-availability, app-blast-marketing, app-b2c-users, app-customers, app-loyalty
- Direct analysis of gateway repos: app-partners-api-gateway (TypeScript compose/services), app-internal-gateway (Envoy YAML), app-b2c-api-gateway (Node.js)
- Verified regex patterns against actual file contents from `git show main:path`

### Secondary (MEDIUM confidence)
- .planning/research/ARCHITECTURE.md -- edge model, pipeline architecture, component map
- .planning/research/FEATURES.md -- feature dependencies, table stakes assessment
- .planning/research/PITFALLS.md -- topology regex accuracy pitfall (#5), breaking edge semantics pitfall (#7)
- .planning/research/STACK.md -- no-new-deps recommendation for topology
- .planning/research/SUMMARY.md -- build order rationale, risk assessment

## Metadata

**Confidence breakdown:**
- gRPC extraction patterns: HIGH -- verified against 3 real repos, 3 distinct patterns identified and regex-tested
- Kafka extraction patterns: HIGH -- verified against 2 real repos, producer/consumer patterns well-structured
- Gateway extraction patterns: MEDIUM -- verified against 1 gateway repo (Partners), format is clear but only one example
- HTTP extraction patterns: LOW -- real repos show mostly external API calls, not inter-service; low extraction yield expected
- Schema migration: HIGH -- follows established V1-V6 pattern, additive ALTER TABLE only
- Pipeline integration: HIGH -- follows established ExtractedRepoData pattern exactly

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (stable -- patterns in real repos change slowly)
