# Phase 25: Flow Tracing - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

MCP tool `kb_trace` and CLI command `kb trace` for shortest-path queries between two services. Given two service names, returns the shortest path with per-hop mechanism labels and a human-readable arrow-chain summary. Covers TRACE-01 through TRACE-04 (with TRACE-04 simplified: confidence dropped).

</domain>

<decisions>
## Implementation Decisions

### Path summary format
- Arrow chain notation: `A -[grpc]-> B -[event: OrderCreated]-> C`
- `via` shown only for event/kafka hops (where it adds info: event name or topic). Omitted for grpc/http/gateway.
- Summary is just the arrow chain — no footer. hop_count is a separate top-level field.

### Response shape
- Single format for both MCP and CLI (no compact formatter needed — trace responses are inherently small, 2-5 hops)
- Top-level fields: `from`, `to`, `path_summary`, `hop_count`, `hops`
- Hop entries contain: `from`, `to`, `mechanism`, and optionally `via` (omitted when null)
- No confidence fields anywhere — mechanism already implies reliability
- No repo IDs in response — names only (IDs are internal graph detail)
- Same-service query (from === to): return zero-hop success with `path_summary: "app-payments (same service)"`, empty hops array

### Error handling
- Thrown errors (consistent with Phase 24 pattern), caught by wrapToolHandler for MCP
- Validate both `from` and `to` upfront — if both missing, report both in one error: `"Services not found: app-foo, app-bar"`
- Single missing: `"Service not found: app-foo"`
- No path: `"No path between app-api and app-foo"` (plain message, no hints)
- Exact name matching only — no fuzzy/substring matching

### Confidence
- Dropped entirely from trace (simplification of TRACE-04)
- Mechanism tells the story: grpc = exact proto match, http = regex guess, event/kafka = indirect
- No per-hop confidence, no min_confidence rollup

### Claude's Discretion
- TraceResult type structure (interface design)
- Whether to create a trace.ts module or inline in the tool (recommended: separate module like impact.ts)
- Test fixture design and edge case coverage
- CLI output formatting (JSON vs table)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `graph.ts`: `buildGraph()` and `shortestPath()` — the core primitive already exists, returns `GraphHop[]` with all needed data
- `GraphHop` type: has fromRepoId, fromRepoName, toRepoId, toRepoName, mechanism, confidence, via
- `impact.ts`: exact pattern to follow for module structure (analyzeImpact → analyzeTrace)
- `wrapToolHandler` HOF: error handling for MCP tools
- `withAutoSync`: stale repo sync pattern (if needed)
- `edge-utils.ts`: `extractConfidence`, `formatMechanism`, `VALID_MECHANISMS`

### Established Patterns
- MCP tools: `registerXTool(server, db)` + zod schema + `wrapToolHandler`
- CLI commands: `@commander-js/extra-typings` with option flags
- All search functions take `db: Database.Database` as first param
- Graph builds fresh per query (~9ms) — no caching
- Synchronous better-sqlite3 `.all()` for SQL, pure JS traversal

### Integration Points
- New: `src/search/trace.ts` — trace analysis logic, calls shortestPath + formats results
- New: `src/mcp/tools/trace.ts` — MCP tool registration
- New: `src/cli/commands/trace.ts` — CLI command
- Modified: `src/search/index.ts` — export new functions/types
- Modified: `src/mcp/tools/index.ts` — register trace tool (pattern: add to tool registration array)
- Modified: `src/cli/index.ts` — register trace command

</code_context>

<specifics>
## Specific Ideas

- This is the simplest of the three v3.0 tools — `shortestPath()` already does the heavy lifting. The phase is mostly formatting + wiring.
- TRACE-04 simplified: original requirement included per-hop confidence and min-path confidence. Dropped because mechanism already implies confidence level, and the field would mostly be noise.

</specifics>

<deferred>
## Deferred Ideas

- Multiple path discovery (top N paths) — deferred to AGRAPH-01
- Fuzzy service name matching — could be a cross-cutting feature for all graph tools

</deferred>

---

*Phase: 25-flow-tracing*
*Context gathered: 2026-03-09*
