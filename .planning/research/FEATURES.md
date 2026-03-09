# Feature Landscape: v3.0 Graph Intelligence

**Domain:** Code intelligence graph traversal for AI agent consumption via MCP
**Researched:** 2026-03-09
**Update:** Adjusted for hybrid SQL+JS architecture (CTE replaced by JS BFS for traversal)

## Context

Three new tools for an existing knowledge base with ~12K topology edges across ~400 repos. All tools use SQL for data loading and JS BFS for graph traversal. Output is JSON over MCP, constrained to 4KB per response.

Existing infrastructure already provides: BFS traversal (`queryDependencies`), mechanism filtering, confidence extraction from edge metadata, `formatResponse` with recursive halving, `wrapToolHandler` HOF, `withAutoSync`.

---

## Table Stakes

Features users expect. Missing = tool feels broken.

### kb_impact (Blast Radius)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Downstream traversal from a service | Core purpose -- "what breaks if X changes?" | Low | JS BFS on in-memory adjacency list |
| Depth-grouped results (direct/indirect/transitive) | Agents need to distinguish severity | Low | Hop count from BFS |
| Mechanism label per affected service | Agent needs to know HOW impact propagates | Low | Existing `MECHANISM_LABELS` |
| Confidence level per edge | Already in edge metadata; omitting = regression from kb_deps | Low | Existing `extractConfidence` |
| Mechanism filter (`--mechanism grpc`) | Parity with kb_deps | Low | Existing `MECHANISM_FILTER_MAP` |
| Depth limit (`--depth N`, default 3) | Control response size, prevent hub explosion | Low | BFS depth counter |
| Total affected count in summary | Single number for agent decisions | Low | Array.length |
| Event/Kafka-mediated paths transparent | Two-hop repo->event->repo must collapse to single logical edge | Medium | Pre-resolve in graph builder |
| Compact response format | Must fit 300+ service blast radius in 4KB | Medium | Service names + stats, not full paths |

### kb_trace (Flow Tracing)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Shortest path between two services | Core purpose -- "how does a request get from A to B?" | Low | BFS on unweighted graph = optimal |
| Ordered hop list with mechanism per hop | Agent needs the chain, not just "path exists" | Low | Parent-pointer backtracking |
| Event/Kafka transparency in path display | `app-checkout -[kafka: payment.completed]-> app-notifications` | Medium | Same collapsing as impact |
| "No path found" vs "service not found" | Must distinguish disconnected from nonexistent | Low | Pre-check repos table |
| Path summary string | One-liner agent can paste into explanations | Low | String join from hop array |

### kb_explain (Service Summary)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Service name + description | Basic identity | Low | repos.description |
| Inbound connections grouped by mechanism | "Who calls this service?" | Low | Edges WHERE target = repo |
| Outbound connections grouped by mechanism | "What does this service call?" | Low | Edges WHERE source = repo |
| Events produced/consumed | Key for async behavior understanding | Low | Event edges |
| Entity counts (modules, events, services) | "How big is this?" | Low | COUNT on entities table |
| Repo metadata (path, branch, last commit) | Agent needs to know where to look | Low | repos table |

---

## Differentiators

Features that set these tools apart from manually combining kb_deps + kb_entity + kb_search.

### kb_impact

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Severity tiers (direct/indirect/transitive) | Depth 1 = "will break", 2+ = "may break" | Low | Map depth to tier label |
| Aggregated mechanism summary | "3 via gRPC, 2 via Kafka" in stats block | Low | Group-by before serialization |
| Blast radius score | Single number for commit messages / PR descriptions | Low | Count distinct services |
| Sub-millisecond response | 0.6ms JS BFS vs seconds of manual investigation | Low | Already achieved via architecture |

### kb_trace

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Annotated hops with confidence | Each hop shows [high]/[medium]/[low] | Low | Already in edge metadata |
| Min-path confidence | Weakest link in the chain highlighted | Low | Track min through BFS |

### kb_explain

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| "Talks to" and "called by" summaries | Quick topology overview | Low | COUNT on edge groups |
| Top modules by type | Shows what service DOES, not just what it connects to | Low | GROUP BY type on modules |
| Next-step hints | `"Run kb_impact app-payments to see blast radius"` | Low | Static strings based on result |

---

## Anti-Features

Features to explicitly NOT build.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Neo4j / external graph DB | 12K edges fits in a JS Map (~12MB). Adding infrastructure for zero performance gain. | JS BFS on SQLite-loaded adjacency list |
| Visual graph rendering (SVG/ASCII) | Agents consume JSON. 4KB cap makes graphics impractical. | Structured JSON with path_summary strings |
| All-pairs shortest path precomputation | O(V^2) storage for 400 repos = 160K entries. Called occasionally. | On-demand BFS, 0.2ms per query |
| Code-level impact (function granularity) | Needs AST parsing (tree-sitter), different graph, larger storage | Service-level blast radius is the right abstraction |
| Architecture rules engine | "X should not call Y" is a different concern | Defer to future milestone; these are read-only tools |
| Weighted edges / importance scoring | No reliable signal for weight exists | Use existing confidence levels (high/medium/low) |
| Historical graph comparison | Requires snapshots, diffing, schema expansion | Out of scope. git log serves indirectly. |
| Recursive CTEs for traversal | 200-1000x slower than JS BFS (benchmarked) | SQL for loading, JS for traversal |
| Graph algorithm library | BFS is 20 lines on 400 nodes | Hand-written, zero dependencies |
| Edge caching layer | 9ms load, 2-second budget = 200x headroom | Add only if profiling shows need |

---

## Feature Dependencies

```
Existing edges table (v2.0)
  |
  +-- Graph module (src/search/graph.ts)
  |     +-- Adjacency list builder (SQL load + JS construction)
  |     +-- Event/Kafka intermediate node resolution
  |     +-- BFS downstream traversal
  |     +-- BFS shortest path
  |
  +-- kb_impact (uses graph.bfsDownstream)
  |     +-- mechanism filter
  |     +-- compact response formatter
  |
  +-- kb_trace (uses graph.shortestPath)
  |     +-- path reconstruction
  |     +-- mechanism annotations
  |
  +-- kb_explain (NO dependency on graph module)
        +-- Multi-table SQL aggregation
        +-- repos + entities + edges

kb_impact and kb_trace share the graph module.
kb_explain is fully independent -- can be built in parallel.
All three share: wrapToolHandler, formatResponse, withAutoSync, zod schemas.
```

---

## MCP Output Format Design

### kb_impact Response

```json
{
  "summary": "app-payments: 47 downstream services, max depth 4",
  "services": [
    { "name": "app-checkout", "mechanism": "grpc", "confidence": "high", "depth": 1, "tier": "direct" }
  ],
  "total": 47,
  "truncated": false,
  "stats": {
    "direct": 8, "indirect": 15, "transitive": 24,
    "by_mechanism": { "grpc": 12, "kafka": 23, "http": 8, "event": 4 }
  },
  "hints": ["Use --mechanism grpc to filter to gRPC-only impact"]
}
```

**Key:** `stats` block survives truncation (in envelope, not in `services` array). Service names are compact. Paths omitted by default.

### kb_trace Response

```json
{
  "summary": "Path found: app-gateway -> app-checkout -> app-payments (2 hops)",
  "hops": [
    { "from": "app-gateway", "to": "app-checkout", "mechanism": "gateway", "confidence": "medium" },
    { "from": "app-checkout", "to": "app-payments", "mechanism": "grpc", "confidence": "high" }
  ],
  "path_summary": "app-gateway -[gateway]-> app-checkout -[grpc]-> app-payments",
  "total_hops": 2,
  "min_confidence": "medium"
}
```

### kb_explain Response

```json
{
  "summary": "app-payments: Payment processing service. 8 inbound, 5 outbound.",
  "service": "app-payments",
  "description": "Handles payment processing...",
  "connections": {
    "inbound": [{ "service": "app-checkout", "mechanism": "grpc", "confidence": "high" }],
    "outbound": [{ "service": "app-notifications", "mechanism": "kafka", "topic": "payment.completed" }]
  },
  "entities": { "modules": 45, "schemas": 12, "events_produced": 3, "events_consumed": 2 },
  "top_modules": ["Payments.Payment", "Payments.ProcessPayment"],
  "hints": ["Run kb_impact app-payments to see blast radius"]
}
```

---

## MVP Recommendation

Prioritize:
1. **Graph module** -- shared BFS infrastructure, edge loading, adjacency list builder
2. **kb_impact** -- highest value ("what breaks?"), validates graph module
3. **kb_trace** -- reuses graph module, adds path reconstruction
4. **kb_explain** -- independent of graph module, pure SQL aggregation

Defer to post-v3.0:
- Multiple path discovery (top N paths) in kb_trace
- `--detail` flag for rich path data in kb_impact
- outputSchema in MCP tool registration (SDK 1.27.1 doesn't require it)

---

## Sources

- Codebase: `src/search/dependencies.ts`, `src/db/migrations.ts`, `src/mcp/tools/deps.ts`, `src/mcp/format.ts`
- Approved design: `docs/plans/2026-03-09-graph-intelligence-design.md`
- Local benchmarks: SQL vs JS BFS performance (this research cycle)
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
