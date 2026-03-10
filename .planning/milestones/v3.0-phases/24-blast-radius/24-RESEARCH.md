# Phase 24: Blast Radius - Research

**Researched:** 2026-03-09
**Domain:** Graph traversal, impact analysis, MCP/CLI tool registration
**Confidence:** HIGH

## Summary

Phase 24 builds an impact analysis feature on top of the graph infrastructure completed in Phase 23. The work is entirely within the existing codebase patterns: a new `bfsUpstream` function in `graph.ts`, a new `impact.ts` search module, a new MCP tool `kb_impact`, and a new CLI command `kb impact`. All patterns are well-established from prior phases.

The key technical challenge is the compact MCP formatter for hub nodes (300+ affected services within 4KB). The existing `formatResponse` in `src/mcp/format.ts` uses a generic halving strategy that won't work here — impact needs a domain-specific formatter that preserves direct/indirect services fully and truncates transitive services first. The blast radius score formula (direct x 3 + indirect x 2 + transitive x 1) and depth-based severity tiers are straightforward arithmetic.

**Primary recommendation:** Follow the established pattern exactly — new search module, new MCP tool, new CLI command — with a custom compact formatter for impact responses that prioritizes high-severity results.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Add `bfsUpstream` to `graph.ts` — symmetric with existing `bfsDownstream`, traverses reverse adjacency
- Impact = "who depends on me" = follow reverse edges
- Mechanism filtering happens during BFS (skip non-matching edges), not post-filter
- `bfsUpstream` returns enriched nodes with edge metadata (mechanism + confidence per edge that reached them)
- Report ALL edges to an affected service, not just first discovered
- Depth-based tiers: depth 1 = direct, depth 2 = indirect, depth 3+ = transitive
- Single "Transitive (depth 3+)" bucket — no per-depth sub-groups beyond 2
- Services grouped under tier headers in output, not per-service tier field
- Default depth cap: 3, max allowed: 10
- Blast radius score formula: weighted sum = direct x 3 + indirect x 2 + transitive x 1
- Score does NOT incorporate confidence levels
- Stats block includes mechanism breakdown (e.g., "grpc: 12, event: 8, kafka: 3")
- NO qualitative risk labels (low/medium/high)
- Per-service info in compact mode: name + mechanisms list (e.g., `"app-payments": ["grpc", "event"]`)
- Confidence dropped in compact mode
- CLI output is full verbose — no 4KB cap
- Only MCP responses respect the 4KB compact format

### Claude's Discretion
- Truncation strategy when MCP response exceeds 4KB (recommended: keep direct+indirect full, truncate transitive first with "...and N more")
- Whether to include a human-readable summary line (recommended: yes, as `summary` field)
- Exact structure of the enriched BfsNode type returned by bfsUpstream
- Whether bfsUpstream accepts mechanism filter param or impact module wraps/filters
- Test fixtures and edge case coverage

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IMPACT-01 | Agent can query blast radius via MCP `kb_impact` or CLI `kb impact` | MCP tool pattern: `registerXTool(server, db)` + zod schema + `wrapToolHandler` + `withAutoSync`. CLI pattern: `registerX(program)` with `@commander-js/extra-typings`. Both established in deps/search tools. |
| IMPACT-02 | Results grouped by depth with mechanism labels and confidence per affected service | `bfsUpstream` returns enriched nodes with all edges (mechanism + confidence). Impact module groups by depth tier. |
| IMPACT-03 | Optional `--mechanism` filter limits traversal to specific edge types | `VALID_MECHANISMS` from edge-utils.ts provides the enum. Filter applied during BFS by checking `edge.mechanism` before enqueueing. |
| IMPACT-04 | Optional `--depth` limit caps traversal depth (default 3) | Same `maxDepth` pattern as `bfsDownstream`. Default 3, max 10 validated by zod `.min(1).max(10)`. |
| IMPACT-05 | Severity tiers classify affected services as direct, indirect, or transitive | Pure depth mapping: 1=direct, 2=indirect, 3+=transitive. Group services under tier headers. |
| IMPACT-06 | Aggregated mechanism summary and blast radius score in stats block | Score = direct x 3 + indirect x 2 + transitive x 1. Mechanism breakdown from counting edge mechanisms across all affected nodes. |
| IMPACT-07 | Compact response formatter fits 300+ affected services within 4KB MCP cap | Custom formatter: compact per-service format (name + mechanisms array), truncate transitive first, include "...and N more" count. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | existing | Graph data source | All search functions use `db: Database.Database` as first param |
| zod | existing | MCP tool parameter validation | All MCP tools use zod schemas |
| @modelcontextprotocol/sdk | existing | MCP server tool registration | `McpServer.tool()` API |
| @commander-js/extra-typings | existing | CLI command registration | All CLI commands use this |
| vitest | existing | Test framework | `vitest run` for all tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| edge-utils.ts | internal | `VALID_MECHANISMS`, `extractConfidence` | Mechanism validation and confidence extraction |
| graph.ts | internal | `buildGraph()`, `ServiceGraph` type | Graph construction, adjacency lists |
| format.ts | internal | `formatResponse`, `formatSingleResponse` | Reference for MCP response structure (but impact needs custom formatter) |
| handler.ts | internal | `wrapToolHandler` | Error handling wrapper for MCP tools |
| sync.ts | internal | `withAutoSync` | Stale repo detection and re-query |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom compact formatter | Existing `formatResponse` | `formatResponse` halves items generically — impact needs to preserve high-severity items and truncate transitive first. Custom is correct here. |
| BFS filter param | Post-filter after full BFS | Post-filter gives wrong answers for mechanism-scoped queries ("what breaks if my gRPC changes" should not traverse non-gRPC edges). Locked decision: filter during BFS. |

## Architecture Patterns

### Recommended Project Structure
```
src/
├── search/
│   ├── graph.ts          # ADD bfsUpstream here (alongside bfsDownstream, shortestPath)
│   ├── impact.ts         # NEW: impact analysis logic (analyzeImpact function)
│   ├── types.ts          # ADD ImpactResult, ImpactNode, ImpactStats types
│   ├── edge-utils.ts     # existing — reuse VALID_MECHANISMS
│   └── index.ts          # ADD exports for impact module
├── mcp/
│   ├── tools/
│   │   └── impact.ts     # NEW: registerImpactTool
│   └── server.ts         # ADD registerImpactTool call
├── cli/
│   ├── commands/
│   │   └── impact.ts     # NEW: registerImpact CLI command
│   └── index.ts          # ADD registerImpact call
tests/
├── search/
│   ├── graph.test.ts     # ADD bfsUpstream tests
│   └── impact.test.ts    # NEW: impact analysis tests
├── mcp/
│   ├── tools.test.ts     # ADD kb_impact tool tests
│   └── contracts.test.ts # ADD kb_impact contract tests
```

### Pattern 1: bfsUpstream (enriched BFS on reverse adjacency)
**What:** BFS traversal on reverse adjacency list with mechanism filtering and multi-edge collection
**When to use:** Impact analysis — "who depends on me"
**Key differences from bfsDownstream:**
1. Traverses `graph.reverse` instead of `graph.forward`
2. Collects ALL edges reaching each node (not just first discovery)
3. Optionally filters edges by mechanism during traversal
4. Returns enriched nodes with edge metadata

**Example:**
```typescript
// Recommended type for enriched BFS result
export interface ImpactNode {
  repoId: number;
  repoName: string;
  depth: number;
  edges: Array<{ mechanism: string; confidence: string | null }>;
}

export function bfsUpstream(
  graph: ServiceGraph,
  startRepoId: number,
  maxDepth: number = 3,
  mechanismFilter?: string,
): ImpactNode[] {
  const visited = new Map<number, ImpactNode>();
  const queue: Array<[number, number]> = []; // [repoId, depth]

  // Mark start as visited (don't include in results)
  visited.set(startRepoId, { repoId: startRepoId, repoName: '', depth: 0, edges: [] });

  // Seed from reverse neighbors of start
  const reverseNeighbors = graph.reverse.get(startRepoId) ?? [];
  for (const edge of reverseNeighbors) {
    if (edge.targetRepoId === 0) continue;
    if (mechanismFilter && edge.mechanism !== mechanismFilter) continue;
    queue.push([edge.targetRepoId, 1]);
  }

  while (queue.length > 0) {
    const [repoId, depth] = queue.shift()!;
    if (repoId === 0) continue;

    // Collect ALL edges from this node to already-visited nodes
    // (multiple mechanisms between same pair)
    const existing = visited.get(repoId);
    if (existing) {
      // Already visited — but collect additional edge info from new paths
      // Edge collection handled separately (see note below)
      continue;
    }

    const repoName = graph.repoNames.get(repoId) ?? `unknown-${repoId}`;

    // Collect all edges from this node that lead to the target
    // In reverse map: reverse[startRepoId] has edges with targetRepoId = callers
    // We need edges FROM repoId TO any visited node
    const edgesFromThisNode = collectEdges(graph, repoId, visited, mechanismFilter);

    visited.set(repoId, { repoId, repoName, depth, edges: edgesFromThisNode });

    if (depth < maxDepth) {
      const neighbors = graph.reverse.get(repoId) ?? [];
      for (const edge of neighbors) {
        if (edge.targetRepoId !== 0 && !visited.has(edge.targetRepoId)) {
          if (mechanismFilter && edge.mechanism !== mechanismFilter) continue;
          queue.push([edge.targetRepoId, depth + 1]);
        }
      }
    }
  }

  // Remove start node from results
  visited.delete(startRepoId);
  return Array.from(visited.values());
}
```

**Important design note on edge collection:** The CONTEXT says "Report ALL edges to an affected service." In the reverse adjacency list, `reverse.get(nodeX)` contains edges where `targetRepoId` is who calls X. To collect all edges reaching a discovered node, we need the edges FROM that node TO any node already in the BFS tree. The simplest approach: for each discovered node, scan `graph.forward.get(discoveredNode)` for edges pointing to already-visited nodes — these are the "dependency edges" (the discovered node depends on visited nodes). Apply mechanism filter here too.

### Pattern 2: Impact Analysis Module
**What:** Orchestrates graph build, BFS, tier classification, stats computation, and formatting
**When to use:** Called by both MCP tool and CLI command

```typescript
export interface ImpactResult {
  service: string;
  tiers: {
    direct: ImpactServiceEntry[];
    indirect: ImpactServiceEntry[];
    transitive: ImpactServiceEntry[];
  };
  stats: ImpactStats;
  summary: string;
}

export interface ImpactServiceEntry {
  name: string;
  mechanisms: string[];
  confidence: Array<string | null>;
}

export interface ImpactStats {
  total: number;
  direct: number;
  indirect: number;
  transitive: number;
  blastRadiusScore: number;
  mechanisms: Record<string, number>;
}
```

### Pattern 3: MCP Tool Registration
**What:** Standard `registerXTool(server, db)` pattern
**Example (from deps tool):**
```typescript
export function registerImpactTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_impact',
    'Blast radius analysis: what services break if this service changes',
    {
      name: z.string().describe('Service/repo name to analyze impact for'),
      mechanism: z.enum(VALID_MECHANISMS as [string, ...string[]]).optional()
        .describe('Filter by mechanism (grpc, http, gateway, kafka, event)'),
      depth: z.number().min(1).max(10).optional()
        .describe('Max traversal depth (default: 3)'),
    },
    wrapToolHandler('kb_impact', async ({ name, mechanism, depth }) => {
      // ... build graph, run bfsUpstream, format result
    }),
  );
}
```

### Pattern 4: CLI Command Registration
**What:** Standard `registerX(program)` with commander options
```typescript
export function registerImpact(program: Command) {
  program
    .command('impact')
    .description('Analyze blast radius for a service')
    .argument('<service>', 'service/repo name')
    .option('--mechanism <type>', 'filter by mechanism (grpc, http, gateway, kafka, event)')
    .option('--depth <n>', 'max traversal depth (default: 3)', '3')
    .option('--timing', 'report timing to stderr', false)
    .action((service, opts) => {
      // ... withDb, buildGraph, analyzeImpact, output(result)
    });
}
```

### Anti-Patterns to Avoid
- **Post-filtering BFS results by mechanism:** This gives wrong answers. If A -grpc-> B -event-> C, filtering for "grpc" after full BFS would incorrectly include C. Filter during traversal so C is never reached.
- **Using generic `formatResponse` for impact:** It halves items indiscriminately. Impact needs tier-aware truncation that preserves direct/indirect while trimming transitive.
- **Per-service tier field instead of grouped output:** The decision explicitly says group under tier headers, not tag each service with a tier field. This affects the JSON structure.
- **Including the start node in results:** Same pattern as `bfsDownstream` — exclude the queried service from the result list.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Graph construction | Custom SQL queries | `buildGraph(db)` from graph.ts | Already builds forward AND reverse adjacency, handles event/kafka resolution |
| Mechanism validation | Manual string checks | `VALID_MECHANISMS` from edge-utils.ts + zod `.enum()` | Validated set, consistent with deps tool |
| MCP error handling | Try/catch in handler | `wrapToolHandler` HOF | Uniform error envelope across all tools |
| Stale repo sync | Manual freshness checks | `withAutoSync` | Handles detect-sync-requery pattern |
| Confidence extraction | JSON parsing | `extractConfidence` from edge-utils.ts | Handles null/malformed metadata |

**Key insight:** The graph infrastructure from Phase 23 does the heavy lifting. This phase is primarily BFS direction + formatting + plumbing.

## Common Pitfalls

### Pitfall 1: Reverse Adjacency Edge Direction
**What goes wrong:** In `graph.reverse`, edges at node X have `targetRepoId` = the source of the original forward edge (the caller). This is the OPPOSITE of what you might expect.
**Why it happens:** The `addEdge` function in `buildGraph` stores reverse edges as `{ ...edge, targetRepoId: fromId }` — so `targetRepoId` in the reverse map points to the original source, not the original target.
**How to avoid:** When doing `bfsUpstream` from node X, `reverse.get(X)` gives edges where `targetRepoId` = nodes that CALL X. These ARE the upstream dependents we want.
**Warning signs:** If your BFS returns downstream instead of upstream results, you're traversing the wrong direction.

### Pitfall 2: Multi-Edge Collection Timing
**What goes wrong:** BFS discovers a node at depth 1, but there's also a depth-2 path with a different mechanism. If you only record edges at discovery time, you miss the second mechanism.
**Why it happens:** Standard BFS visits each node only once (first discovery wins).
**How to avoid:** The CONTEXT says "report ALL edges to an affected service." After BFS determines which nodes are affected and at what depth, do a second pass to collect all relevant edges from each affected node. Or: collect edges during BFS but allow edge updates to already-visited nodes.
**Warning signs:** Node shows only "grpc" when it should show "grpc, event."

### Pitfall 3: 4KB Compact Format Miscalculation
**What goes wrong:** You build the response, check size, and truncate — but the truncation message itself pushes you over 4KB.
**Why it happens:** "...and 247 more transitive services" adds characters you didn't budget for.
**How to avoid:** Budget for the truncation message BEFORE calculating how many transitive services to include. A safe approach: serialize everything except transitive, measure remaining budget, fill transitive services until budget runs out.
**Warning signs:** Intermittent 4KB overflows depending on service name lengths.

### Pitfall 4: Mechanism Filter Applied Inconsistently
**What goes wrong:** BFS filters edges by mechanism but the stats block counts ALL mechanisms including filtered ones.
**Why it happens:** Stats computed from different data than the BFS traversal.
**How to avoid:** Stats MUST be computed from the same filtered BFS results. If filtering for "grpc," the mechanism breakdown should show only grpc edges, and blast radius score should count only grpc-reachable services.
**Warning signs:** Stats show mechanisms that shouldn't appear given the filter.

### Pitfall 5: Hub Node Performance
**What goes wrong:** Service with 300+ dependents causes slow BFS.
**Why it happens:** Unlikely — BFS is O(V+E) and the graph builds in ~9ms for 12K edges. But if you're building graph per-query AND running BFS, keep it under budget.
**How to avoid:** The existing pattern (build fresh per query, ~9ms) is fine. BFS on a few hundred nodes is microseconds. No caching needed.
**Warning signs:** Only relevant if total graph grows 10x+. Not a current concern.

## Code Examples

### Edge Collection for Multi-Mechanism Reporting
```typescript
// After BFS determines affected nodes, collect all edges from each affected node
// that connect to the subgraph (the queried service + its downstream chain)
function collectEdgesForNode(
  graph: ServiceGraph,
  nodeId: number,
  subgraphIds: Set<number>,
  mechanismFilter?: string,
): Array<{ mechanism: string; confidence: string | null }> {
  const edges: Array<{ mechanism: string; confidence: string | null }> = [];
  const forwardEdges = graph.forward.get(nodeId) ?? [];
  for (const edge of forwardEdges) {
    if (!subgraphIds.has(edge.targetRepoId)) continue;
    if (mechanismFilter && edge.mechanism !== mechanismFilter) continue;
    edges.push({ mechanism: edge.mechanism, confidence: edge.confidence });
  }
  return edges;
}
```

### Blast Radius Score Computation
```typescript
function computeBlastRadiusScore(tiers: {
  direct: unknown[];
  indirect: unknown[];
  transitive: unknown[];
}): number {
  return tiers.direct.length * 3 + tiers.indirect.length * 2 + tiers.transitive.length * 1;
}
```

### Custom Compact Formatter for Impact
```typescript
const MAX_RESPONSE_CHARS = 4000;

function formatImpactCompact(result: ImpactResult): string {
  // Always include: summary, stats, direct tier, indirect tier
  // Truncate transitive tier to fit within 4KB
  const base = {
    summary: result.summary,
    stats: result.stats,
    direct: Object.fromEntries(
      result.tiers.direct.map(s => [s.name, s.mechanisms])
    ),
    indirect: Object.fromEntries(
      result.tiers.indirect.map(s => [s.name, s.mechanisms])
    ),
    transitive: {} as Record<string, string[]>,
  };

  // Measure base size without transitive
  const baseJson = JSON.stringify(base);
  const remaining = MAX_RESPONSE_CHARS - baseJson.length - 100; // safety margin

  if (remaining > 0 && result.tiers.transitive.length > 0) {
    // Fill transitive until budget exhausted
    let added = 0;
    for (const svc of result.tiers.transitive) {
      const entry = JSON.stringify({ [svc.name]: svc.mechanisms });
      if (JSON.stringify(base).length + entry.length > MAX_RESPONSE_CHARS - 80) break;
      base.transitive[svc.name] = svc.mechanisms;
      added++;
    }
    const omitted = result.tiers.transitive.length - added;
    if (omitted > 0) {
      (base as Record<string, unknown>).transitive_truncated = `...and ${omitted} more`;
    }
  } else if (result.tiers.transitive.length > 0) {
    (base as Record<string, unknown>).transitive_truncated =
      `...and ${result.tiers.transitive.length} more transitive services`;
  }

  return JSON.stringify(base);
}
```

### Tier Classification
```typescript
function classifyByTier(nodes: ImpactNode[]): {
  direct: ImpactNode[];
  indirect: ImpactNode[];
  transitive: ImpactNode[];
} {
  const direct: ImpactNode[] = [];
  const indirect: ImpactNode[] = [];
  const transitive: ImpactNode[] = [];

  for (const node of nodes) {
    if (node.depth === 1) direct.push(node);
    else if (node.depth === 2) indirect.push(node);
    else transitive.push(node);
  }

  return { direct, indirect, transitive };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SQL recursive CTEs for graph traversal | JS BFS on in-memory adjacency lists | Phase 23 (2026-03-09) | 200-1000x faster, enables complex traversal logic like mechanism filtering |
| `queryDependencies()` for upstream/downstream | `bfsDownstream` / `bfsUpstream` on `ServiceGraph` | Phase 23/24 | Cleaner separation, richer results |
| Generic `formatResponse` halving | Domain-specific compact formatters | Phase 24 | Impact can preserve high-severity data while fitting 4KB |

## Open Questions

1. **Edge collection strategy for multi-mechanism reporting**
   - What we know: The CONTEXT says "report ALL edges to an affected service." BFS visits each node once.
   - What's unclear: Whether to collect edges during BFS (updating visited nodes) or in a post-BFS pass.
   - Recommendation: Post-BFS pass is simpler and more correct. After BFS determines which nodes are affected, iterate affected nodes and collect all their forward edges that point into the subgraph. This naturally captures all mechanisms without BFS complexity.

2. **Whether bfsUpstream takes mechanism filter directly**
   - What we know: CONTEXT leaves this to Claude's discretion.
   - Recommendation: YES, bfsUpstream should accept `mechanismFilter?: string` directly. Filtering during traversal is the locked decision — doing it inside BFS is the natural place. The impact module doesn't need to re-implement BFS filtering.

3. **Whether MCP compact mode should be a separate function or a mode flag**
   - What we know: CLI always outputs verbose, MCP always outputs compact.
   - Recommendation: Two separate format functions — `formatImpactVerbose(result)` for CLI, `formatImpactCompact(result)` for MCP. Simpler than mode flags.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest, via `vitest run`) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/search/graph.test.ts tests/search/impact.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IMPACT-01 | MCP tool `kb_impact` and CLI `kb impact` registered and callable | unit + integration | `npx vitest run tests/mcp/tools.test.ts tests/search/impact.test.ts` | Partially (tools.test.ts exists, impact.test.ts is Wave 0) |
| IMPACT-02 | Results grouped by depth with mechanism labels and confidence | unit | `npx vitest run tests/search/impact.test.ts` | Wave 0 |
| IMPACT-03 | Mechanism filter limits traversal to specific edge types | unit | `npx vitest run tests/search/graph.test.ts tests/search/impact.test.ts` | Partially (graph.test.ts exists) |
| IMPACT-04 | Depth limit caps traversal (default 3) | unit | `npx vitest run tests/search/graph.test.ts` | Partially |
| IMPACT-05 | Severity tiers: direct/indirect/transitive | unit | `npx vitest run tests/search/impact.test.ts` | Wave 0 |
| IMPACT-06 | Stats block with mechanism summary and blast radius score | unit | `npx vitest run tests/search/impact.test.ts` | Wave 0 |
| IMPACT-07 | Compact formatter fits 300+ services in 4KB | unit | `npx vitest run tests/search/impact.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/search/graph.test.ts tests/search/impact.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/search/impact.test.ts` -- covers IMPACT-01 through IMPACT-07 (core logic)
- [ ] `tests/search/graph.test.ts` -- ADD bfsUpstream tests (IMPACT-03, IMPACT-04)
- [ ] `tests/mcp/tools.test.ts` -- ADD kb_impact tool tests (IMPACT-01)
- [ ] `tests/mcp/contracts.test.ts` -- ADD kb_impact contract tests (IMPACT-01)
- [ ] Framework install: not needed -- vitest already configured

## Sources

### Primary (HIGH confidence)
- `src/search/graph.ts` — buildGraph, bfsDownstream, shortestPath implementations (read directly)
- `src/search/types.ts` — GraphEdge, ServiceGraph, BfsNode, GraphHop types (read directly)
- `src/search/edge-utils.ts` — VALID_MECHANISMS, extractConfidence, MECHANISM_FILTER_MAP (read directly)
- `src/mcp/format.ts` — formatResponse, MAX_RESPONSE_CHARS = 4000 (read directly)
- `src/mcp/handler.ts` — wrapToolHandler pattern (read directly)
- `src/mcp/sync.ts` — withAutoSync pattern (read directly)
- `src/mcp/tools/deps.ts` — registerDepsTool pattern (read directly)
- `src/cli/commands/deps.ts` — registerDeps CLI pattern (read directly)
- `src/mcp/server.ts` — createServer tool registration (read directly)
- `src/cli/index.ts` — CLI command registration (read directly)
- `tests/search/graph.test.ts` — test helpers, fixture patterns (read directly)
- `tests/mcp/tools.test.ts` — MCP tool testing patterns (read directly)

### Secondary (MEDIUM confidence)
- None needed — all code is in the local codebase

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries are already in the project, no new dependencies
- Architecture: HIGH — follows exact patterns from Phase 23 and existing MCP/CLI tools
- Pitfalls: HIGH — identified from direct code reading, especially reverse adjacency semantics
- Compact formatter: MEDIUM — the 4KB budget math needs empirical validation with real data

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable internal codebase, no external dependencies)
