# Domain Pitfalls: v3.0 Graph Intelligence

**Domain:** Graph traversal over microservice topology (~400 repos, ~12K edges)
**Researched:** 2026-03-09
**Supersedes:** Earlier pitfalls doc from same date (assumed CTE-only approach)
**Key update:** Benchmarks prove JS BFS is 200-1000x faster than recursive CTEs. Pitfalls updated accordingly.

---

## Critical Pitfalls

### Pitfall 1: Using Recursive CTEs for Graph Traversal Instead of JS BFS

**What goes wrong:** Response times of 150-2700ms instead of 0.2-0.6ms. The Node.js thread blocks with no way to interrupt (OMIT_PROGRESS_CALLBACK compiled into better-sqlite3's bundled SQLite 3.51.2).

**Why it happens:** The design doc says "recursive CTEs replace BFS loops." Intuitive assumption, but benchmarked wrong by orders of magnitude. Three independent mechanisms conspire:
- UNION dedup is O(n^2) per CTE iteration (SQLite compares every new row against all existing rows)
- UNION ALL + instr() cycle detection grows path strings linearly per depth, checked on every row
- With ~30 edges per node average, the working set explodes exponentially at depth 3+

**Benchmark data (400 repos, ~12K edges, realistic sparse microservice topology):**

| Approach | Impact (hub) | Impact (leaf) | Shortest path |
|----------|-------------|---------------|---------------|
| UNION CTE | 287ms | 152ms | 414ms |
| UNION ALL + instr() | 2726ms | -- | 1456ms |
| SQL load + JS BFS | **0.6ms** | **0.4ms** | **0.2ms** |

**Consequences:** Every graph query exceeds the <50ms target by 3-50x. For hub nodes (gateway routing to 80+ services), impact analysis via CTE takes 287ms+ vs 0.6ms in JS. better-sqlite3's synchronous API means the event loop is fully blocked during this time.

**Prevention:** Use SQL for data loading only (single bulk query, ~6ms for 12K rows). Build adjacency lists in JS. Do all traversal with `Map<number, Edge[]>` + `Set<number>` visited. This is the existing pattern in `dependencies.ts` but optimized from per-hop SQL to single bulk load.

**Detection:** Any graph query taking >50ms is probably traversing in SQL. Profile with `performance.now()` around the query.

### Pitfall 2: Missing Event/Kafka Intermediate Nodes in Adjacency List

**What goes wrong:** Impact analysis shows services as disconnected when they're actually linked through Kafka topics or events. "Changing app-payments won't affect anything" when app-notifications consumes its payment events.

**Why it happens:** The edges table has two-hop paths for event-mediated connections:
- `repo A --produces_kafka--> topic X (target_type='service_name')`
- `repo B --consumes_kafka--> topic X (target_type='service_name')`

A naive graph builder that only loads `WHERE source_type='repo' AND target_type='repo'` misses these entirely.

**Consequences:** Incomplete blast radius. Agents make incorrect change impact assessments. The tool's core value proposition -- "what breaks?" -- gives wrong answers.

**Prevention:** During adjacency list construction, resolve intermediate nodes. Reference implementation already exists:
1. `findKafkaTopicEdges()` in dependencies.ts: matches producers to consumers by topic name from metadata JSON
2. `findEventMediatedEdges()`: follows repo->event->repo two-hop paths
3. Port this logic into the graph builder as a one-time upfront resolution step

**Detection:** Compare kb_impact results against `kb deps --mechanism kafka` for the same service. If kafka edges are missing from impact but present in deps, the builder is incomplete.

### Pitfall 3: Hub Node Response Explosion Past 4KB MCP Cap

**What goes wrong:** The gateway routes to 80+ services. Each connects to more. At depth 3, blast radius hits 300+ services. Each `ImpactNode` with path array is ~200 bytes JSON. At 50 nodes = 10KB, well over the 4KB cap.

The existing `formatResponse()` halving strategy kicks in: 50 -> 25 -> 12 -> 6 -> 3. The agent receives 3 of 50 affected services and concludes the blast radius is small. **This is actively misleading -- worse than returning nothing.**

**Why it happens:** The 4KB self-imposed limit (`MAX_RESPONSE_CHARS = 4000` in format.ts) was designed for search results where truncation is acceptable. For impact analysis, a truncated blast radius gives false safety.

**Prevention:**
1. **Compact response format:** Return service names as flat list + stats envelope instead of full `DependencyNode` objects with paths:
   ```json
   {
     "summary": "47 downstream services, max depth 4",
     "services": ["app-checkout", "app-notifications", ...],
     "byMechanism": {"grpc": 12, "kafka": 23, "http": 8},
     "byDepth": {"1": 8, "2": 15, "3": 18, "4": 6}
   }
   ```
   Service names alone (~20 chars each) fit ~150 services in 4KB.
2. **Omit path arrays from default response.** Include paths only when result set is small (<10 services).
3. **Dedicated `formatImpactResponse()`.** Do NOT reuse formatResponse's halving strategy for impact analysis.
4. **Default depth limit of 3** with explicit `--depth` override.

**Detection:** Test kb_impact with the most-connected service in the real database.

---

## Moderate Pitfalls

### Pitfall 4: Duplicating Logic Between dependencies.ts and Graph Module

**What goes wrong:** New graph module reimplements edge type constants, mechanism labeling, confidence extraction, and metadata parsing. Two implementations drift. Bug fixes apply to one but not the other.

**Prevention:** Extract shared primitives before building graph module:
- `MECHANISM_LABELS`, `MECHANISM_FILTER_MAP`, `VALID_MECHANISMS` -- already exported from dependencies.ts
- `extractConfidence()`, `extractMetadataField()`, `formatMechanism()` -- currently private, extract to shared file
- New `src/search/graph-utils.ts` or similar shared module

### Pitfall 5: BFS Path Reconstruction Memory Pattern

**What goes wrong:** For shortest path, naive BFS copies the full path array at every queued node. With 400 nodes and branching factor ~30, depth-3 queue holds ~27K entries, each with a path array.

**Prevention:** Use parent-pointer BFS:
```typescript
const parent = new Map<number, { from: number; rel: string }>();
// Reconstruct path only after target found (backtrack from target to source)
```
Memory: O(V) parent pointers instead of O(V * D) path arrays. At 400 nodes this isn't critical, but it's the right pattern.

### Pitfall 6: Unresolved Edges Treated as Traversable

**What goes wrong:** Edges with `target_type='service_name'` and `target_id=0` (unresolved gRPC/HTTP calls) get included as traversable nodes. The graph builder creates phantom connections.

**Prevention:** Filter during load: `WHERE e.target_type = 'repo'` for traversable edges. Include unresolved edges as leaf nodes in kb_explain output, but never traverse through them. The existing BFS already handles this correctly (lines 179-198 of dependencies.ts).

### Pitfall 7: Bidirectional Confusion in Impact vs Trace

**What goes wrong:** kb_impact traverses downstream ("what depends on me" / "what breaks if I change"). kb_trace needs to find any path between A and B, which may involve both directions. Using the wrong edge direction produces wrong results silently.

**Prevention:**
- Graph module builds BOTH forward and reverse adjacency lists from the same edge load
- Impact uses forward only (downstream = follow edges from source to target, meaning "who calls me")
- Trace uses undirected graph (follow edges in either direction)
- The existing `direction` parameter in `DependencyOptions` is the reference for the semantics

**Tricky part:** For impact analysis, "downstream" means "things that depend on me" which means following edges WHERE target_id = my_id (they point TO me). This is counterintuitive. The current code in dependencies.ts handles it correctly -- study it carefully before reimplementing.

### Pitfall 8: Stale Graph Cache Between Index Runs

**What goes wrong:** If a session-level graph cache is implemented (to avoid re-loading edges for sequential kb_impact, kb_trace, kb_explain calls), the cache becomes stale after `kb index --repo X`. The agent runs impact analysis on outdated topology.

**Prevention:** Don't cache at all initially. The 9ms load time is under the 2-second budget by 200x. If caching is added later, invalidate on any write to the edges table.

---

## Minor Pitfalls

### Pitfall 9: Not Handling Disconnected Graphs

**What goes wrong:** Some repos have no edges. kb_trace between a connected and disconnected node returns no path -- correct, but the error message should distinguish "no path exists" from "service not found."

**Prevention:** Check both services exist in repos table before running trace. Return distinct errors: "Service X not found" vs "No path between X and Y."

### Pitfall 10: Multiple Paths Between Same Service Pair

**What goes wrong:** Service A connects to B via gRPC AND Kafka. BFS visits B once (first mechanism found), skips subsequent connections. Impact shows only one mechanism.

**Prevention:**
- For kb_impact: one entry per affected service is correct, but include ALL mechanisms as an array
- For kb_trace: return shortest path; alternative paths at same depth are a post-v3.0 enhancement
- During adjacency list construction, don't dedup multi-mechanism edges -- let BFS handle node-level dedup

### Pitfall 11: Confidence Lost in Multi-Hop Results

**What goes wrong:** Path goes through `high -> low -> high` confidence edges. If only the last edge's confidence is reported, result shows "high" when the weakest link is "low."

**Prevention:** Track minimum confidence through BFS traversal. `null` (event edges) should not drag down confidence -- treat as "unassessed." Define ordering: `high > medium > low > null(unassessed)`.

### Pitfall 12: kb_explain 4KB Overflow on Content-Heavy Services

**What goes wrong:** A service with 200+ modules, 50 events, and 30 connections overflows the response cap.

**Prevention:** Return counts + top-N, not full lists. `"modules": {"count": 234, "top": ["PaymentContext", "PaymentWorker"]}`. Cap individual lists during query, before formatting.

---

## Phase-Specific Warnings

| Phase | Likely Pitfall | Mitigation |
|-------|---------------|------------|
| Graph infrastructure | Event/Kafka resolution (#2) | Port logic from dependencies.ts, test against known paths |
| Graph infrastructure | Direction confusion (#7) | Build both fwd/rev adjacency, document semantics |
| kb_impact | Hub explosion (#3) | Compact response format, default depth 3 |
| kb_impact | Performance (#1) | Use JS BFS, not recursive CTEs |
| kb_trace | Path memory (#5) | Parent-pointer BFS |
| kb_trace | Direction (#7) | Undirected graph for path finding |
| kb_explain | 4KB overflow (#12) | Counts + top-N, formatSingleResponse |
| All tools | Code duplication (#4) | Extract shared utils first |

## "Looks Done But Isn't" Checklist

- [ ] **Event/Kafka paths included:** Kafka consumers appear in impact results for producers
- [ ] **Direction correct:** `kb impact X` shows what breaks if X changes (dependents), not what X depends on
- [ ] **4KB fits:** Impact for most-connected service still returns ALL service names
- [ ] **Unresolved edges visible:** External API calls appear as leaf nodes in explain
- [ ] **Performance <50ms:** All graph queries including edge load complete under 50ms
- [ ] **Cycles handled:** A->B->C->A cycle in test fixture doesn't cause infinite BFS
- [ ] **No path handled:** Disconnected services return clear "no path" message
- [ ] **Existing tests pass:** `queryDependencies()` unchanged, 503 tests still pass

## Sources

- Local benchmarks (this research): 400 repos, 9K-12K edges, better-sqlite3 ^12.0.0, SQLite 3.51.2
- Codebase: `src/search/dependencies.ts` (existing BFS, edge resolution, direction semantics)
- Codebase: `src/mcp/format.ts` (4KB cap, halving strategy)
- Codebase: `src/db/database.ts` (pragmas)
- SQLite compile options: `OMIT_PROGRESS_CALLBACK` confirmed via `PRAGMA compile_options`
- [SQLite WITH clause](https://sqlite.org/lang_with.html): recursive CTE limitations
- [SQLite Forum: BFS traversal](https://sqlite.org/forum/info/3b309a9765636b79): performance on cyclic graphs
- [better-sqlite3 interrupt issue #568](https://github.com/JoshuaWise/better-sqlite3/issues/568): no sqlite3_interrupt() exposed

---
*Research completed: 2026-03-09*
