# Project Research Summary

**Project:** repo-knowledge-base v3.0 — Graph Intelligence
**Domain:** Code intelligence graph traversal for AI agent consumption (MCP)
**Researched:** 2026-03-09
**Confidence:** HIGH

## Executive Summary

JS BFS is 200-1000x faster than SQLite recursive CTEs for graph traversal on this topology (400 repos, ~12K edges). This single finding reshapes the entire implementation: SQL loads edges in a bulk query (~6ms), JavaScript builds an in-memory adjacency list (~3ms build), and BFS traverses in 0.2-0.6ms. Total query time under 10ms vs 150-2700ms for pure CTEs. The design doc's original "recursive CTEs replace BFS loops" direction is wrong -- benchmarks proved it conclusively. The correct architecture is the inverse: BFS stays, per-hop SQL queries get replaced by a single bulk load.

The v3.0 milestone adds three tools (kb_impact, kb_trace, kb_explain) with zero new dependencies. The existing stack (better-sqlite3 ^12.0.0, TypeScript ^5.7.0, vitest ^3.0.0) handles everything. The only new architectural component is a graph module (`src/search/graph.ts`) that builds forward and reverse adjacency lists from one SQL query. kb_impact and kb_trace share this module; kb_explain is independent (pure SQL aggregation, no graph traversal).

The top risks are: (1) missing event/Kafka intermediate nodes in the adjacency list, which silently produces incomplete blast radii; (2) hub node responses exceeding the 4KB MCP cap, where the existing halving strategy would be actively misleading for impact analysis; and (3) direction confusion between "downstream" (what depends on me) vs "upstream" (what I depend on), which produces wrong results silently. All three have concrete mitigations from existing codebase patterns.

## Key Findings

### Recommended Stack

No new dependencies. This is a pure application-logic milestone.

- **better-sqlite3 ^12.0.0** (existing): Bulk edge loading via synchronous `.all()`, single V8/native boundary crossing for 12K rows
- **TypeScript ^5.7.0** (existing): Graph module, BFS implementations, type-safe results
- **vitest ^3.0.0** (existing): Graph algorithm tests, cycle detection, path reconstruction

SQLite's role changes from "traversal engine" to "storage + filtering." Recursive CTEs are still useful in kb_explain for non-recursive multi-table aggregation, but never for graph traversal. No graph library needed -- BFS on 400 nodes is ~20 lines of code, and every candidate library (graphlib, ngraph, cytoscape, graphology) brings more weight than value at this scale.

### Expected Features

**Must have (table stakes):**
- kb_impact: Downstream BFS with depth-grouped results, mechanism labels, confidence per edge, mechanism filter (`--mechanism grpc`), depth limit (default 3)
- kb_trace: Shortest path (BFS on unweighted graph), ordered hop list with mechanism per hop, path_summary string, distinct "not found" vs "no path" errors
- kb_explain: Service identity + description, inbound/outbound connections grouped by mechanism, events produced/consumed, entity counts, repo metadata
- All tools: Event/Kafka intermediate node transparency (two-hop repo->event->repo collapsed to single logical edge)
- All tools: 4KB-compliant response formatting

**Should have (differentiators):**
- kb_impact: Severity tiers (direct/indirect/transitive), aggregated mechanism summary in stats block, blast radius score
- kb_trace: Annotated hops with confidence, min-path confidence (weakest link)
- kb_explain: "Talks to" / "called by" summaries, top modules by type, next-step hints (`"Run kb_impact app-payments to see blast radius"`)

**Defer (post-v3.0):**
- Multiple path discovery (top N paths) in kb_trace
- `--detail` flag for rich path data in kb_impact
- Architecture rules engine ("X should not call Y")
- Historical graph comparison / snapshots
- Code-level (function granularity) impact analysis
- Graph caching layer (9ms load, 2-second budget = 200x headroom)
- outputSchema in MCP tool registration (SDK 1.27.1 doesn't require it)

### Architecture Approach

Three layers: CLI commands and MCP tools (presentation) call query functions in `src/search/` (logic), which use `src/db/` (storage). The graph module sits in the search layer, loaded by impact.ts and trace.ts. kb_explain bypasses the graph module entirely. Before building anything new, extract shared utilities (`extractConfidence`, `extractMetadataField`, `formatMechanism`) from the private scope of `dependencies.ts` into a shared `src/search/edge-utils.ts`.

**New files:**
1. **`src/search/graph.ts`** — In-memory adjacency list builder + BFS primitives (downstream, shortest path). The only genuinely new architectural component.
2. **`src/search/impact.ts`** — Downstream blast radius aggregation using graph.bfsDownstream, with compact response formatting
3. **`src/search/trace.ts`** — Shortest path with parent-pointer reconstruction using graph.shortestPath
4. **`src/search/explain.ts`** — Multi-table SQL aggregation (no graph dependency), counts + top-N pattern
5. **`src/search/edge-utils.ts`** — Shared utilities extracted from dependencies.ts (mechanism maps, confidence extraction, metadata parsing)
6. **MCP tools** (`src/mcp/tools/impact.ts`, `trace.ts`, `explain.ts`) — Following existing registration pattern from deps.ts
7. **CLI commands** (`src/cli/commands/impact.ts`, `trace.ts`, `explain.ts`) — Following existing CLI patterns

**Modified files (additive only):** `src/search/index.ts`, `src/mcp/server.ts`, `src/cli/index.ts`, `src/index.ts` -- all re-exports and registrations.

**Untouched:** `dependencies.ts` stays as-is. Existing 503 tests unaffected.

### Critical Pitfalls

1. **Recursive CTEs for traversal (Critical)** — 200-1000x slower than JS BFS. No progress handler available (OMIT_PROGRESS_CALLBACK compiled into bundled SQLite) so a runaway CTE blocks the Node.js thread with no escape. Use SQL for loading only.
2. **Missing event/Kafka edges (Critical)** — Naive `WHERE target_type='repo'` misses two-hop event-mediated paths. Port `findKafkaTopicEdges()` and `findEventMediatedEdges()` from dependencies.ts into graph builder as upfront resolution step. Test by comparing kb_impact results against `kb deps --mechanism kafka`.
3. **Hub node 4KB explosion (Critical)** — Gateway impacts 300+ services. Existing `formatResponse()` halving would show 3 of 300 services -- actively misleading. Use dedicated compact format: flat service name list + stats envelope (~20 chars per service = ~150 services in 4KB). Do NOT reuse the generic halving strategy.
4. **Direction confusion (Moderate)** — Impact = "what depends on me" = reverse adjacency (follow edges pointing TO me). Trace = any path = both directions. Wrong direction produces silently wrong results. Build both forward and reverse adjacency lists; document semantics explicitly in code.
5. **Logic duplication (Moderate)** — Graph module must not reimplement mechanism labels, confidence extraction, metadata parsing. Extract shared utils into edge-utils.ts first, update dependencies.ts to import from there, verify existing tests pass.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Shared Infrastructure & Graph Module
**Rationale:** Everything else depends on this. The graph module is the shared foundation for kb_impact and kb_trace. Extracting shared utils prevents duplication from day one.
**Delivers:** `edge-utils.ts` (extracted shared code), `graph.ts` (adjacency list builder + BFS primitives with `ServiceGraph`, `buildGraph()`, `bfsDownstream()`, `shortestPath()`), comprehensive test suite for graph algorithms including cycles, disconnected nodes, event/Kafka resolution
**Addresses:** Table stakes infrastructure, event/Kafka transparency
**Avoids:** Pitfalls #2 (missing event edges), #4 (direction confusion), #5 (logic duplication)

### Phase 2: kb_impact (Blast Radius)
**Rationale:** Highest-value tool. Validates the graph module against real data. "What breaks if I change X?" is the primary use case driving v3.0.
**Delivers:** `impact.ts` query function, MCP tool registration, CLI command, compact response formatter that fits 300+ services in 4KB
**Addresses:** All kb_impact table stakes + differentiators (severity tiers, mechanism summary, blast radius score)
**Avoids:** Pitfalls #1 (CTE traversal), #3 (4KB explosion)

### Phase 3: kb_trace (Flow Tracing)
**Rationale:** Reuses graph module from Phase 1. Adds parent-pointer path reconstruction on top of existing BFS. Lower implementation risk than impact.
**Delivers:** `trace.ts` query function, MCP tool registration, CLI command, path_summary string generation, min-confidence tracking
**Addresses:** All kb_trace table stakes + differentiators (annotated hops, min-confidence)
**Avoids:** Pitfall #5 (path memory -- use parent pointers, not path copying), #7 (direction -- trace uses undirected graph)

### Phase 4: kb_explain (Service Summary)
**Rationale:** Fully independent of graph module -- can technically be built in parallel with Phase 2/3, but sequencing it last reduces WIP. Pure SQL aggregation, lowest risk.
**Delivers:** `explain.ts` query function, MCP tool registration, CLI command, counts + top-N response format
**Addresses:** All kb_explain table stakes + differentiators (talks-to/called-by summaries, top modules, hints)
**Avoids:** Pitfall #12 (4KB overflow on content-heavy services -- cap lists during query, before formatting)

### Phase Ordering Rationale

- **Graph module first** because kb_impact and kb_trace both depend on it. Building tools before their shared infrastructure leads to either duplication or rework.
- **kb_impact before kb_trace** because impact is the higher-value tool and exercises more of the graph module (full downstream traversal vs single shortest path). Issues caught here save time on trace.
- **kb_explain last** because it has zero dependency on the graph module and is pure SQL. It's the lowest-risk phase and benefits from all patterns established in prior phases.
- **Shared utils extracted in Phase 1** to prevent the moderate pitfall of logic duplication between dependencies.ts and the new graph module.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 1 (Graph Module):** Event/Kafka resolution logic is the trickiest part. The existing code in `dependencies.ts` (`findKafkaTopicEdges()` for Kafka, `findEventMediatedEdges()` for events) must be studied carefully and ported correctly. Direction semantics (forward vs reverse) need explicit documentation in code.

Phases with standard patterns (skip research-phase):
- **Phase 2 (kb_impact):** BFS downstream is straightforward once graph module exists. Response formatting is the main design decision (compact format already specified in FEATURES.md).
- **Phase 3 (kb_trace):** Parent-pointer BFS for shortest path is textbook. Path reconstruction is O(path_length).
- **Phase 4 (kb_explain):** Standard SQL aggregation following existing entity.ts patterns. No novel decisions.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Benchmarked locally on production-scale data. Zero new dependencies. SQLite 3.51.2 compile options verified. |
| Features | HIGH | Derived from existing codebase capabilities and approved design doc. Response formats specified with JSON examples. |
| Architecture | HIGH | All patterns derived from direct codebase inspection. File locations, module boundaries, and shared utils mapped to specific source lines. |
| Pitfalls | HIGH | Performance pitfall quantified via benchmarks. Event/Kafka resolution pattern understood from existing code. Response size constraints from existing 4KB MCP limit with concrete math. |

**Overall confidence:** HIGH

### Gaps to Address

- **Event/Kafka edge resolution correctness:** The logic exists in dependencies.ts but hasn't been tested in isolation as a bulk upfront operation. Phase 1 tests should include known event-mediated paths from the real database to validate the port. May need topic name dedup if multiple repos produce the same topic.
- **4KB budget for real hub nodes:** The compact format math (~150 services in 4KB) is estimated from ~20 chars per service name. Validate with actual gateway blast radius during Phase 2 implementation.
- **Bidirectional trace semantics:** Should kb_trace follow directed edges only (source->target) or treat the graph as undirected? Architecture research says undirected; validate this matches user expectations during Phase 3. An agent asking "how does A connect to B" probably wants any path regardless of call direction.
- **Multiple mechanisms between same pair:** BFS visits a node once (first mechanism discovered). If A->B has both gRPC and Kafka edges, only one mechanism is recorded. Phase 2 should decide whether to aggregate all mechanisms per affected service during adjacency list iteration.

## Sources

### Primary (HIGH confidence)
- Local benchmarks: 400 repos, 9K-12K edges, better-sqlite3 ^12.0.0, SQLite 3.51.2 on darwin arm64
- Codebase inspection: `src/search/dependencies.ts`, `src/db/migrations.ts`, `src/mcp/tools/deps.ts`, `src/mcp/format.ts`, `src/mcp/handler.ts`, `src/mcp/sync.ts`, `src/db/database.ts`
- [SQLite WITH clause](https://sqlite.org/lang_with.html) — recursive CTE limitations, UNION vs UNION ALL
- [SQLite implementation limits](https://sqlite.org/limits.html) — MAX_COMPOUND_SELECT=500
- [SQLite Forum: BFS traversal](https://sqlite.org/forum/info/3b309a9765636b79) — cycle detection, performance

### Secondary (MEDIUM confidence)
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — synchronous API, prepared statements
- [better-sqlite3 interrupt issue #568](https://github.com/JoshuaWise/better-sqlite3/issues/568) — no sqlite3_interrupt() exposed
- [MCP Specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- Approved design doc: `docs/plans/2026-03-09-graph-intelligence-design.md`

---
*Research completed: 2026-03-09*
*Ready for roadmap: yes*
