# Phase 23: Graph Infrastructure - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Shared graph module with in-memory adjacency lists and BFS traversal primitives. This phase builds the foundation that kb_impact (Phase 24), kb_trace (Phase 25), and kb_explain (Phase 26) depend on. No CLI or MCP tools in this phase — just the core graph module and extracted shared utilities.

</domain>

<decisions>
## Implementation Decisions

### Edge Resolution Strategy
- Resolve all event/Kafka two-hop edges upfront during graph build (not lazily during traversal)
- BFS algorithms only see repo->repo edges — intermediary nodes are transparent
- Collapsed edges preserve the intermediary name in metadata (e.g., `via: OrderCreated`, `via: payment.completed`)
- Multiple edges between the same pair of repos are kept separately (one per mechanism) — preserves per-mechanism confidence
- Unresolved edges (target_type='service_name') are included as leaf nodes in the graph

### Direction Semantics
- Impact (kb_impact): "what depends on me" = follow reverse edges (services that call/consume from X)
- Trace (kb_trace): treat graph as undirected — any edge traversable in both directions
- When reporting trace hops, show actual edge direction (who calls whom), not traversal direction
- Graph module builds both forward and reverse adjacency lists

### Graph API Surface
- Fresh graph build per query (no caching) — 9ms build time, 2-second budget = 200x headroom
- Caching deferred to AGRAPH-06

### Refactor Scope
- dependencies.ts: extract shared utilities only, leave its BFS untouched
- New graph module is additive — existing kb_deps unaffected

### Testing
- Graph module gets its own comprehensive test suite (not just E2E via downstream tools)
- Tests use real in-memory SQLite with fixtures (consistent with existing vitest + better-sqlite3 patterns)

### Claude's Discretion
- Class vs standalone functions for graph module API
- Whether to filter mechanism during graph build vs during traversal
- Whether to update dependency test imports to edge-utils.ts or rely on re-exports
- Two separate adjacency maps vs single map with direction metadata
- Data structure details for adjacency list entries

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `dependencies.ts`: Contains all shared utilities to extract — `MECHANISM_LABELS`, `MECHANISM_FILTER_MAP`, `VALID_MECHANISMS`, `extractConfidence`, `extractMetadataField`, `formatMechanism`, `buildInClause`, `getAllowedTypes`
- `dependencies.ts` BFS pattern: Queue-based `[repoId, depth, path[]]` with `visited: Set<string>` using `repo:${id}` keys — proven pattern to reuse
- `findEventMediatedEdges()`: Event resolution via events table JOIN — port to bulk upfront resolution
- `findKafkaTopicEdges()`: Kafka topic matching via metadata JSON extraction — port to bulk upfront resolution
- `LinkedRepo` interface: Captures edge metadata structure — adapt for graph module

### Established Patterns
- All search modules live in `src/search/` with types in `src/search/types.ts`
- Exports aggregated through `src/search/index.ts`
- MCP tools in `src/mcp/tools/` follow `register*Tool(server, db)` pattern
- `wrapToolHandler` HOF for error handling, `withAutoSync` for stale repo sync, `formatResponse` for 4KB cap
- Synchronous better-sqlite3 `.all()` and `.get()` — no async in DB layer

### Integration Points
- New graph module: `src/search/graph.ts` — imported by future impact.ts, trace.ts
- New edge utils: `src/search/edge-utils.ts` — imported by graph.ts and dependencies.ts
- Re-exports added to `src/search/index.ts`
- DB layer unchanged — graph module uses existing `edges` and `repos` tables via raw SQL

</code_context>

<specifics>
## Specific Ideas

- Agent-first design: graph responses optimized for MCP consumption, not human reading
- The existing `queryDependencies` does per-hop SQL queries (4 functions per node visited). The new graph module does a single bulk load then pure JS traversal — fundamentally different architecture despite similar BFS logic.
- Research benchmark: JS BFS on 12K-edge adjacency list = 0.2-0.6ms. SQLite recursive CTE on same graph = 150-2700ms. This is why the graph module exists.

</specifics>

<deferred>
## Deferred Ideas

- Graph caching layer (AGRAPH-06) — deferred, 9ms per build is fast enough
- Rewriting kb_deps to use graph module — evaluate after v3.0 ships
- Architecture rules engine — separate milestone

</deferred>

---

*Phase: 23-graph-infrastructure*
*Context gathered: 2026-03-09*
