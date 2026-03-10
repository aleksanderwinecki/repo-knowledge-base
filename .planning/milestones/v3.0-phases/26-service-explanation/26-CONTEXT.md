# Phase 26: Service Explanation - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

MCP tool `kb_explain` and CLI command `kb explain` for structured service overview cards. Given a service name, returns identity, connections, events, modules, and agent next-step hints. Pure SQL aggregation — no graph module dependency. Covers EXPLAIN-01 through EXPLAIN-05.

</domain>

<decisions>
## Implementation Decisions

### Card sections & density
- **Identity section**: service name, description (from repos.description), repo path. No index metadata (last_indexed_commit, default_branch, timestamps).
- **Modules**: counts per module type + top 5 module names per type. Gives shape without overwhelming.
- **Events**: event names grouped by direction (produces/consumes). Names only, no schema_definition.
- **Extra counts**: include file count and gRPC service count for repo size/API surface context.

### Response sizing
- **Single format** for both MCP and CLI — no separate compact formatter.
- Caps control size: top 5 modules per type, ~20 connections per direction with "...and N more" truncation.
- If caps aren't enough for hub services, progressive truncation (Claude's discretion on strategy). Priority: identity > connections > events > modules.

### Connection presentation
- **Grouped by mechanism**: under talks_to/called_by, group connections by grpc, http, event, etc.
- **No confidence** — mechanism already implies reliability (consistent with Phase 25 decision).
- **Count-based summary line**: "Talks to 12 services (7 via gRPC, 3 via events, 2 via HTTP). Called by 5 services." Above detailed connections.
- Sort order within mechanism groups: Claude's discretion.

### Agent hints
- **Position**: bottom of card as "Next steps" footer.
- **Scope**: graph tools only — kb_impact, kb_trace, kb_deps.
- **Format**: generic tool names with `<this-service>` placeholder. No specific neighbor names.
- Static vs dynamic: Claude's discretion.

### Claude's Discretion
- Truncation/overflow strategy if card exceeds 4KB
- Sort order within mechanism groups (alphabetical recommended)
- Static vs dynamic hints (static recommended — simpler, predictable)
- ExplainResult type structure and interface design
- Test fixtures and edge case coverage
- CLI output formatting details

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `dependencies.ts`: `queryDependencies()` for connection data — already does direction-based edge traversal with mechanism labels
- `edge-utils.ts`: `VALID_MECHANISMS`, `formatMechanism`, `extractConfidence`, `buildInClause`, `getAllowedTypes`
- `entity.ts`: `findEntity()` — entity lookup by name with type filtering
- `wrapToolHandler` HOF in MCP: wraps tool with error handling
- `withAutoSync`: stale repo sync + re-query pattern
- DB schema: repos (name, path, description), modules (name, type, summary), events (name, schema_definition, source_file), services (name, description), edges (source/target with relationship_type)

### Established Patterns
- MCP tools: `registerXTool(server, db)` + zod schema + `wrapToolHandler` + `withAutoSync`
- CLI commands: `@commander-js/extra-typings` with option flags, try/catch + outputError
- All search functions take `db: Database.Database` as first param
- Thrown errors for "not found" caught by wrapToolHandler (Phase 24-25 pattern)
- Exact name matching only (Phase 25: no fuzzy/substring)
- Synchronous better-sqlite3 `.all()` for SQL queries

### Integration Points
- New: `src/search/explain.ts` — explain logic, pure SQL aggregation + formatting
- New: `src/mcp/tools/explain.ts` — MCP tool registration
- New: `src/cli/commands/explain.ts` — CLI command
- Modified: `src/search/index.ts` — export new functions/types
- Modified: `src/mcp/tools/index.ts` — register explain tool
- Modified: `src/cli/index.ts` — register explain command

</code_context>

<specifics>
## Specific Ideas

- This is the simplest of the three v3.0 tools — no graph traversal, just SQL aggregation across existing tables.
- Card is designed for agent onboarding: "I just got dropped into a codebase, what does app-payments do and who talks to it?"
- Connection grouping by mechanism lets agents quickly answer "what's the gRPC surface?" vs "what events does it consume?"

</specifics>

<deferred>
## Deferred Ideas

- Fuzzy service name matching — deferred as cross-cutting feature for all graph tools (noted in Phase 25)
- Rich module details (summaries, schema fields) — could be a drill-down tool later

</deferred>

---

*Phase: 26-service-explanation*
*Context gathered: 2026-03-09*
