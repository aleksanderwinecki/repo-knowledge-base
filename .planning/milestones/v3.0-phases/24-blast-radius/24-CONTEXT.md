# Phase 24: Blast Radius - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

MCP tool `kb_impact` and CLI command `kb impact` for downstream impact analysis. Given a service name, returns a depth-grouped list of affected services with mechanism labels, confidence, and a blast radius score. Covers IMPACT-01 through IMPACT-07.

</domain>

<decisions>
## Implementation Decisions

### Traversal direction
- Add `bfsUpstream` to `graph.ts` — symmetric with existing `bfsDownstream`, traverses reverse adjacency
- Impact = "who depends on me" = follow reverse edges
- Mechanism filtering happens during BFS (skip non-matching edges), not post-filter — "what breaks if my gRPC endpoints change" is a different question than total blast radius
- `bfsUpstream` returns enriched nodes with edge metadata (mechanism + confidence per edge that reached them)
- Report ALL edges to an affected service (e.g., "app-payments depends via gRPC AND event"), not just first discovered

### Severity classification
- Depth-based tiers: depth 1 = direct, depth 2 = indirect, depth 3+ = transitive
- Single "Transitive (depth 3+)" bucket — no per-depth sub-groups beyond 2
- Services grouped under tier headers in output, not per-service tier field
- Default depth cap: 3, max allowed: 10 (matches kb_deps max)

### Blast radius score
- Formula: weighted sum = direct×3 + indirect×2 + transitive×1
- Score does NOT incorporate confidence levels — keep it simple, confidence shown per-service for agents to interpret
- Stats block includes mechanism breakdown (e.g., "grpc: 12, event: 8, kafka: 3")
- NO qualitative risk labels (low/medium/high) — tool provides data, agent interprets risk

### Compact formatting
- Per-service info in compact mode: name + mechanisms list (e.g., `"app-payments": ["grpc", "event"]`)
- Confidence dropped in compact mode — it's in the stats
- CLI output is full verbose — no 4KB cap, humans/scripts can pipe to grep/jq
- Only MCP responses respect the 4KB compact format

### Claude's Discretion
- Truncation strategy when MCP response exceeds 4KB (recommended: keep direct+indirect full, truncate transitive first with "...and N more")
- Whether to include a human-readable summary line (recommended: yes, as `summary` field)
- Exact structure of the enriched BfsNode type returned by bfsUpstream
- Whether bfsUpstream accepts mechanism filter param or impact module wraps/filters
- Test fixtures and edge case coverage

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `graph.ts`: `buildGraph()`, `bfsDownstream()`, `shortestPath()` — bfsUpstream follows same pattern
- `edge-utils.ts`: `extractConfidence`, `formatMechanism`, `VALID_MECHANISMS`, `MECHANISM_FILTER_MAP` — all needed for impact
- `types.ts`: `GraphEdge`, `ServiceGraph`, `BfsNode`, `GraphHop` — extend with impact-specific types
- `wrapToolHandler` HOF in MCP: wraps tool with error handling
- `withAutoSync`: handles stale repo sync + re-query pattern
- `formatResponse`: existing 4KB capping utility — may need impact-specific compact formatter

### Established Patterns
- MCP tools: `registerXTool(server, db)` + zod schema + `wrapToolHandler` + `withAutoSync`
- CLI commands: `@commander-js/extra-typings` with option flags
- All search functions take `db: Database.Database` as first param
- Graph module uses synchronous `better-sqlite3` `.all()` for bulk SQL, then pure JS traversal
- Graph builds fresh per query (~9ms) — no caching

### Integration Points
- New: `src/search/impact.ts` — impact analysis logic, calls bfsUpstream + formats results
- New: `src/mcp/tools/impact.ts` — MCP tool registration
- New: `src/cli/commands/impact.ts` — CLI command
- Modified: `src/search/graph.ts` — add bfsUpstream function
- Modified: `src/search/types.ts` — add ImpactResult, ImpactNode types
- Modified: `src/search/index.ts` — export new functions/types
- Modified: `src/mcp/tools/index.ts` — register impact tool
- Modified: `src/cli/index.ts` — register impact command

</code_context>

<specifics>
## Specific Ideas

- Tool provides data, agent interprets risk — no qualitative labels baked in
- "What breaks if my gRPC endpoints change" (filtered) is a fundamentally different question than "total blast radius" (unfiltered) — mechanism filter during BFS ensures correct answers for both

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 24-blast-radius*
*Context gathered: 2026-03-09*
