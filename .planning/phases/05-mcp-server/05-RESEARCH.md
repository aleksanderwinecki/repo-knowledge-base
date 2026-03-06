# Phase 5: MCP Server - Research

**Researched:** 2026-03-06
**Domain:** Model Context Protocol (MCP) server over stdio, wrapping existing knowledge base APIs
**Confidence:** HIGH

## Summary

This phase wraps the existing knowledge base APIs (search, entity, deps, learn, forget, status) into an MCP server using `@modelcontextprotocol/sdk`. The codebase already exports every function the server needs from `src/index.ts` -- this is purely a wiring exercise with some auto-sync and data hygiene logic on top.

The MCP SDK v1.x (latest: 1.27.1) uses `McpServer` class with `registerTool()` for tool registration, `StdioServerTransport` for stdio communication, and Zod for input schema validation. The API is stable and well-documented. V2 is in pre-alpha (Q1 2026 target) with different import paths, but v1.x is the production recommendation and will receive fixes for 6+ months after v2 ships. We should use v1.x.

**Primary recommendation:** Use `@modelcontextprotocol/sdk@^1.27` with `zod@^3.25`, register 7 tools via `registerTool()`, expose as `bin.kb-mcp` entry in package.json, and configure via `claude mcp add` or `.mcp.json`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use the official `@modelcontextprotocol/sdk` package (TypeScript)
- Server communicates over stdio (standard for Claude Code MCP servers)
- Single entry point: `src/mcp/server.ts` -> compiled to `dist/mcp/server.js`
- Tools: `kb_search`, `kb_entity`, `kb_deps`, `kb_learn`, `kb_forget`, `kb_status`, `kb_cleanup`
- All MCP responses must be under 4KB
- Truncate/summarize long result sets with a count + top N pattern
- Responses are JSON with a human-readable `summary` field
- Auto-sync: on each query, check if repos have new commits since last index (compare HEAD vs stored SHA)
- Re-index stale repos transparently before returning results
- Only check repos in the query's result set, not all 300+ repos on every call
- On server startup or periodic trigger: detect repos that no longer exist on disk and remove their entries
- `kb_cleanup` tool prunes deleted repos and optionally reviews learned facts
- Do NOT auto-delete learned facts -- only flag them for review
- Add `bin.kb-mcp` entry to package.json pointing to compiled MCP server
- User adds one line to Claude Code MCP config: `"kb": { "command": "kb-mcp" }`

### Claude's Discretion
- Error handling strategy for MCP tool failures
- Exact truncation thresholds for response sizing
- Whether to batch stale repo re-indexing or do it one at a time
- Internal caching strategy (if any)

### Deferred Ideas (OUT OF SCOPE)
- Background file watcher for real-time re-indexing
- MCP resources (exposing knowledge as browsable resources, not just tools)
- Semantic search / embeddings (already deferred to v2)
- Auto-learning from Claude's conversations
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | MCP server exposing search, deps, entity lookup, and learn/forget as tools | `McpServer.registerTool()` with Zod schemas wrapping existing exported functions from `src/index.ts` |
| MCP-02 | MCP responses are concise (<4KB), well-structured summaries suitable for LLM consumption | Response sizing via truncation + count pattern; `content: [{ type: 'text', text: JSON.stringify(...) }]` format |
| MCP-03 | Auto-sync: server detects stale indexes and re-indexes repos with new commits when queried | Existing `getCurrentCommit()` from git.ts + `indexSingleRepo()` from pipeline.ts; check HEAD vs stored `last_indexed_commit` |
| MCP-04 | Data hygiene: server can identify and clean outdated/wrong facts | Query `repos` table, check `fs.existsSync(path)`, prune via existing `clearRepoEntities` + FTS cleanup; flag learned facts only |
| MCP-05 | Installable via claude_desktop_config.json or Claude Code MCP settings with zero manual config beyond initial setup | `bin.kb-mcp` in package.json + `claude mcp add --transport stdio kb -- kb-mcp` or `.mcp.json` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP server framework | Official SDK, only option for MCP protocol |
| `zod` | ^3.25 | Input schema validation | Required peer dependency of MCP SDK |

### Supporting (already in project)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `better-sqlite3` | ^12.0.0 | Database access | Already used; MCP server shares same DB |
| `typescript` | ^5.7.0 | Build | Already configured |
| `vitest` | ^3.0.0 | Testing | Already configured with 197 tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@modelcontextprotocol/sdk` v1.x | v2 pre-alpha | v2 not stable yet; import paths change; v1 is production-recommended |
| `zod@3` | `zod@4` | Zod 4 has known compatibility issues with MCP SDK v1.17+ (see pitfalls); stick with zod@3.25+ |

**Installation:**
```bash
npm install @modelcontextprotocol/sdk zod
```

Note: `zod` is a peer dependency -- it must be explicitly installed even though the SDK requires it.

## Architecture Patterns

### Recommended Project Structure
```
src/
  mcp/
    server.ts          # Entry point: McpServer setup + transport + startup
    tools/
      search.ts        # kb_search tool registration
      entity.ts        # kb_entity tool registration
      deps.ts          # kb_deps tool registration
      learn.ts         # kb_learn tool registration
      forget.ts        # kb_forget tool registration
      status.ts        # kb_status tool registration
      cleanup.ts       # kb_cleanup tool registration
    sync.ts            # Auto-sync logic (staleness check + re-index)
    hygiene.ts         # Data hygiene (deleted repo detection, stale fact flagging)
    format.ts          # Response formatting + truncation (<4KB enforcement)
```

### Pattern 1: McpServer with registerTool + StdioServerTransport
**What:** Create server, register tools with Zod input schemas, connect via stdio
**When to use:** Always -- this is the only pattern for MCP servers in Claude Code
**Example:**
```typescript
// Source: Official MCP TypeScript SDK docs
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'kb',
  version: '1.0.0',
});

server.registerTool(
  'kb_search',
  {
    description: 'Full-text search across all indexed repos, modules, events, and learned facts',
    inputSchema: {
      query: z.string().describe('Search query (supports FTS5 syntax: AND, OR, NOT, phrases)'),
      limit: z.number().optional().describe('Max results (default: 10)'),
      repo: z.string().optional().describe('Filter to specific repo name'),
    },
  },
  async ({ query, limit, repo }) => {
    // ... call searchText(db, query, { limit, repoFilter: repo })
    // ... format + truncate response
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('kb MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

### Pattern 2: Database Lifecycle in MCP Server
**What:** Open DB once on server start, keep open for server lifetime, close on shutdown
**When to use:** MCP servers are long-lived processes (unlike CLI which opens/closes per command)
**Example:**
```typescript
// Open once at startup -- NOT per-tool-call
import { openDatabase, closeDatabase, registerShutdownHandlers } from '../db/database.js';

const DB_PATH = process.env.KB_DB_PATH ?? path.join(os.homedir(), '.kb', 'knowledge.db');
const db = openDatabase(DB_PATH);
registerShutdownHandlers(db);

// Pass db to all tool handlers
// The db stays open for the lifetime of the MCP server process
```

### Pattern 3: Response Sizing with Truncation
**What:** Enforce <4KB responses by truncating result arrays and adding summary counts
**When to use:** Every tool response
**Example:**
```typescript
interface McpResponse<T> {
  summary: string;     // Human-readable one-liner
  data: T;             // Truncated result data
  total: number;       // Total count before truncation
  truncated: boolean;  // Whether results were cut
}

function formatResponse<T>(items: T[], limit: number, summaryFn: (items: T[]) => string): string {
  const truncated = items.slice(0, limit);
  const response: McpResponse<T[]> = {
    summary: summaryFn(truncated),
    data: truncated,
    total: items.length,
    truncated: items.length > limit,
  };
  const json = JSON.stringify(response);
  // Safety check: if still > 4KB, reduce further
  if (json.length > 4000) {
    return formatResponse(items, Math.floor(limit / 2), summaryFn);
  }
  return json;
}
```

### Pattern 4: Error Handling in Tool Handlers
**What:** Return `isError: true` with descriptive message on failure instead of throwing
**When to use:** All tool handlers
**Example:**
```typescript
// Source: Official MCP TypeScript SDK docs
server.registerTool('kb_search', { /* ... */ }, async ({ query }) => {
  try {
    const results = searchText(db, query);
    return { content: [{ type: 'text', text: formatResponse(results) }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
      isError: true,
    };
  }
});
```

### Pattern 5: Auto-Sync on Query
**What:** Before returning search results, check if result repos are stale and re-index
**When to use:** `kb_search`, `kb_entity`, `kb_deps` tools (read operations only)
**Example:**
```typescript
function checkAndSyncRepos(db: Database.Database, repoNames: string[]): void {
  for (const name of repoNames) {
    const row = db.prepare('SELECT path, last_indexed_commit FROM repos WHERE name = ?')
      .get(name) as { path: string; last_indexed_commit: string | null } | undefined;
    if (!row) continue;

    // Check if repo still exists
    if (!fs.existsSync(row.path)) continue;

    const currentCommit = getCurrentCommit(row.path);
    if (currentCommit && currentCommit !== row.last_indexed_commit) {
      // Re-index transparently
      indexSingleRepo(db, row.path, { force: false, rootDir: path.dirname(row.path) });
    }
  }
}
```

### Anti-Patterns to Avoid
- **console.log() in stdio MCP server:** NEVER use `console.log()` -- it writes to stdout which corrupts JSON-RPC messages. Use `console.error()` for all logging.
- **Opening DB per tool call:** The MCP server is a long-lived process. Open the database once at startup, not on every tool invocation.
- **Returning raw search results without sizing:** Always truncate and format. Raw `TextSearchResult[]` arrays can be huge and blow past 4KB.
- **Blocking stdio with long re-index operations:** If a re-index takes too long, the MCP client may timeout. Consider a maximum number of stale repos to re-index per query (e.g., 3).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| MCP protocol handling | Custom JSON-RPC over stdio | `@modelcontextprotocol/sdk` McpServer + StdioServerTransport | Protocol is complex (JSON-RPC 2.0 with specific MCP extensions); SDK handles framing, capabilities negotiation, error codes |
| Input validation | Manual type checking | Zod schemas via `registerTool` inputSchema | SDK converts Zod to JSON Schema automatically; provides type inference in handler |
| Git commit comparison | Custom git commands | Existing `getCurrentCommit()` from `src/indexer/git.ts` | Already tested and handles edge cases |
| Re-indexing | New indexing logic | Existing `indexSingleRepo()` from `src/indexer/pipeline.ts` | Already handles incremental indexing, all extractors, error isolation |
| FTS search | New search queries | Existing `searchText()`, `findEntity()`, `queryDependencies()` | Already handles FTS5 syntax errors, hydration, filtering |

**Key insight:** This phase should be almost entirely wiring code. The search, indexer, and knowledge modules are fully built and exported. The MCP server's job is: validate input -> call existing function -> format response -> return.

## Common Pitfalls

### Pitfall 1: console.log Corrupts Stdio Transport
**What goes wrong:** Any `console.log()` call writes to stdout, which the MCP protocol uses for JSON-RPC messages. This corrupts the message stream and crashes the server.
**Why it happens:** Developers add logging during development and forget stdio servers can't use stdout.
**How to avoid:** Use `console.error()` exclusively. Consider a helper: `const log = (...args: unknown[]) => console.error('[kb-mcp]', ...args);`
**Warning signs:** "Connection closed" errors in Claude Code, garbled tool responses.

### Pitfall 2: Zod Version Incompatibility
**What goes wrong:** MCP SDK v1.x has known issues with Zod v4. `registerTool` fails with "_parse is not a function" errors or schema descriptions are lost.
**Why it happens:** SDK internals use Zod v3 API surface. Zod v4 changed internal APIs.
**How to avoid:** Install `zod@^3.25` explicitly. Do NOT use `zod@4`.
**Warning signs:** Runtime errors in tool registration, missing field descriptions in tool schema.

### Pitfall 3: Re-index Timeout During Query
**What goes wrong:** Auto-sync triggers re-indexing of stale repos during a tool call. If many repos are stale, the tool takes too long and the MCP client times out.
**Why it happens:** Re-indexing involves git operations + file parsing, which can take seconds per repo.
**How to avoid:** Cap auto-sync to a small number of repos per query (recommend: 3 max). Report remaining stale repos in `kb_status` output.
**Warning signs:** MCP tool calls hanging, `MCP_TIMEOUT` errors in Claude Code.

### Pitfall 4: Response Size Exceeding 4KB
**What goes wrong:** Search results for broad queries (e.g., "service") return dozens of results, easily exceeding 4KB when serialized.
**Why it happens:** Raw search results include file paths, repo paths, snippets -- lots of text per result.
**How to avoid:** Default limit of 10 results, recursive truncation if still over 4KB, summarize rather than include full snippets.
**Warning signs:** LLM context gets polluted with huge MCP responses; Claude Code shows 10,000+ token warnings.

### Pitfall 5: Shebang Line Missing from MCP Entry Point
**What goes wrong:** `kb-mcp` command fails with "permission denied" or "not found" when invoked by Claude Code.
**Why it happens:** The compiled JS file needs `#!/usr/bin/env node` at the top and executable permissions.
**How to avoid:** Add shebang to `src/mcp/server.ts`, ensure build script sets `chmod 755` on output.
**Warning signs:** "command not found" or "ENOENT" when Claude Code tries to start the MCP server.

### Pitfall 6: Database Locked During Concurrent Operations
**What goes wrong:** If auto-sync re-indexes while another tool call reads, SQLite may report BUSY.
**Why it happens:** better-sqlite3 is synchronous, but MCP tool calls are async -- multiple can be in-flight.
**How to avoid:** Since better-sqlite3 is synchronous (single-threaded), this is actually safe -- Node's event loop serializes calls. But if you ever move to async SQLite, beware. WAL mode (already enabled) helps with read concurrency.
**Warning signs:** SQLITE_BUSY errors (unlikely with current sync driver but watch for it).

## Code Examples

### Complete Server Setup
```typescript
// src/mcp/server.ts
// Source: MCP SDK official docs + this project's existing patterns
#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import os from 'os';
import path from 'path';
import { openDatabase, registerShutdownHandlers } from '../db/database.js';

// Resolve DB path (same logic as CLI)
const dbPath = process.env.KB_DB_PATH ?? path.join(os.homedir(), '.kb', 'knowledge.db');
const db = openDatabase(dbPath);
registerShutdownHandlers(db);

const server = new McpServer({
  name: 'kb',
  version: '1.0.0',
});

// Register all tools (imported from ./tools/*.ts)
// ... registerSearchTool(server, db);
// ... registerEntityTool(server, db);
// ... etc.

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('kb MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in kb MCP server:', error);
  process.exit(1);
});
```

### Tool Registration Pattern (kb_search)
```typescript
// src/mcp/tools/search.ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { searchText } from '../../search/index.js';
import { formatResponse } from '../format.js';
import { checkAndSyncRepos } from '../sync.js';

export function registerSearchTool(server: McpServer, db: Database.Database): void {
  server.registerTool(
    'kb_search',
    {
      description: 'Full-text search across all indexed repos, modules, events, and learned facts. Returns ranked results with repo context.',
      inputSchema: {
        query: z.string().describe('Search query text'),
        limit: z.number().min(1).max(50).optional().describe('Max results (default: 10)'),
        repo: z.string().optional().describe('Filter to a specific repo by name'),
      },
    },
    async ({ query, limit, repo }) => {
      try {
        const results = searchText(db, query, {
          limit: limit ?? 10,
          repoFilter: repo,
        });

        // Auto-sync: check freshness of result repos
        const repoNames = [...new Set(results.map(r => r.repoName))];
        checkAndSyncRepos(db, repoNames);

        // Re-run search after sync (results may have changed)
        const freshResults = searchText(db, query, {
          limit: limit ?? 10,
          repoFilter: repo,
        });

        const text = formatResponse(
          freshResults,
          (items) => `Found ${freshResults.length} results for "${query}"`,
        );

        return { content: [{ type: 'text', text }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Search failed: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }
    },
  );
}
```

### Cleanup Tool (Data Hygiene)
```typescript
// src/mcp/tools/cleanup.ts
import fs from 'fs';
import type Database from 'better-sqlite3';

interface CleanupResult {
  summary: string;
  deletedRepos: string[];
  staleFacts: Array<{ id: number; content: string; repo: string | null }>;
}

export function detectDeletedRepos(db: Database.Database): string[] {
  const repos = db.prepare('SELECT name, path FROM repos').all() as Array<{ name: string; path: string }>;
  return repos
    .filter(r => !fs.existsSync(r.path))
    .map(r => r.name);
}

export function pruneDeletedRepos(db: Database.Database, repoNames: string[]): void {
  const deleteEdges = db.prepare(
    "DELETE FROM edges WHERE source_type = 'repo' AND source_id IN (SELECT id FROM repos WHERE name = ?)"
  );
  const deleteEvents = db.prepare('DELETE FROM events WHERE repo_id IN (SELECT id FROM repos WHERE name = ?)');
  const deleteModules = db.prepare('DELETE FROM modules WHERE repo_id IN (SELECT id FROM repos WHERE name = ?)');
  const deleteFiles = db.prepare('DELETE FROM files WHERE repo_id IN (SELECT id FROM repos WHERE name = ?)');
  const deleteServices = db.prepare('DELETE FROM services WHERE repo_id IN (SELECT id FROM repos WHERE name = ?)');
  const deleteFts = db.prepare(
    "DELETE FROM knowledge_fts WHERE entity_type = 'repo' AND entity_id IN (SELECT id FROM repos WHERE name = ?)"
  );
  const deleteRepo = db.prepare('DELETE FROM repos WHERE name = ?');

  const prune = db.transaction((names: string[]) => {
    for (const name of names) {
      deleteEdges.run(name);
      deleteEvents.run(name);
      deleteModules.run(name);
      deleteFiles.run(name);
      deleteServices.run(name);
      deleteFts.run(name);
      deleteRepo.run(name);
    }
  });

  prune(repoNames);
}
```

### Claude Code Configuration
```json
// .mcp.json (project scope, checked into repo)
{
  "mcpServers": {
    "kb": {
      "type": "stdio",
      "command": "kb-mcp"
    }
  }
}
```

Or via CLI:
```bash
# Local scope (personal)
claude mcp add --transport stdio kb -- kb-mcp

# If kb-mcp isn't in PATH, use full path:
claude mcp add --transport stdio kb -- node /path/to/repo-knowledge-base/dist/mcp/server.js
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `server.tool()` method | `server.registerTool()` method | MCP SDK ~1.20+ | `registerTool` is the recommended API; supports title, outputSchema |
| Zod v4 with MCP SDK | Zod v3.25+ with MCP SDK v1.x | Ongoing issue | Zod v4 causes runtime errors with SDK v1.x; stick to v3 |
| `mcpServers` in `claude_desktop_config.json` | `claude mcp add` CLI + `.mcp.json` | Claude Code 2024+ | Claude Code has its own MCP config; separate from Desktop app |
| SSE transport | HTTP transport (Streamable HTTP) | 2025 | SSE deprecated for remote; stdio still standard for local |

**Deprecated/outdated:**
- `server.tool()`: Older API, use `registerTool()` instead
- SSE transport: Deprecated for remote servers; use HTTP. Stdio unchanged for local.
- Zod v4 with MCP SDK v1: Known incompatibility, avoid

## Open Questions

1. **Exact truncation threshold for results**
   - What we know: Must be under 4KB total JSON response size
   - What's unclear: How many search results typically fit? Depends on snippet length.
   - Recommendation: Start with 10 results default, measure actual sizes during testing, add recursive reduction if over 4KB

2. **Should auto-sync re-run the query after syncing?**
   - What we know: If repos are re-indexed, search results may change
   - What's unclear: Is the overhead of searching twice worth it?
   - Recommendation: Yes, re-run after sync. The search is fast (<50ms typically). Stale results would be confusing.

3. **Batching vs sequential re-indexing**
   - What we know: Re-indexing is synchronous (better-sqlite3 + execSync for git). Multiple stale repos means sequential processing.
   - What's unclear: How many repos are typically stale?
   - Recommendation: Process up to 3 stale repos per query, report remaining in response. This keeps tool call latency reasonable.

4. **FTS cleanup for pruned repos**
   - What we know: FTS entries reference entity IDs via `entity_type` + `entity_id`. When entities are deleted, orphan FTS entries remain.
   - What's unclear: Best approach to clean FTS -- delete matching rows or rebuild?
   - Recommendation: Delete matching FTS rows by entity_type + entity_id within the same transaction as entity deletion. The existing `forgetFact` already does this pattern.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0.0 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/mcp/` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | 7 tools registered and callable | unit | `npx vitest run tests/mcp/tools.test.ts -t "registers"` | No -- Wave 0 |
| MCP-01 | Each tool returns valid MCP response | unit | `npx vitest run tests/mcp/tools.test.ts -t "response"` | No -- Wave 0 |
| MCP-02 | Responses under 4KB | unit | `npx vitest run tests/mcp/format.test.ts -t "4KB"` | No -- Wave 0 |
| MCP-02 | Truncation with summary field | unit | `npx vitest run tests/mcp/format.test.ts -t "truncat"` | No -- Wave 0 |
| MCP-03 | Stale repos detected and re-indexed | unit | `npx vitest run tests/mcp/sync.test.ts` | No -- Wave 0 |
| MCP-04 | Deleted repos detected | unit | `npx vitest run tests/mcp/hygiene.test.ts -t "deleted"` | No -- Wave 0 |
| MCP-04 | Stale facts flagged, not deleted | unit | `npx vitest run tests/mcp/hygiene.test.ts -t "facts"` | No -- Wave 0 |
| MCP-05 | Server starts and connects via stdio | integration | `npx vitest run tests/mcp/server.test.ts` | No -- Wave 0 |
| MCP-05 | bin entry works after npm link | smoke/manual | Manual: `npm link && kb-mcp` | N/A |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/mcp/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/mcp/tools.test.ts` -- covers MCP-01, MCP-02 (tool registration + responses)
- [ ] `tests/mcp/format.test.ts` -- covers MCP-02 (response sizing, truncation)
- [ ] `tests/mcp/sync.test.ts` -- covers MCP-03 (auto-sync detection + re-index)
- [ ] `tests/mcp/hygiene.test.ts` -- covers MCP-04 (deleted repo detection, fact flagging)
- [ ] `tests/mcp/server.test.ts` -- covers MCP-05 (server startup, transport connection)

Note: Testing MCP tools requires mocking the database (in-memory SQLite) similar to existing test patterns in `tests/search/` and `tests/knowledge/`. The MCP SDK's `McpServer` can be tested by calling tool handlers directly without a real transport.

## Sources

### Primary (HIGH confidence)
- [Official MCP TypeScript SDK docs (server.md)](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md) -- registerTool API, StdioServerTransport, error handling, response format
- [Official MCP Build Server Tutorial](https://modelcontextprotocol.io/docs/develop/build-server) -- Complete TypeScript example with tools + stdio
- [Claude Code MCP docs](https://code.claude.com/docs/en/mcp) -- Configuration scopes, `.mcp.json` format, `claude mcp add` CLI
- [NPM @modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk) -- Version 1.27.1, peer dependency on zod

### Secondary (MEDIUM confidence)
- [GitHub Issues: Zod v4 incompatibility](https://github.com/modelcontextprotocol/typescript-sdk/issues/925) -- Zod v4 breaks SDK v1.x; confirmed by multiple reporters
- [GitHub PR: registerTool accepts ZodType<object>](https://github.com/modelcontextprotocol/typescript-sdk/pull/816) -- inputSchema flexibility

### Tertiary (LOW confidence)
- None -- all findings verified against official sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- Official SDK is the only option; API verified against official docs and tutorial
- Architecture: HIGH -- Existing codebase patterns (CLI db.ts, search exports) directly inform MCP server structure
- Pitfalls: HIGH -- stdio logging issue documented in official docs; Zod v4 issue verified via GitHub issues; response sizing is standard MCP practice

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (SDK v1.x is stable; v2 may ship during this period but v1 will remain supported)
