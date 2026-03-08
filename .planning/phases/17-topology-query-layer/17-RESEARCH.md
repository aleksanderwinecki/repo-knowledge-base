# Phase 17: Topology Query Layer - Research

**Researched:** 2026-03-08
**Domain:** Graph traversal query generalization, CLI/MCP API extension
**Confidence:** HIGH

## Summary

This phase generalizes the existing event-only `queryDependencies()` BFS traversal to cover all topology edge types introduced in Phase 16 (calls_grpc, calls_http, routes_to, produces_kafka, consumes_kafka). The edges are already persisted in the `edges` table with JSON metadata containing confidence levels. The work is purely query-side: rewriting `findLinkedRepos()` to query all edge types (or filtered by mechanism), extending types with `confidence`, and adding `--mechanism` CLI/MCP params.

The existing code is well-structured for this change. `findLinkedRepos()` currently only follows the event-mediated path (repo -> consumes_event -> event -> produces_event -> repo). The new edge types (calls_grpc, calls_http, routes_to) are direct repo-to-repo edges with no event intermediary, which actually simplifies the traversal. Kafka edges (produces_kafka, consumes_kafka) have no target resolution (target_id=0, target_type='service_name') and need topic-based matching similar to event-based matching.

**Primary recommendation:** Replace `findLinkedRepos()` with a two-path traversal: (1) direct edges (calls_grpc, calls_http, routes_to) that go repo->repo, and (2) mediated edges (produces_event/consumes_event, produces_kafka/consumes_kafka) that go repo->intermediary->repo. Extract confidence from edge metadata JSON. Add mechanism filter at the query level.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- `kb deps <repo>` with no flags returns ALL edge types (gRPC, HTTP, gateway, Kafka, events) -- not just events
- This is a breaking change from event-only output, but it's the whole point of TOPO-05
- No opt-in flag needed -- the old event-only behavior is simply subsumed
- New `--mechanism <type>` flag on CLI, `mechanism` param on MCP tool
- User-facing values: `grpc`, `http`, `gateway`, `kafka`, `event`
- `event` covers both `produces_event` and `consumes_event` relationship types
- `kafka` covers both `produces_kafka` and `consumes_kafka` relationship types
- Multiple values NOT supported (keep it simple; run twice if needed)
- Invalid mechanism values produce a clear error listing valid options
- Add `confidence` field to `DependencyNode` type (string: 'high' | 'medium' | 'low' | null)
- Null confidence for legacy event edges (they predate the confidence system)
- CLI mechanism display: "gRPC [high]", "HTTP [low]", "Kafka consumer [high]", "event (OrderCreated)" -- confidence in brackets after mechanism
- MCP response includes confidence as a structured field (not just in the display string)
- Unresolved targets ARE visible in output, marked with mechanism like "gRPC -> [unresolved: Rpc.Partners.V1.RPCService]"
- Depth > 1 mixes edge types freely: A calls_grpc B, B consumes_event C = valid 2-hop path
- Mechanism filter applies to ALL hops (if --mechanism grpc, only follow gRPC edges at every hop)

### Claude's Discretion
- Exact query implementation strategy (rewrite findLinkedRepos or build new traversal)
- How to handle the MECHANISM_LABELS map expansion
- Whether to refactor queryDependencies into a more generic graph traversal or keep the current BFS with added edge types
- Test strategy and edge case coverage

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TOPO-05 | Dependency query generalization -- traverse all edge types (gRPC, HTTP, gateway, Kafka), not just events | Core rewrite of `findLinkedRepos()` to handle both direct edges (repo->repo) and mediated edges (repo->event->repo, repo->topic->repo). See Architecture Patterns section. |
| TOPO-06 | `--mechanism` filter on `kb deps` to filter by communication type | Add `mechanism` to `DependencyOptions`, CLI option, and MCP zod schema. Map user-facing values to relationship_type sets. See Architecture Patterns. |
| TOPO-07 | Confidence levels on topology edges (high for gRPC/proto, medium for gateway, low for HTTP regex) | Parse from `edges.metadata` JSON column (already stored by Phase 16). Add `confidence` field to `DependencyNode`. See Code Examples. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | (existing) | Database queries | Already used throughout project |
| @commander-js/extra-typings | (existing) | CLI option parsing | Project standard for CLI commands |
| zod | (existing) | MCP param validation | Project standard for MCP tools |
| vitest | (existing) | Test framework | Project standard |

### Supporting
No new libraries required. This phase is purely refactoring existing query logic and extending existing types.

## Architecture Patterns

### Recommended Implementation Strategy

The key insight: the current `findLinkedRepos()` only handles **mediated** edges (repo -> event -> repo). Phase 16 introduced **direct** edges (repo -> repo via calls_grpc, calls_http, routes_to) and **topic-mediated** edges (kafka) that have no resolved target (target_id=0). The new traversal must handle all three patterns.

**Recommendation: Rewrite `findLinkedRepos()` rather than building parallel traversal.**

The BFS structure in `queryDependencies()` is sound -- it handles depth, cycle detection, and path tracking correctly. The only part that needs changing is `findLinkedRepos()`, which should become `findLinkedReposAllEdges()` or similar.

### Pattern 1: Edge Type Classification

```
Direct edges (repo -> repo, no intermediary):
  - calls_grpc (source_type='repo', target_type='repo')
  - calls_http  (source_type='repo', target_type='repo')
  - routes_to   (source_type='repo', target_type='repo')

Event-mediated edges (repo -> event -> repo):
  - produces_event / consumes_event

Unresolved edges (target_type='service_name', target_id=0):
  - calls_grpc, calls_http, routes_to where target couldn't be resolved
  - produces_kafka, consumes_kafka (always unresolved -- topic-based)
```

### Pattern 2: Mechanism Filter Mapping

```typescript
// User-facing mechanism -> relationship_type(s)
const MECHANISM_FILTER_MAP: Record<string, string[]> = {
  grpc:    ['calls_grpc'],
  http:    ['calls_http'],
  gateway: ['routes_to'],
  kafka:   ['produces_kafka', 'consumes_kafka'],
  event:   ['produces_event', 'consumes_event'],
};

const VALID_MECHANISMS = Object.keys(MECHANISM_FILTER_MAP);
```

### Pattern 3: Unified LinkedRepo with Confidence

```typescript
interface LinkedRepo {
  repoId: number;
  repoName: string;
  mechanism: string;           // Human-readable: "gRPC [high]"
  confidence: string | null;   // 'high' | 'medium' | 'low' | null
  eventName: string;           // For mediated edges; empty for direct
  unresolvedTarget?: string;   // For unresolved edges
}
```

### Pattern 4: Direct Edge Query

For upstream (what does X depend on): query edges where source_id = repoId for direct types (calls_grpc, calls_http, routes_to), then resolve target_id to repo name.

For downstream (what depends on X): query edges where target_id = repoId for direct types.

```sql
-- Upstream direct edges
SELECT e.target_id, e.relationship_type, e.metadata, r.name as repo_name
FROM edges e
JOIN repos r ON r.id = e.target_id
WHERE e.source_type = 'repo' AND e.source_id = ?
  AND e.target_type = 'repo'
  AND e.relationship_type IN ('calls_grpc', 'calls_http', 'routes_to')

-- Downstream direct edges (reverse direction)
SELECT e.source_id, e.relationship_type, e.metadata, r.name as repo_name
FROM edges e
JOIN repos r ON r.id = e.source_id
WHERE e.target_type = 'repo' AND e.target_id = ?
  AND e.source_type = 'repo'
  AND e.relationship_type IN ('calls_grpc', 'calls_http', 'routes_to')
```

### Pattern 5: Unresolved Edge Query

Unresolved targets (target_type='service_name', target_id=0) should appear in output. They have no resolved repo, so they become dependency nodes with a special marker. The metadata JSON has `targetName` and `unresolved: 'true'`.

```sql
-- Unresolved edges from this repo
SELECT e.relationship_type, e.metadata
FROM edges e
WHERE e.source_type = 'repo' AND e.source_id = ?
  AND e.target_type = 'service_name'
```

These nodes cannot be traversed further (no target repo ID), so they're leaf nodes in the BFS.

### Pattern 6: Confidence Extraction

Confidence is stored in `edges.metadata` as JSON: `{"confidence": "high", ...}`. Parse with `JSON.parse()` and extract. For legacy event edges (no metadata column or null metadata), confidence is `null`.

```typescript
function extractConfidence(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed.confidence ?? null;
  } catch {
    return null;
  }
}
```

### Pattern 7: MECHANISM_LABELS Expansion

Current incomplete map needs these additions:

```typescript
const MECHANISM_LABELS: Record<string, string> = {
  produces_event: 'Kafka producer',
  consumes_event: 'Kafka consumer',
  calls_grpc: 'gRPC',
  calls_http: 'HTTP',
  routes_to: 'Gateway',
  produces_kafka: 'Kafka producer',
  consumes_kafka: 'Kafka consumer',
  exposes_graphql: 'GraphQL',
};
```

### Pattern 8: Mechanism Display String

Per user decision, format varies by type:
- Direct with confidence: `"gRPC [high]"`, `"HTTP [low]"`, `"Gateway [medium]"`
- Event-mediated: `"event (OrderCreated)"` (confidence null for legacy)
- Kafka: `"Kafka consumer [high]"`, `"Kafka producer [high]"`
- Unresolved: `"gRPC -> [unresolved: Rpc.Partners.V1.RPCService]"`

### Anti-Patterns to Avoid
- **Separate query functions per edge type:** Don't create findGrpcLinks(), findHttpLinks(), etc. Use a single traversal with edge-type-aware queries.
- **Losing the BFS structure:** The existing BFS with cycle detection is correct. Don't replace it with recursive DFS or flatten it.
- **Ignoring unresolved edges:** They carry valuable information about topology gaps. Don't filter them out.
- **Hardcoding relationship types in SQL:** Use parameterized IN clauses with the mechanism filter map, not string concatenation.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON metadata parsing | Custom parser | `JSON.parse()` with try/catch | Edge metadata is simple JSON, no schema validation needed |
| CLI option validation | Manual string checks | Commander's `.choices()` method | Built-in validation with error messages |
| MCP param validation | Manual enum check | Zod's `.enum()` | Already the project pattern |

## Common Pitfalls

### Pitfall 1: Kafka Edges Have No Resolved Target
**What goes wrong:** Treating kafka edges like direct edges and trying to JOIN on target_id.
**Why it happens:** produces_kafka/consumes_kafka edges have target_id=0 and target_type='service_name' because topics aren't entities in the DB.
**How to avoid:** Handle kafka edges separately or in the unresolved path. They can still appear in output as dependencies with topic name from metadata.
**Warning signs:** Empty dependency lists when kafka edges should show up.

### Pitfall 2: Event-Mediated vs Direct Edge Direction Reversal
**What goes wrong:** Upstream/downstream logic is inverted for direct edges vs mediated edges.
**Why it happens:** For events, "upstream" means "I consume events produced by X". For direct edges, "upstream" means "I call X via gRPC/HTTP". The direction semantics differ.
**How to avoid:** For direct edges upstream: source_id = me, follow to target. For direct edges downstream: target_id = me, follow to source. For event edges: existing logic is correct.
**Warning signs:** Direction flag produces opposite results for different edge types.

### Pitfall 3: Multi-Hop With Mixed Edge Types
**What goes wrong:** Mechanism filter breaks multi-hop because filtered edge types don't connect.
**Why it happens:** If filtering by `--mechanism grpc`, we only follow gRPC edges. But the graph might only connect through event edges.
**How to avoid:** This is correct behavior per user decision: "Mechanism filter applies to ALL hops." Users who want mixed-type paths run without the filter.
**Warning signs:** This is expected behavior, not a bug. Tests should verify it.

### Pitfall 4: Path Array Needs Mechanism Context
**What goes wrong:** Path arrays only contain repo/event names, losing mechanism info for multi-hop.
**Why it happens:** Current path is `[repo, event, repo, event, repo]`. With mixed types, intermediate "event" slots need mechanism context.
**How to avoid:** Per user decision, extend path to include mechanism at each hop. Format: `[repo, "gRPC", repo, "event(OrderCreated)", repo]` or similar.
**Warning signs:** Multi-hop path arrays are ambiguous about how services connect.

### Pitfall 5: Breaking Existing Tests
**What goes wrong:** Existing dependency tests assume event-only traversal.
**Why it happens:** The test data only uses produces_event/consumes_event edges with no metadata column.
**How to avoid:** Keep existing tests passing by ensuring null confidence handling. Extend test suite with new edge types rather than rewriting all existing tests.
**Warning signs:** Test failures in existing `dependencies.test.ts`.

## Code Examples

### Complete DependencyNode Type Extension

```typescript
// Source: src/search/types.ts (modification)
export interface DependencyNode {
  name: string;
  type: string;
  repoName: string;
  mechanism: string;
  confidence: string | null;  // NEW: 'high' | 'medium' | 'low' | null
  depth: number;
  path: string[];
}

export interface DependencyOptions {
  direction?: 'upstream' | 'downstream';
  depth?: number | 'all';
  repo?: string;
  mechanism?: string;  // NEW: 'grpc' | 'http' | 'gateway' | 'kafka' | 'event'
}
```

### CLI --mechanism Option

```typescript
// Source: src/cli/commands/deps.ts (modification)
const VALID_MECHANISMS = ['grpc', 'http', 'gateway', 'kafka', 'event'];

program
  .command('deps')
  .description('Query service dependencies')
  .argument('<entity>', 'entity name (e.g., payments-service)')
  .option('--direction <dir>', 'upstream or downstream', 'upstream')
  .option('--mechanism <type>', 'filter by mechanism (grpc, http, gateway, kafka, event)')
  .option('--repo <name>', 'filter by repo name')
  .option('--timing', 'report timing to stderr', false)
  .action((entity, opts) => {
    if (opts.mechanism && !VALID_MECHANISMS.includes(opts.mechanism)) {
      outputError(
        `Invalid mechanism "${opts.mechanism}". Valid: ${VALID_MECHANISMS.join(', ')}`,
        'INVALID_MECHANISM',
      );
    }
    // ... pass mechanism through to queryDependencies
  });
```

### MCP Tool Extension

```typescript
// Source: src/mcp/tools/deps.ts (modification)
{
  name: z.string().describe('Service/repo name'),
  direction: z.enum(['upstream', 'downstream']).optional(),
  depth: z.number().min(1).max(10).optional(),
  mechanism: z.enum(['grpc', 'http', 'gateway', 'kafka', 'event']).optional()
    .describe('Filter by communication mechanism'),
  repo: z.string().optional(),
}
```

### Direct Edge Traversal (upstream direction)

```typescript
// Query direct repo-to-repo edges
function findDirectUpstreamEdges(
  db: Database.Database,
  repoId: number,
  relTypes: string[],
): LinkedRepo[] {
  const placeholders = relTypes.map(() => '?').join(', ');
  const stmt = db.prepare(`
    SELECT e.target_id, e.relationship_type, e.metadata, r.name
    FROM edges e
    JOIN repos r ON r.id = e.target_id
    WHERE e.source_type = 'repo' AND e.source_id = ?
      AND e.target_type = 'repo'
      AND e.relationship_type IN (${placeholders})
  `);
  // ... map to LinkedRepo with confidence extraction
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Event-only BFS | All-edge-type BFS | Phase 17 | `kb deps` shows full communication graph |
| No confidence display | Confidence from metadata JSON | Phase 17 | Users see extraction reliability |
| No mechanism filter | `--mechanism` flag | Phase 17 | Focused queries by communication type |
| MECHANISM_LABELS with 4 entries | Full map with 7 entries | Phase 17 | All edge types have human labels |

## Open Questions

1. **Kafka topic-based matching for multi-hop**
   - What we know: Kafka edges use topics, not repo IDs. Two repos sharing a topic are connected.
   - What's unclear: For multi-hop, should we match producer -> topic -> consumer across repos? This would parallel the event-mediated pattern.
   - Recommendation: Yes -- match by topic name in metadata. produces_kafka with topic X connects to consumes_kafka with topic X in another repo. This is analogous to how produces_event/consumes_event connect through shared events.

2. **Unresolved edges in multi-hop**
   - What we know: Unresolved targets have target_id=0, so BFS can't continue from them.
   - What's unclear: Should unresolved edges appear as leaf nodes in multi-hop results?
   - Recommendation: Yes, include them at depth where found but don't traverse further. The `name` field should use the unresolved target name from metadata.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/search/dependencies.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TOPO-05 | `kb deps` returns all edge types | unit | `npx vitest run tests/search/dependencies.test.ts -t "all edge types"` | Partially (existing file, new tests needed) |
| TOPO-05 | Direct edges (gRPC, HTTP, gateway) appear in results | unit | `npx vitest run tests/search/dependencies.test.ts -t "direct edges"` | No -- Wave 0 |
| TOPO-05 | Unresolved edges visible in output | unit | `npx vitest run tests/search/dependencies.test.ts -t "unresolved"` | No -- Wave 0 |
| TOPO-06 | `--mechanism grpc` filters to gRPC only | unit | `npx vitest run tests/search/dependencies.test.ts -t "mechanism filter"` | No -- Wave 0 |
| TOPO-06 | Invalid mechanism produces error | unit | `npx vitest run tests/search/dependencies.test.ts -t "invalid mechanism"` | No -- Wave 0 |
| TOPO-06 | MCP mechanism param works | unit | `npx vitest run tests/mcp/deps.test.ts` | No file exists |
| TOPO-07 | Confidence field populated from metadata | unit | `npx vitest run tests/search/dependencies.test.ts -t "confidence"` | No -- Wave 0 |
| TOPO-07 | Null confidence for legacy event edges | unit | `npx vitest run tests/search/dependencies.test.ts -t "null confidence"` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/search/dependencies.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test cases in `tests/search/dependencies.test.ts` for direct edges, mechanism filter, confidence, unresolved targets
- [ ] Test data setup: existing beforeEach only creates event edges; needs topology edges with metadata
- [ ] No MCP deps test file exists (`tests/mcp/deps.test.ts`) -- could add or verify via CLI tests + hygiene test

## Sources

### Primary (HIGH confidence)
- Direct source code analysis of `src/search/dependencies.ts` (155 lines, fully read)
- Direct source code analysis of `src/indexer/writer.ts` (insertTopologyEdges, edge metadata format)
- Direct source code analysis of `src/search/types.ts` (DependencyNode, DependencyOptions)
- Direct source code analysis of `src/cli/commands/deps.ts` (CLI command structure)
- Direct source code analysis of `src/mcp/tools/deps.ts` (MCP tool structure)
- Direct source code analysis of `tests/search/dependencies.test.ts` (existing test patterns)
- Direct source code analysis of `tests/indexer/pipeline-topology.test.ts` (edge metadata format verification)
- Direct source code analysis of `src/indexer/topology/types.ts` (TopologyEdge shape)
- Direct source code analysis of `src/types/entities.ts` (RelationshipType enum, Edge interface)
- Database schema from `src/db/migrations.ts` (edges table structure, V7 metadata column)

### Secondary (MEDIUM confidence)
- None needed -- this is entirely internal codebase work

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, purely extending existing code
- Architecture: HIGH -- full source code analysis, clear edge type classification, well-understood patterns
- Pitfalls: HIGH -- identified from actual code structure (kafka target_id=0, direction semantics, existing test data)

**Research date:** 2026-03-08
**Valid until:** No expiry -- internal codebase patterns, no external dependencies
