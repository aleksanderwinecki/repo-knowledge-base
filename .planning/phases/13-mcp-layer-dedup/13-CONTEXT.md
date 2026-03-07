# Phase 13: MCP Layer Dedup - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract shared error handling, auto-sync, response formatting, and DB path resolution patterns across 8 MCP tool implementations into reusable helpers. Unify learned_fact FTS indexing through db/fts.ts. No new features — pure deduplication of existing MCP layer code.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

User delegated all implementation decisions to Claude. The following areas have been analyzed with recommended approaches:

**Error handler HOF (MCP-01):**
- Extract `wrapToolHandler` higher-order function that wraps tool callbacks with try/catch
- All 8 tools currently duplicate identical error handling: `try { ... } catch (error) { const message = error instanceof Error ? error.message : String(error); return { content: [{ type: 'text', text: \`Error ...: \${message}\` }], isError: true }; }`
- HOF eliminates ~48 lines of duplicated boilerplate (6 lines x 8 tools)
- Individual tools should contain only their business logic

**Auto-sync helper (MCP-02):**
- Extract `withAutoSync` helper used by the 3 tools that need it (search, entity, deps)
- Pattern: run query → extract repo names from results → checkAndSyncRepos → re-run query if synced
- Helper should accept a query function and a repo-name extractor, return fresh results
- Eliminates ~36 lines of duplicated sync-then-retry logic across 3 tools

**Response format consistency (MCP-03):**
- Current state: search/entity/deps use `formatResponse()` → `McpResponse` shape; learn/forget/status/cleanup manually build `{ summary, data }`; list-types uses raw `JSON.stringify`
- Unify so all tools return consistent `McpResponse`-shaped JSON (summary, data, total, truncated)
- Write tools (learn, forget) and status tools should use `formatResponse()` or a compatible wrapper
- list-types should wrap its output in the standard shape
- Phase 11 contract tests will catch any response shape regressions

**DB path resolution (MCP-04):**
- Currently `server.ts:main()` has: `process.env.KB_DB_PATH ?? path.join(os.homedir(), '.kb', 'knowledge.db')`
- CLI entry likely has the same pattern
- Extract to shared utility (e.g., `resolveDbPath()`) called by both MCP server and CLI

**EntityType + FTS unification (MCP-05):**
- `knowledge/store.ts:learnFact()` writes directly to `knowledge_fts` bypassing `db/fts.ts indexEntity()` — the comment explains: "EntityType doesn't include 'learned_fact'"
- Add `'learned_fact'` to the EntityType union
- Update `indexEntity()` in `db/fts.ts` to handle learned_fact
- Change `store.ts` to call `indexEntity()` instead of raw FTS INSERT
- Same for `forgetFact()` → should use `removeEntity()` from `db/fts.ts` instead of raw FTS DELETE

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/mcp/format.ts`: `formatResponse()` already handles 4KB size enforcement with recursive halving — 3 tools use it, 5 don't
- `src/mcp/sync.ts`: `checkAndSyncRepos()` is already extracted — but the call-site pattern (query → extract repos → sync → re-query) is duplicated in 3 tools
- `src/db/fts.ts`: `indexEntity()` and `removeEntity()` handle FTS operations — store.ts bypasses these
- `src/db/tokenizer.ts`: `tokenizeForFts()` used by both store.ts (directly) and fts.ts (via indexEntity)
- `src/mcp/server.ts`: `createServer()` factory wires all 8 tools — registration pattern stays the same

### Established Patterns
- Each tool is a separate file with `register*Tool(server, db)` function — this pattern stays
- `formatResponse()` takes items array + summary function, returns size-constrained JSON string
- Phase 11 contract tests verify input schemas + output shapes for all 8 tools
- Phase 11 golden tests + CLI snapshots catch search quality and output regressions

### Integration Points
- 8 tool files in `src/mcp/tools/` — all get error handling wrapper
- 3 tool files (search, entity, deps) — also get auto-sync helper
- `src/knowledge/store.ts` — learnFact/forgetFact FTS calls route through db/fts.ts
- `src/knowledge/types.ts` — EntityType union gets 'learned_fact' member
- `src/mcp/server.ts` + CLI entry — share DB path resolution utility

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User delegated all decisions to Claude's judgment, consistent with phases 11 and 12 in this milestone.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 13-mcp-layer-dedup*
*Context gathered: 2026-03-07*
