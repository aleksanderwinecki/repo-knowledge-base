# Phase 25: Flow Tracing - Research

**Researched:** 2026-03-09
**Domain:** Graph shortest-path wrapping, MCP/CLI tool wiring
**Confidence:** HIGH

## Summary

Phase 25 is the thinnest of the v3.0 graph phases. The hard algorithmic work -- BFS-based shortest path on an in-memory graph -- already exists in `src/search/graph.ts` as `shortestPath()`, which returns `GraphHop[]` (or `null` for no path, or `[]` for same-node). This phase is purely: (1) write a thin `trace.ts` module that calls `shortestPath()`, validates inputs, formats the response and builds the arrow-chain summary; (2) wire it into MCP and CLI following the exact pattern established in Phase 24 (impact analysis).

The codebase has rock-solid conventions for every layer of this work. The MCP tool registration pattern (`registerXTool` + `wrapToolHandler` + zod schema), the CLI command pattern (`registerX` on a Commander program with `withDb` and `output`), the barrel re-export pattern in `src/search/index.ts`, and the test patterns (temp SQLite DB, helper functions for inserting repos/edges, integration tests for wiring) are all well-established across 506 existing tests.

**Primary recommendation:** Follow the Phase 24 (impact.ts) pattern exactly. Create `src/search/trace.ts` for logic, `src/mcp/tools/trace.ts` for MCP tool, `src/cli/commands/trace.ts` for CLI command. Wire into barrel exports and registration arrays.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- Arrow chain notation: `A -[grpc]-> B -[event: OrderCreated]-> C`
- `via` shown only for event/kafka hops (where it adds info: event name or topic). Omitted for grpc/http/gateway.
- Summary is just the arrow chain -- no footer. hop_count is a separate top-level field.
- Single format for both MCP and CLI (no compact formatter needed -- trace responses are inherently small, 2-5 hops)
- Top-level fields: `from`, `to`, `path_summary`, `hop_count`, `hops`
- Hop entries contain: `from`, `to`, `mechanism`, and optionally `via` (omitted when null)
- No confidence fields anywhere -- mechanism already implies reliability
- No repo IDs in response -- names only (IDs are internal graph detail)
- Same-service query (from === to): return zero-hop success with `path_summary: "app-payments (same service)"`, empty hops array
- Thrown errors (consistent with Phase 24 pattern), caught by wrapToolHandler for MCP
- Validate both `from` and `to` upfront -- if both missing, report both in one error: `"Services not found: app-foo, app-bar"`
- Single missing: `"Service not found: app-foo"`
- No path: `"No path between app-api and app-foo"` (plain message, no hints)
- Exact name matching only -- no fuzzy/substring matching
- Confidence dropped entirely from trace (simplification of TRACE-04)

### Claude's Discretion
- TraceResult type structure (interface design)
- Whether to create a trace.ts module or inline in the tool (recommended: separate module like impact.ts)
- Test fixture design and edge case coverage
- CLI output formatting (JSON vs table)

### Deferred Ideas (OUT OF SCOPE)
- Multiple path discovery (top N paths) -- deferred to AGRAPH-01
- Fuzzy service name matching -- could be a cross-cutting feature for all graph tools

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TRACE-01 | Agent can find shortest path between two services via MCP tool `kb_trace` or CLI `kb trace` | `shortestPath()` in graph.ts already implements BFS shortest path. Need thin wrapper + MCP/CLI wiring following Phase 24 pattern. |
| TRACE-02 | Response includes ordered hop list with mechanism per hop and a path_summary string | `GraphHop[]` from shortestPath already has fromRepoName/toRepoName/mechanism/via. Need formatting layer to strip IDs, build arrow chain. |
| TRACE-03 | Distinct error responses for "service not found" vs "no path exists" | Validation via `graph.repoIds.get(name)` for not-found, `shortestPath() === null` for no-path. Two distinct thrown Error messages. |
| TRACE-04 | Each hop annotated with confidence level; response includes min-path confidence (weakest link) | **SIMPLIFIED per user decision:** Confidence dropped entirely. Mechanism alone tells the story. No per-hop confidence, no min_confidence rollup. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | (existing) | Database access | Already used throughout; `buildGraph()` loads data from SQLite |
| zod | (existing) | MCP tool schema validation | All MCP tools use zod for input schemas |
| @commander-js/extra-typings | (existing) | CLI command registration | All CLI commands use this |
| @modelcontextprotocol/sdk | (existing) | MCP server tool registration | All MCP tools use `McpServer.tool()` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | (existing) | Test framework | All 506 existing tests use vitest |

### Alternatives Considered
None. No new dependencies needed. This phase uses only what's already installed.

## Architecture Patterns

### Recommended Project Structure
```
src/
  search/
    trace.ts           # NEW: traceRoute() function + TraceResult types
    graph.ts           # EXISTING: shortestPath() - the core primitive
    types.ts           # EXISTING: GraphHop type (consumed by trace.ts)
    index.ts           # MODIFIED: re-export traceRoute + TraceResult
  mcp/
    tools/
      trace.ts         # NEW: registerTraceTool(server, db)
    server.ts          # MODIFIED: import + call registerTraceTool
  cli/
    commands/
      trace.ts         # NEW: registerTrace(program)
    index.ts           # MODIFIED: import + call registerTrace
tests/
  search/
    trace.test.ts      # NEW: unit tests for traceRoute logic
  integration/
    trace-wiring.test.ts  # NEW: MCP tool + CLI wiring tests
```

### Pattern 1: Search Module (trace.ts)
**What:** A thin module that calls `shortestPath()`, validates inputs, and formats the result.
**When to use:** This is the core logic layer, used by both MCP and CLI.
**Example:**
```typescript
// Source: Follows exact pattern from src/search/impact.ts
import type Database from 'better-sqlite3';
import { buildGraph, shortestPath } from './graph.js';

export interface TraceHop {
  from: string;
  to: string;
  mechanism: string;
  via?: string;  // Only present for event/kafka hops
}

export interface TraceResult {
  from: string;
  to: string;
  path_summary: string;
  hop_count: number;
  hops: TraceHop[];
}

export function traceRoute(
  db: Database.Database,
  from: string,
  to: string,
): TraceResult {
  const graph = buildGraph(db);

  // Validate both services upfront
  const fromId = graph.repoIds.get(from);
  const toId = graph.repoIds.get(to);
  const missing: string[] = [];
  if (fromId === undefined) missing.push(from);
  if (toId === undefined) missing.push(to);
  if (missing.length > 0) {
    throw new Error(
      missing.length === 1
        ? `Service not found: ${missing[0]}`
        : `Services not found: ${missing.join(', ')}`
    );
  }

  // Same-service case
  if (from === to) {
    return {
      from, to,
      path_summary: `${from} (same service)`,
      hop_count: 0,
      hops: [],
    };
  }

  const path = shortestPath(graph, fromId!, toId!);
  if (path === null) {
    throw new Error(`No path between ${from} and ${to}`);
  }

  const hops: TraceHop[] = path.map((hop) => {
    const entry: TraceHop = {
      from: hop.fromRepoName,
      to: hop.toRepoName,
      mechanism: hop.mechanism,
    };
    // Only include via for event/kafka hops
    if (hop.via && (hop.mechanism === 'event' || hop.mechanism === 'kafka')) {
      entry.via = hop.via;
    }
    return entry;
  });

  return {
    from, to,
    path_summary: buildPathSummary(hops),
    hop_count: hops.length,
    hops,
  };
}

function buildPathSummary(hops: TraceHop[]): string {
  if (hops.length === 0) return '';
  let result = hops[0].from;
  for (const hop of hops) {
    const label = hop.via ? `${hop.mechanism}: ${hop.via}` : hop.mechanism;
    result += ` -[${label}]-> ${hop.to}`;
  }
  return result;
}
```

### Pattern 2: MCP Tool Registration
**What:** Register `kb_trace` tool with zod schema and `wrapToolHandler`.
**When to use:** MCP tool wiring.
**Example:**
```typescript
// Source: Follows exact pattern from src/mcp/tools/impact.ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { traceRoute } from '../../search/trace.js';
import { wrapToolHandler } from '../handler.js';

export function registerTraceTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_trace',
    'Trace the shortest path between two services',
    {
      from: z.string().describe('Source service/repo name'),
      to: z.string().describe('Target service/repo name'),
    },
    wrapToolHandler('kb_trace', async ({ from, to }) => {
      const result = traceRoute(db, from, to);
      return JSON.stringify(result);
    }),
  );
}
```

### Pattern 3: CLI Command Registration
**What:** Register `kb trace <from> <to>` command with Commander.
**When to use:** CLI wiring.
**Example:**
```typescript
// Source: Follows exact pattern from src/cli/commands/impact.ts
import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { traceRoute } from '../../search/trace.js';
import { output } from '../output.js';

export function registerTrace(program: Command) {
  program
    .command('trace')
    .description('Trace shortest path between two services')
    .argument('<from>', 'source service/repo name')
    .argument('<to>', 'target service/repo name')
    .action((from, to) => {
      const result = withDb((db) => traceRoute(db, from, to));
      output(result);
    });
}
```

### Anti-Patterns to Avoid
- **Adding confidence to the response:** User explicitly dropped TRACE-04's confidence requirement. Do not include confidence fields.
- **Adding a compact formatter:** Trace responses are small (2-5 hops). A single format serves both MCP and CLI.
- **Inlining logic in the MCP tool:** Keep logic in `src/search/trace.ts` so it's testable independently of MCP infra.
- **Including repo IDs in response:** User decision: names only, IDs are internal.
- **Fuzzy matching service names:** User decision: exact match only. Deferred to future cross-cutting feature.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Shortest path algorithm | BFS implementation | `shortestPath()` from graph.ts | Already tested, handles cycles, undirected traversal, edge direction preservation |
| Graph construction | SQL queries + adjacency lists | `buildGraph()` from graph.ts | Handles direct, event, kafka edges with dedup and self-loop removal |
| MCP error handling | try/catch in each tool | `wrapToolHandler()` HOF | Consistent error envelope across all tools |
| Database lifecycle | Manual open/close | `withDb()` from cli/db.ts | Ensures database always closed, even on exceptions |
| Input validation | Manual checks | zod schemas | MCP SDK handles validation, consistent with all other tools |

**Key insight:** This phase's entire value is in the thin formatting and wiring layer. The algorithm is done.

## Common Pitfalls

### Pitfall 1: Forgetting to validate both services upfront
**What goes wrong:** Validating `from` first and throwing immediately means if both are invalid, the user gets two separate error round-trips.
**Why it happens:** Natural to check one at a time.
**How to avoid:** Check both `from` and `to` against `graph.repoIds` before doing anything else. Collect missing names into an array and throw once.
**Warning signs:** Test only checks single-missing cases.

### Pitfall 2: Including `via` for all hops
**What goes wrong:** grpc/http/gateway hops have `via: null` in GraphHop, which would show up as `null` in JSON output.
**Why it happens:** GraphHop always has the `via` field.
**How to avoid:** Only include `via` in the response when mechanism is `event` or `kafka` AND `via` is non-null. Use conditional property assignment.
**Warning signs:** JSON output shows `"via": null` for grpc hops.

### Pitfall 3: Arrow chain with via for wrong mechanisms
**What goes wrong:** The path_summary shows `grpc: null` because via was included for non-event hops.
**Why it happens:** Not filtering which hops get the `mechanism: via` format vs just `mechanism`.
**How to avoid:** In `buildPathSummary`, only append `: ${hop.via}` when `hop.via` is truthy (which only happens for event/kafka hops after the filtering in hop construction).
**Warning signs:** Path summary contains `: null` or `: undefined`.

### Pitfall 4: Same-service edge case
**What goes wrong:** `shortestPath()` returns `[]` (empty array) for from === to, which could be confused with "no path".
**Why it happens:** Same-service isn't checked before calling shortestPath.
**How to avoid:** Check `from === to` early and return the special same-service response immediately, before calling shortestPath.
**Warning signs:** Same-service query returns an error or unexpected result.

### Pitfall 5: Not registering in both entry points
**What goes wrong:** Tool works in MCP but not CLI (or vice versa).
**Why it happens:** Forgetting to add the import and registration call in `src/mcp/server.ts` or `src/cli/index.ts`.
**How to avoid:** Integration tests that verify tool registration exist.
**Warning signs:** `kb trace` command not found or `kb_trace` tool not listed.

## Code Examples

### GraphHop type (the input from shortestPath)
```typescript
// Source: src/search/types.ts
export interface GraphHop {
  fromRepoId: number;
  fromRepoName: string;
  toRepoId: number;
  toRepoName: string;
  mechanism: string;
  confidence: string | null;
  via: string | null;
}
```

### shortestPath return values
```typescript
// Source: src/search/graph.ts
shortestPath(graph, fromId, toId)
// Returns:
//   [] when fromId === toId
//   null when no path exists
//   GraphHop[] (ordered, 1+ elements) when path found
```

### wrapToolHandler error pattern
```typescript
// Source: src/mcp/handler.ts
// Thrown errors become: { content: [{ type: 'text', text: 'Error in kb_trace: ...' }], isError: true }
// Successful returns become: { content: [{ type: 'text', text: '...' }] }
```

### CLI error pattern
```typescript
// Source: src/cli/output.ts
// Thrown errors from traceRoute() will propagate naturally and crash the CLI.
// But analyzeImpact() in the impact CLI also just lets errors propagate (no try/catch).
// The CLI doesn't catch -- thrown errors print stack trace to stderr and exit non-zero.
```

### Barrel export pattern
```typescript
// Source: src/search/index.ts -- add these lines:
export { traceRoute } from './trace.js';
export type { TraceResult, TraceHop } from './trace.js';
```

### MCP server registration pattern
```typescript
// Source: src/mcp/server.ts -- add these lines:
import { registerTraceTool } from './tools/trace.js';
// ... in createServer():
registerTraceTool(server, db);
```

### CLI registration pattern
```typescript
// Source: src/cli/index.ts -- add these lines:
import { registerTrace } from './commands/trace.js';
// ... after other register calls:
registerTrace(program);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| N/A | shortestPath uses undirected BFS on forward+reverse adjacency | Phase 23 (2026-03-09) | Path finding treats the graph as undirected but preserves actual edge direction in results |
| Graph per query (~9ms) | Same | Phase 23 | No caching needed at current scale; graph builds fresh each call |

**Deprecated/outdated:**
- Nothing in this domain. The graph module is brand new (Phase 23, same day).

## Open Questions

1. **withAutoSync for trace?**
   - What we know: Impact MCP tool uses `withAutoSync` to detect stale repos and re-index before returning results. The sync only fires when there are repo names in the result.
   - What's unclear: Whether trace should also auto-sync. Trace results contain 2-5 service names.
   - Recommendation: Include `withAutoSync` for consistency with impact. The cost is negligible and ensures fresh data. However, this is Claude's discretion -- could also skip it since trace is a lightweight query and staleness is less critical for pathfinding.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/search/trace.test.ts tests/integration/trace-wiring.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRACE-01 | traceRoute returns result for connected services | unit | `npx vitest run tests/search/trace.test.ts -t "returns result"` | Wave 0 |
| TRACE-01 | kb_trace MCP tool registered and callable | integration | `npx vitest run tests/integration/trace-wiring.test.ts -t "tool is registered"` | Wave 0 |
| TRACE-01 | kb trace CLI command registered | integration | `npx vitest run tests/integration/trace-wiring.test.ts -t "CLI"` | Wave 0 |
| TRACE-02 | result contains hops with mechanism, path_summary | unit | `npx vitest run tests/search/trace.test.ts -t "hop"` | Wave 0 |
| TRACE-02 | path_summary uses arrow chain notation | unit | `npx vitest run tests/search/trace.test.ts -t "path_summary"` | Wave 0 |
| TRACE-02 | via only shown for event/kafka hops | unit | `npx vitest run tests/search/trace.test.ts -t "via"` | Wave 0 |
| TRACE-03 | throws distinct error for service not found | unit | `npx vitest run tests/search/trace.test.ts -t "not found"` | Wave 0 |
| TRACE-03 | throws distinct error for no path | unit | `npx vitest run tests/search/trace.test.ts -t "no path"` | Wave 0 |
| TRACE-03 | reports both missing services in one error | unit | `npx vitest run tests/search/trace.test.ts -t "both"` | Wave 0 |
| TRACE-04 | no confidence fields in response (simplified) | unit | `npx vitest run tests/search/trace.test.ts -t "confidence"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/search/trace.test.ts tests/integration/trace-wiring.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/search/trace.test.ts` -- covers TRACE-01 through TRACE-04
- [ ] `tests/integration/trace-wiring.test.ts` -- covers MCP tool registration and barrel exports

## Sources

### Primary (HIGH confidence)
- `src/search/graph.ts` -- shortestPath() implementation, GraphHop return type
- `src/search/types.ts` -- GraphHop, ServiceGraph type definitions
- `src/search/impact.ts` -- exact module pattern to follow (analyzeImpact -> traceRoute)
- `src/mcp/tools/impact.ts` -- exact MCP tool pattern (registerImpactTool -> registerTraceTool)
- `src/cli/commands/impact.ts` -- exact CLI command pattern (registerImpact -> registerTrace)
- `src/mcp/handler.ts` -- wrapToolHandler HOF for error handling
- `src/mcp/server.ts` -- tool registration array pattern
- `src/cli/index.ts` -- command registration pattern
- `src/search/index.ts` -- barrel re-export pattern
- `tests/search/impact.test.ts` -- test fixture pattern (temp DB, helper functions)
- `tests/integration/impact-wiring.test.ts` -- integration test pattern (McpServer, _registeredTools, callTool)
- `tests/search/graph.test.ts` -- shortestPath test cases confirming return value semantics

### Secondary (MEDIUM confidence)
- None needed. All information comes directly from the codebase.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already in use, no new dependencies
- Architecture: HIGH - exact patterns exist in Phase 24 code, copy-and-adapt
- Pitfalls: HIGH - identified from reading the actual code and understanding edge cases in the data model

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- no external dependencies, pure internal patterns)
