# Phase 5: MCP Server - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning
**Source:** PRD Express Path (user description)

<domain>
## Phase Boundary

This phase adds a standalone MCP (Model Context Protocol) server that exposes the existing knowledge base as tools Claude Code can call mid-conversation. The server wraps the existing search, entity, deps, and knowledge APIs — no new data layer work. It also adds automatic index freshness checks and data hygiene (pruning deleted repos, stale facts).

The user will run the first `kb index` manually. After that, the MCP server keeps things fresh on its own.

</domain>

<decisions>
## Implementation Decisions

### MCP Server Framework
- Use the official `@modelcontextprotocol/sdk` package (TypeScript)
- Server communicates over stdio (standard for Claude Code MCP servers)
- Single entry point: `src/mcp/server.ts` → compiled to `dist/mcp/server.js`

### Tools Exposed
- `kb_search` — full-text search (wraps searchText)
- `kb_entity` — structured entity lookup (wraps findEntity)
- `kb_deps` — dependency graph query (wraps queryDependencies)
- `kb_learn` — teach a fact (wraps learnFact)
- `kb_forget` — remove a fact (wraps forgetFact)
- `kb_status` — database stats and index freshness

### Response Sizing
- All MCP responses must be under 4KB
- Truncate/summarize long result sets with a count + top N pattern
- Responses are JSON with a human-readable `summary` field

### Auto-Sync (MCP-03)
- On each query, check if any repos have new commits since last index (compare HEAD vs stored SHA)
- Re-index stale repos transparently before returning results
- Keep it lightweight: only check repos in the query's result set, not all 300+ repos on every call
- Full re-index available via `kb_status` tool which reports staleness

### Data Hygiene (MCP-04)
- On server startup or periodic trigger: detect repos that no longer exist on disk and remove their entries
- Provide a `kb_cleanup` tool that prunes deleted repos and optionally reviews learned facts
- Do NOT auto-delete learned facts — only flag them for review

### Installation (MCP-05)
- Add `bin.kb-mcp` entry to package.json pointing to compiled MCP server
- User adds one line to Claude Code MCP config: `"kb": { "command": "kb-mcp" }`
- No env vars required (uses default ~/.kb/knowledge.db)

### Claude's Discretion
- Error handling strategy for MCP tool failures
- Exact truncation thresholds for response sizing
- Whether to batch stale repo re-indexing or do it one at a time
- Internal caching strategy (if any)

</decisions>

<specifics>
## Specific Ideas

- User explicitly said "I can do the first scan manually myself" — so initial `kb index` is out of scope for MCP server
- "Keep it in sync" — auto-sync on query, not background polling
- "Clean wrong info over time" — detect deleted repos, flag stale facts
- Existing CLI and all search/knowledge modules are already built and tested (197 tests)
- The public API in `src/index.ts` already exports everything the MCP server needs

</specifics>

<deferred>
## Deferred Ideas

- Background file watcher for real-time re-indexing
- MCP resources (exposing knowledge as browsable resources, not just tools)
- Semantic search / embeddings (already deferred to v2)
- Auto-learning from Claude's conversations

</deferred>

---

*Phase: 05-mcp-server*
*Context gathered: 2026-03-06 via PRD Express Path*
