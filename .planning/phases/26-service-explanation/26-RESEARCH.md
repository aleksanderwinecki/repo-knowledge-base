# Phase 26: Service Explanation - Research

**Researched:** 2026-03-09
**Domain:** SQL aggregation, MCP/CLI tool wiring, structured card formatting
**Confidence:** HIGH

## Summary

Phase 26 is the simplest of the three v3.0 graph tools. Unlike impact (BFS upstream) and trace (shortest path), explain does zero graph traversal -- it aggregates data from existing SQLite tables (repos, modules, events, services, edges, files) using direct SQL queries. The service card is a read-only snapshot answering "what does this service do and who talks to it?"

The codebase has three completed phases (23-25) establishing rock-solid patterns for search function structure, MCP tool registration, CLI command registration, barrel exports, and test organization. Phase 26 follows these patterns exactly, with one key difference: no `buildGraph()` call, no graph.ts dependency -- pure SQL via `db.prepare().all()`.

**Primary recommendation:** Create `src/search/explain.ts` with a single `explainService(db, name)` function that runs ~6 SQL queries, assembles an `ExplainResult` object, and returns it. Wire MCP and CLI using the exact same registration patterns as trace/impact.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Identity section**: service name, description (from repos.description), repo path. No index metadata (last_indexed_commit, default_branch, timestamps).
- **Modules**: counts per module type + top 5 module names per type. Gives shape without overwhelming.
- **Events**: event names grouped by direction (produces/consumes). Names only, no schema_definition.
- **Extra counts**: include file count and gRPC service count for repo size/API surface context.
- **Single format** for both MCP and CLI -- no separate compact formatter.
- Caps control size: top 5 modules per type, ~20 connections per direction with "...and N more" truncation.
- If caps aren't enough for hub services, progressive truncation (Claude's discretion on strategy). Priority: identity > connections > events > modules.
- **Grouped by mechanism**: under talks_to/called_by, group connections by grpc, http, event, etc.
- **No confidence** -- mechanism already implies reliability (consistent with Phase 25 decision).
- **Count-based summary line**: "Talks to 12 services (7 via gRPC, 3 via events, 2 via HTTP). Called by 5 services." Above detailed connections.
- Sort order within mechanism groups: Claude's discretion.
- **Position**: bottom of card as "Next steps" footer.
- **Scope**: graph tools only -- kb_impact, kb_trace, kb_deps.
- **Format**: generic tool names with `<this-service>` placeholder. No specific neighbor names.
- Static vs dynamic hints: Claude's discretion.

### Claude's Discretion
- Truncation/overflow strategy if card exceeds 4KB
- Sort order within mechanism groups (alphabetical recommended)
- Static vs dynamic hints (static recommended -- simpler, predictable)
- ExplainResult type structure and interface design
- Test fixtures and edge case coverage
- CLI output formatting details

### Deferred Ideas (OUT OF SCOPE)
- Fuzzy service name matching -- deferred as cross-cutting feature for all graph tools (noted in Phase 25)
- Rich module details (summaries, schema fields) -- could be a drill-down tool later
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXPLAIN-01 | Agent can get a structured service card via MCP tool `kb_explain` or CLI `kb explain` | MCP registration pattern (registerExplainTool), CLI pattern (registerExplain), barrel exports -- all documented in Architecture Patterns |
| EXPLAIN-02 | Card includes service identity, description, inbound/outbound connections grouped by mechanism | SQL queries for repo lookup + edge aggregation documented in Code Examples; connection grouping pattern with mechanism labels from edge-utils.ts |
| EXPLAIN-03 | Card includes events produced/consumed, entity counts by type, and repo metadata | SQL queries for events (produces_event/consumes_event edges), module/file/service counts documented in Code Examples |
| EXPLAIN-04 | Card includes "talks to" / "called by" summaries and top modules by type | Summary line builder pattern + module aggregation SQL documented in Code Examples |
| EXPLAIN-05 | Card includes next-step hints for agents | Static hints array pattern documented in Architecture Patterns |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.0.0 | Synchronous SQL queries | Already the DB layer; .prepare().all() pattern used everywhere |
| zod | ^4.3.6 | MCP tool schema validation | Used by all MCP tools for input validation |
| @modelcontextprotocol/sdk | ^1.27.1 | MCP server tool registration | server.tool() pattern established in Phases 24-25 |
| @commander-js/extra-typings | ^14.0.0 | CLI command registration | program.command() pattern established throughout |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^3.0.0 | Testing | Unit + integration tests following existing patterns |

### Alternatives Considered
None -- the entire stack is already established. No new dependencies needed.

**Installation:**
No new packages needed. Zero dependency additions.

## Architecture Patterns

### File Structure
```
src/search/explain.ts        # Core logic: explainService() + types
src/mcp/tools/explain.ts     # MCP tool registration
src/cli/commands/explain.ts   # CLI command registration
tests/search/explain.test.ts  # Unit tests for core logic
tests/integration/explain-wiring.test.ts  # MCP + CLI integration tests
```

Plus barrel export additions in:
```
src/search/index.ts           # Export explainService + ExplainResult type
src/mcp/server.ts             # Import + call registerExplainTool
src/cli/index.ts              # Import + call registerExplain
```

### Pattern 1: Search Function (Pure SQL Aggregation)

**What:** A single exported function that takes `(db, serviceName)` and returns a typed result object.
**When to use:** This is how every search feature works in this codebase.

The function should:
1. Look up the repo by exact name (repos table)
2. Throw `Error('Service not found: <name>')` if missing (same pattern as trace/impact)
3. Run aggregation queries for connections, events, modules, files, services
4. Assemble and return the typed result

Key difference from impact/trace: **No `buildGraph(db)` call.** This is pure SQL. The graph module loads ALL edges into memory for BFS -- explain only needs edges for one repo, so direct SQL is more efficient.

### Pattern 2: Connection Grouping by Mechanism

**What:** Query edges where the repo is source (talks_to) and target (called_by), group by normalized mechanism.
**When to use:** For EXPLAIN-02 and EXPLAIN-04.

Connections need two queries:
- **Talks to (outbound):** edges where `source_type='repo' AND source_id=<id>` + edges where repo produces events/kafka consumed by others
- **Called by (inbound):** edges where `target_type='repo' AND target_id=<id>` + edges where repo consumes events/kafka produced by others

Use the normalized mechanism labels from `MECHANISM_LABELS` in edge-utils.ts (grpc, http, gateway, event, kafka). Group service names under each mechanism.

### Pattern 3: MCP Tool Registration

**What:** `registerExplainTool(server, db)` following exact wrapToolHandler pattern.
**When to use:** Standard for all MCP tools.

```typescript
// Pattern from trace.ts and impact.ts:
export function registerExplainTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_explain',
    'Structured overview card for a service: identity, connections, events, modules, and next steps',
    {
      name: z.string().describe('Service/repo name to explain'),
    },
    wrapToolHandler('kb_explain', async ({ name }) => {
      // ... call explainService, optionally withAutoSync
      return JSON.stringify(result);
    }),
  );
}
```

### Pattern 4: CLI Command Registration

**What:** `registerExplain(program)` using `program.command('explain').argument('<service>')`.
**When to use:** Standard for all CLI commands.

```typescript
// Pattern from trace.ts CLI:
export function registerExplain(program: Command) {
  program
    .command('explain')
    .description('Structured overview card for a service')
    .argument('<service>', 'service/repo name to explain')
    .action((service) => {
      try {
        const result = withDb((db) => explainService(db, service));
        output(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outputError(message, 'EXPLAIN_ERROR');
      }
    });
}
```

### Pattern 5: Static Agent Hints

**What:** Fixed array of next-step suggestions using `<this-service>` placeholder.
**When to use:** EXPLAIN-05 -- always appended at bottom of card.

Recommended static hints (simpler than dynamic, no conditional logic):
```typescript
const AGENT_HINTS = [
  'Run kb_impact <this-service> to see blast radius',
  'Run kb_trace <this-service> <other-service> to trace a call path',
  'Run kb_deps <this-service> to see direct dependencies',
];
```

Replace `<this-service>` with actual service name at render time. Static is recommended because:
- No conditional logic to test/maintain
- Predictable output for agents
- All three tools are always relevant for any service

### Anti-Patterns to Avoid
- **Using buildGraph for explain:** The graph module loads ALL edges into memory. Explain only needs edges for one repo -- direct SQL is faster and simpler.
- **Separate compact/verbose formatters:** Context explicitly says single format for both MCP and CLI. Don't create two formatters.
- **Including confidence in connections:** Locked decision -- no confidence field in explain output.
- **Including schema_definition in events:** Locked decision -- event names only.
- **Fuzzy matching:** Out of scope. Exact name match only (throw if not found).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mechanism normalization | Custom label mapping | `MECHANISM_LABELS` from edge-utils.ts | Already handles all edge type to label mappings |
| Edge type filtering | Custom type lists | `DIRECT_EDGE_TYPES`, `EVENT_EDGE_TYPES`, `KAFKA_EDGE_TYPES` from edge-utils.ts | Consistent with all other graph tools |
| MCP error handling | Custom try/catch | `wrapToolHandler` HOF | Handles error envelope format automatically |
| DB lifecycle in CLI | Manual open/close | `withDb()` from cli/db.ts | Ensures cleanup even on exceptions |
| JSON output | Manual stringify | `output()` from cli/output.ts | Consistent pretty-print with newline |

**Key insight:** The explain feature is fundamentally a SQL aggregation wrapper with established wiring patterns. The only new logic is the aggregation queries and result shaping.

## Common Pitfalls

### Pitfall 1: Event Mediation Complexity
**What goes wrong:** Naively querying edges where source/target is the repo misses event-mediated connections. A repo "talks to" another repo via events, but the edge chain is `repo -> event -> repo` (two hops through the events table).
**Why it happens:** Direct edges (calls_grpc, calls_http, routes_to) are repo-to-repo. But event and kafka edges are repo-to-event mediated.
**How to avoid:** Follow the same two-step lookup as `findEventMediatedEdges` and `findKafkaTopicEdges` in dependencies.ts. For outbound: find events this repo produces, then find repos that consume those events. For inbound: find events this repo consumes, then find repos that produce those events. Similarly for kafka topics.
**Warning signs:** Test with a repo that only communicates via events -- if connections are empty, the mediation is broken.

### Pitfall 2: Connection Deduplication
**What goes wrong:** A repo might have multiple edges to the same target via the same mechanism (e.g., two different gRPC stubs calling the same service). This inflates connection counts.
**Why it happens:** Edges represent individual call sites, not unique service-to-service connections.
**How to avoid:** Deduplicate by `(target_repo_name, mechanism)` pair when building the grouped connections. Count unique services, not edge rows.

### Pitfall 3: Truncation Budget Accounting
**What goes wrong:** Card exceeds 4KB for hub services with 50+ connections, causing MCP response issues.
**Why it happens:** No cap on connection count.
**How to avoid:** Apply the ~20 connections per direction cap from CONTEXT.md. Use "...and N more" truncation. Priority order for progressive truncation: identity (never truncate) > connections > events > modules.
**Warning signs:** Test with a hub service fixture that has 30+ connections.

### Pitfall 4: Empty Sections
**What goes wrong:** A newly indexed repo might have no events, no services, or no edges. Returning empty arrays/objects clutters the card.
**Why it happens:** Not all repos have all entity types.
**How to avoid:** Include sections with empty arrays -- agents expect consistent card shape. The summary line naturally handles zeros: "Talks to 0 services. Called by 0 services."

### Pitfall 5: Kafka Topic Matching for Connections
**What goes wrong:** Kafka edges have `target_type='service_name'` and `target_id=0` (unresolved). Can't join directly on target_id.
**Why it happens:** Kafka edges are matched by topic name in metadata, not by FK.
**How to avoid:** Use the same topic-matching pattern as `findKafkaTopicEdges` in dependencies.ts -- extract topic from metadata JSON, find other repos with complementary edge type and same topic.

## Code Examples

### 1. Repo Lookup (Identity Section)
```typescript
// Source: migrations.ts schema + trace.ts pattern
const repo = db.prepare(
  'SELECT id, name, path, description FROM repos WHERE name = ?'
).get(serviceName) as { id: number; name: string; path: string; description: string | null } | undefined;

if (!repo) {
  throw new Error(`Service not found: ${serviceName}`);
}
```

### 2. Module Counts + Top 5 Per Type
```typescript
// Count modules per type
const moduleCounts = db.prepare(
  'SELECT type, COUNT(*) as count FROM modules WHERE repo_id = ? GROUP BY type ORDER BY count DESC'
).all(repo.id) as Array<{ type: string | null; count: number }>;

// Top 5 names per type
const topModules = db.prepare(
  'SELECT type, name FROM modules WHERE repo_id = ? AND type = ? ORDER BY name LIMIT 5'
);
// Call per type from moduleCounts
```

### 3. File Count
```typescript
const fileCount = db.prepare(
  'SELECT COUNT(*) as count FROM files WHERE repo_id = ?'
).get(repo.id) as { count: number };
```

### 4. gRPC Service Count
```typescript
const grpcServiceCount = db.prepare(
  'SELECT COUNT(*) as count FROM services WHERE repo_id = ?'
).get(repo.id) as { count: number };
```

### 5. Direct Outbound Connections (talks_to)
```typescript
// Direct repo-to-repo edges where this repo is source
const directOutbound = db.prepare(`
  SELECT r.name as target_name, e.relationship_type
  FROM edges e
  JOIN repos r ON r.id = e.target_id
  WHERE e.source_type = 'repo' AND e.source_id = ?
    AND e.target_type = 'repo'
    AND e.relationship_type IN ('calls_grpc', 'calls_http', 'routes_to')
`).all(repo.id) as Array<{ target_name: string; relationship_type: string }>;
```

### 6. Event-Mediated Outbound (produces event -> consumed by others)
```typescript
// Find events this repo produces
const producedEvents = db.prepare(`
  SELECT e.target_id as event_id, ev.name as event_name
  FROM edges e
  JOIN events ev ON ev.id = e.target_id
  WHERE e.source_type = 'repo' AND e.source_id = ?
    AND e.relationship_type = 'produces_event'
`).all(repo.id) as Array<{ event_id: number; event_name: string }>;

// For each produced event, find consumers
for (const evt of producedEvents) {
  const consumers = db.prepare(`
    SELECT r.name as repo_name
    FROM edges e
    JOIN repos r ON r.id = e.source_id
    WHERE e.target_type = 'event' AND e.target_id = ?
      AND e.relationship_type = 'consumes_event'
      AND e.source_id != ?
  `).all(evt.event_id, repo.id) as Array<{ repo_name: string }>;
  // Add to talks_to under 'event' mechanism
}
```

### 7. Events Produced/Consumed (for events section)
```typescript
const eventsProduced = db.prepare(`
  SELECT ev.name
  FROM edges e
  JOIN events ev ON ev.id = e.target_id
  WHERE e.source_type = 'repo' AND e.source_id = ?
    AND e.relationship_type = 'produces_event'
`).all(repo.id) as Array<{ name: string }>;

const eventsConsumed = db.prepare(`
  SELECT ev.name
  FROM edges e
  JOIN events ev ON ev.id = e.target_id
  WHERE e.source_type = 'repo' AND e.source_id = ?
    AND e.relationship_type = 'consumes_event'
`).all(repo.id) as Array<{ name: string }>;
```

### 8. Summary Line Builder
```typescript
function buildConnectionSummary(
  talksTo: Map<string, string[]>,
  calledBy: Map<string, string[]>,
): string {
  const outTotal = [...talksTo.values()].reduce((sum, arr) => sum + arr.length, 0);
  const inTotal = [...calledBy.values()].reduce((sum, arr) => sum + arr.length, 0);

  const outBreakdown = [...talksTo.entries()]
    .map(([mech, names]) => `${names.length} via ${mech}`)
    .join(', ');

  const outPart = outTotal > 0
    ? `Talks to ${outTotal} services (${outBreakdown})`
    : 'Talks to 0 services';

  return `${outPart}. Called by ${inTotal} services.`;
}
```

### 9. Recommended ExplainResult Type Structure
```typescript
export interface ExplainResult {
  name: string;
  description: string | null;
  path: string;
  summary: string;  // "Talks to X services (...)  Called by Y services."
  talks_to: Record<string, string[]>;  // mechanism -> [service names]
  called_by: Record<string, string[]>; // mechanism -> [service names]
  events: {
    produces: string[];
    consumes: string[];
  };
  modules: Record<string, { count: number; top: string[] }>;  // type -> {count, top 5 names}
  counts: {
    files: number;
    grpc_services: number;
  };
  hints: string[];
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No explain tool | Structured service cards | Phase 26 (new) | Agents can onboard to a service in one query |
| Manual `kb deps` + `kb search` | Single `kb explain` call | Phase 26 (new) | Reduces multi-tool orchestration to one call |
| Graph module for all connectivity queries | Pure SQL for single-service aggregation | Phase 26 design | Avoids loading full graph into memory for a simple lookup |

**Relevant decisions from prior phases:**
- Phase 24: MCP uses compact formatter, CLI uses verbose -- but EXPLAIN breaks this pattern with a single format for both
- Phase 25: No confidence in trace hops -- EXPLAIN continues this: no confidence in connection lists
- Phase 25: Exact name matching only, throw for not found -- EXPLAIN follows same pattern

## Open Questions

1. **withAutoSync for explain MCP tool**
   - What we know: Impact and trace both use withAutoSync to detect stale repos. Impact only triggers if result has dependents (`allNames.length > 1`). Trace only triggers if hops exist (`result.hops.length > 0`).
   - What's unclear: Should explain trigger auto-sync? The result contains the service itself + its connections, so there are always repo names to check.
   - Recommendation: Use withAutoSync with the service name as the sync target (single repo). Skip the re-query optimization since explain is cheap. This keeps consistency with other tools.

2. **Mechanism label normalization for connection grouping**
   - What we know: edge-utils has `MECHANISM_LABELS` that maps relationship_type to human labels (e.g., 'calls_grpc' -> 'gRPC'). But the graph module uses short forms ('grpc', 'http', 'gateway', 'event', 'kafka').
   - What's unclear: Which label style to use in the grouped connections map keys?
   - Recommendation: Use short normalized forms ('grpc', 'http', 'gateway', 'event', 'kafka') as map keys -- consistent with graph module output and MECHANISM_FILTER_MAP keys. This also matches what agents would pass to `--mechanism` filters.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0.0 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/search/explain.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXPLAIN-01 | MCP tool `kb_explain` registered and callable; CLI `kb explain` registered | integration | `npx vitest run tests/integration/explain-wiring.test.ts -x` | Wave 0 |
| EXPLAIN-02 | Card contains identity, description, grouped connections | unit | `npx vitest run tests/search/explain.test.ts -x` | Wave 0 |
| EXPLAIN-03 | Card contains events produced/consumed, entity counts | unit | `npx vitest run tests/search/explain.test.ts -x` | Wave 0 |
| EXPLAIN-04 | Card contains summary line and top modules per type | unit | `npx vitest run tests/search/explain.test.ts -x` | Wave 0 |
| EXPLAIN-05 | Card contains agent next-step hints | unit | `npx vitest run tests/search/explain.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/search/explain.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/search/explain.test.ts` -- covers EXPLAIN-02, EXPLAIN-03, EXPLAIN-04, EXPLAIN-05
- [ ] `tests/integration/explain-wiring.test.ts` -- covers EXPLAIN-01 (MCP + CLI + barrel exports)

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `src/search/trace.ts`, `src/search/impact.ts`, `src/search/dependencies.ts` -- function structure and patterns
- Codebase inspection: `src/search/edge-utils.ts` -- mechanism labels, type constants, utility functions
- Codebase inspection: `src/mcp/tools/trace.ts`, `src/mcp/tools/impact.ts` -- MCP registration pattern
- Codebase inspection: `src/cli/commands/trace.ts`, `src/cli/commands/impact.ts` -- CLI registration pattern
- Codebase inspection: `src/db/migrations.ts` -- complete table schema (repos, modules, events, services, edges, files)
- Codebase inspection: `src/mcp/server.ts`, `src/cli/index.ts` -- tool/command registration entry points
- Codebase inspection: `tests/search/trace.test.ts`, `tests/integration/trace-wiring.test.ts` -- test patterns

### Secondary (MEDIUM confidence)
- None needed -- all patterns are directly observable in the codebase

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all patterns established in prior phases
- Architecture: HIGH -- file structure and function patterns are carbon copies of trace/impact
- Pitfalls: HIGH -- event mediation complexity well-documented in dependencies.ts, truncation pattern from impact.ts
- SQL queries: HIGH -- table schemas verified against migrations.ts, query patterns match existing code

**Research date:** 2026-03-09
**Valid until:** Indefinite (internal codebase patterns, no external dependency drift)
