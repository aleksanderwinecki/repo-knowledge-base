# Phase 17: Topology Query Layer - Context

**Gathered:** 2026-03-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Generalize `kb deps` CLI and `kb_deps` MCP tool to traverse ALL edge types (gRPC, HTTP, gateway, Kafka, events) with mechanism filtering and confidence display. Phase 16 stored the edges; this phase makes them queryable.

</domain>

<decisions>
## Implementation Decisions

### Default behavior
- `kb deps <repo>` with no flags returns ALL edge types (gRPC, HTTP, gateway, Kafka, events) — not just events
- This is a breaking change from event-only output, but it's the whole point of TOPO-05
- No opt-in flag needed — the old event-only behavior is simply subsumed

### Mechanism filter
- New `--mechanism <type>` flag on CLI, `mechanism` param on MCP tool
- User-facing values: `grpc`, `http`, `gateway`, `kafka`, `event`
- `event` covers both `produces_event` and `consumes_event` relationship types
- `kafka` covers both `produces_kafka` and `consumes_kafka` relationship types
- Multiple values NOT supported (keep it simple; run twice if needed)
- Invalid mechanism values produce a clear error listing valid options

### Output shape and confidence
- Add `confidence` field to `DependencyNode` type (string: 'high' | 'medium' | 'low' | null)
- Null confidence for legacy event edges (they predate the confidence system)
- CLI mechanism display: "gRPC [high]", "HTTP [low]", "Kafka consumer [high]", "event (OrderCreated)" — confidence in brackets after mechanism
- MCP response includes confidence as a structured field (not just in the display string)
- Unresolved targets ARE visible in output, marked with mechanism like "gRPC -> [unresolved: Rpc.Partners.V1.RPCService]"
- This lets users see gaps in the topology without hiding data

### Multi-hop traversal
- Depth > 1 mixes edge types freely: A calls_grpc B, B consumes_event C = valid 2-hop path
- The path array already stores intermediate names — extend to include mechanism at each hop
- Mechanism filter applies to ALL hops (if --mechanism grpc, only follow gRPC edges at every hop)

### Claude's Discretion
- Exact query implementation strategy (rewrite findLinkedRepos or build new traversal)
- How to handle the MECHANISM_LABELS map expansion
- Whether to refactor queryDependencies into a more generic graph traversal or keep the current BFS with added edge types
- Test strategy and edge case coverage

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `queryDependencies()` in `src/search/dependencies.ts`: BFS traversal with cycle detection — needs generalization from event-only to all edge types
- `DependencyNode`, `DependencyOptions` types in `src/search/types.ts`: need `confidence` field and `mechanism` filter option
- `MECHANISM_LABELS` map: currently incomplete (missing calls_http, routes_to, produces_kafka, consumes_kafka)
- `wrapToolHandler` HOF in MCP: wraps kb_deps cleanly, just need to add mechanism param
- `withAutoSync` in MCP: already handles deps re-query pattern

### Established Patterns
- CLI commands use `@commander-js/extra-typings` with option flags
- MCP tools use zod schema for params, `wrapToolHandler` for error handling
- `formatResponse` for MCP response sizing (< 4KB)
- All search functions take a `db: Database.Database` first param

### Integration Points
- `src/cli/commands/deps.ts`: Add `--mechanism` option to commander definition
- `src/mcp/tools/deps.ts`: Add `mechanism` to zod schema, pass through to queryDependencies
- `src/search/dependencies.ts`: Main rewrite — generalize findLinkedRepos to traverse all edge types
- `src/search/types.ts`: Extend DependencyNode with confidence, DependencyOptions with mechanism
- Edges table already has `metadata` JSON column with confidence — just need to read it during queries

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User deferred all decisions to Claude's discretion.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 17-topology-query-layer*
*Context gathered: 2026-03-08*
