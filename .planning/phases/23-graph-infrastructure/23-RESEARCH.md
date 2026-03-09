# Phase 23: Graph Infrastructure - Research

**Researched:** 2026-03-09
**Domain:** In-memory graph construction and BFS traversal over SQLite-backed service topology
**Confidence:** HIGH

## Summary

The graph module's job is narrower than it first appears. The raw edges table has 13,713 rows, but after filtering to repo-sourced edges and resolving event/kafka intermediaries, the traversable graph is only ~264 edges across 400 nodes. BFS on this is sub-millisecond. The hard part is not traversal -- it's the upfront edge resolution, specifically collapsing the 8,148 `produces_event` and 1,656 `consumes_event` rows into 24 logical repo-to-repo edges without paying a 800ms SQL self-join penalty.

The critical performance finding from production data: resolving event-mediated edges via a SQL JOIN (`produces_event JOIN consumes_event ON target_id`) costs 800ms due to the cartesian product on 9,804 rows. The correct approach is three cheap queries (~1ms each) loading producers, consumers, and event names separately, then resolving in JavaScript via a `Map<eventId, { producers: repoId[], consumers: repoId[] }>`. Kafka topic resolution via `json_extract` JOIN is fast (9ms) and can stay as SQL, but JS resolution is simpler and consistent.

The shared utilities extraction (GRAPH-05) is straightforward -- 8 functions/constants currently private in `dependencies.ts` need to move to `edge-utils.ts`. The existing test suite (dependencies.test.ts, 30+ tests) provides a safety net for this refactor. The graph module itself needs ~120 lines of code: a `buildGraph()` function that executes the bulk load + JS resolution, and two BFS primitives (`bfsDownstream` and `shortestPath`).

**Primary recommendation:** Use three separate SQL queries for edge loading (direct, event-producing, event-consuming) plus one for kafka, resolve all intermediaries in JavaScript, build dual adjacency lists (forward + reverse), expose as pure functions operating on a `ServiceGraph` data structure.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Resolve all event/Kafka two-hop edges upfront during graph build (not lazily during traversal)
- BFS algorithms only see repo->repo edges -- intermediary nodes are transparent
- Collapsed edges preserve the intermediary name in metadata (e.g., `via: OrderCreated`, `via: payment.completed`)
- Multiple edges between the same pair of repos are kept separately (one per mechanism) -- preserves per-mechanism confidence
- Unresolved edges (target_type='service_name') are included as leaf nodes in the graph
- Impact (kb_impact): "what depends on me" = follow reverse edges (services that call/consume from X)
- Trace (kb_trace): treat graph as undirected -- any edge traversable in both directions
- When reporting trace hops, show actual edge direction (who calls whom), not traversal direction
- Graph module builds both forward and reverse adjacency lists
- Fresh graph build per query (no caching) -- 9ms build time, 2-second budget = 200x headroom
- Caching deferred to AGRAPH-06
- dependencies.ts: extract shared utilities only, leave its BFS untouched
- New graph module is additive -- existing kb_deps unaffected
- Graph module gets its own comprehensive test suite (not just E2E via downstream tools)
- Tests use real in-memory SQLite with fixtures (consistent with existing vitest + better-sqlite3 patterns)

### Claude's Discretion
- Class vs standalone functions for graph module API
- Whether to filter mechanism during graph build vs during traversal
- Two separate adjacency maps vs single map with direction metadata
- Data structure details for adjacency list entries
- Whether to update dependency test imports to edge-utils.ts or rely on re-exports

### Deferred Ideas (OUT OF SCOPE)
- Graph caching layer (AGRAPH-06) -- deferred, 9ms per build is fast enough
- Rewriting kb_deps to use graph module -- evaluate after v3.0 ships
- Architecture rules engine -- separate milestone
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| GRAPH-01 | Graph module builds in-memory forward and reverse adjacency lists from a single bulk SQL query | Bulk load strategy researched with production data (264 edges from 3-4 queries, ~6ms total). JS resolution avoids 800ms SQL JOIN penalty. Dual `Map<repoId, GraphEdge[]>` for forward/reverse. |
| GRAPH-02 | BFS downstream traversal returns all reachable nodes with depth tracking | Standard queue-based BFS with `[repoId, depth]` tuples and `Set<number>` visited. Proven pattern exists in `dependencies.ts` lines 163-224. Sub-millisecond on 264 edges. |
| GRAPH-03 | Shortest path returns ordered hop list between any two services | BFS with parent-pointer reconstruction. Instead of copying full path per queue entry (O(V*path_length) memory), store `parent: Map<repoId, { fromId, edge }>` and reconstruct on completion. O(V+E) time. |
| GRAPH-04 | Event/Kafka intermediate nodes resolved transparently | Three-query approach: load producers (1ms), consumers (1ms), event names (1ms), resolve in JS via Map. Kafka topics resolved similarly via metadata JSON `$.topic`. Collapsed edges carry `via` field. |
| GRAPH-05 | Shared edge utilities extracted into reusable module | 8 items to extract from dependencies.ts: `MECHANISM_LABELS`, `MECHANISM_FILTER_MAP`, `VALID_MECHANISMS`, `DIRECT_EDGE_TYPES`, `EVENT_EDGE_TYPES`, `KAFKA_EDGE_TYPES`, `extractConfidence`, `extractMetadataField`, `formatMechanism`, `buildInClause`, `getAllowedTypes`. Re-export from dependencies.ts for backward compatibility. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.0.0 | Bulk edge loading via synchronous `.all()` | Already in project, zero new dependencies |
| TypeScript | ^5.7.0 | Graph module types and implementation | Already in project |
| vitest | ^3.0.0 | Graph algorithm test suite | Already in project |

### Supporting
No new dependencies. This is pure application logic on top of the existing stack.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom adjacency list | graphlib / graphology | Massive overkill for 264 edges. Libraries add 50KB+ for ~20 lines of Map operations |
| JS event resolution | SQL self-join | SQL JOIN costs 800ms on production data due to cartesian product. JS resolution is <1ms |
| Two Map objects (fwd/rev) | Single bidirectional map | Two maps is clearer, matches direction semantics (impact=reverse, trace=both), trivially simple |

## Architecture Patterns

### Recommended Project Structure
```
src/search/
  edge-utils.ts       # NEW: Shared utilities extracted from dependencies.ts
  graph.ts            # NEW: Graph builder + BFS primitives
  dependencies.ts     # MODIFIED: imports shared utils from edge-utils.ts
  types.ts            # MODIFIED: add graph-related types
  index.ts            # MODIFIED: re-export graph + edge-utils
```

### Pattern 1: Three-Query Bulk Load + JS Resolution
**What:** Instead of one complex SQL query with JOINs, execute 3-4 simple queries and resolve relationships in JavaScript.
**When to use:** When SQL JOINs create expensive cartesian products (event-mediated edges: 8K x 1.6K rows).
**Why:** 800ms SQL JOIN vs <1ms JS resolution on Maps.

```typescript
// Load phase: ~6ms total (3-4 simple queries)
function loadEdges(db: Database.Database): RawEdgeData {
  // 1. Direct repo-to-repo edges (~0.2ms, 168 rows)
  const direct = db.prepare(`
    SELECT source_id, target_id, relationship_type, metadata
    FROM edges
    WHERE source_type = 'repo' AND target_type = 'repo'
  `).all();

  // 2. Event producers: repo -> event (~1ms, deduplicated)
  const producers = db.prepare(`
    SELECT DISTINCT e.source_id as repo_id, e.target_id as event_id, ev.name as event_name
    FROM edges e
    JOIN events ev ON ev.id = e.target_id
    WHERE e.relationship_type = 'produces_event'
  `).all();

  // 3. Event consumers: repo -> event (~1ms, deduplicated)
  const consumers = db.prepare(`
    SELECT DISTINCT e.source_id as repo_id, e.target_id as event_id
    FROM edges e
    WHERE e.relationship_type = 'consumes_event'
  `).all();

  // 4. Kafka edges (~1ms)
  const kafkaProducers = db.prepare(`
    SELECT source_id as repo_id, json_extract(metadata, '$.topic') as topic,
           json_extract(metadata, '$.confidence') as confidence
    FROM edges
    WHERE relationship_type = 'produces_kafka'
      AND json_extract(metadata, '$.topic') IS NOT NULL
  `).all();

  const kafkaConsumers = db.prepare(`
    SELECT source_id as repo_id, json_extract(metadata, '$.topic') as topic,
           json_extract(metadata, '$.confidence') as confidence
    FROM edges
    WHERE relationship_type = 'consumes_kafka'
      AND json_extract(metadata, '$.topic') IS NOT NULL
  `).all();

  return { direct, producers, consumers, kafkaProducers, kafkaConsumers };
}

// Resolution phase: <1ms in JS
function resolveEventEdges(
  producers: ProducerRow[],
  consumers: ConsumerRow[],
): ResolvedEdge[] {
  // Build event_id -> consumer_repo_ids map
  const consumersByEvent = new Map<number, number[]>();
  for (const c of consumers) {
    const list = consumersByEvent.get(c.event_id) ?? [];
    list.push(c.repo_id);
    consumersByEvent.set(c.event_id, list);
  }

  const edges: ResolvedEdge[] = [];
  for (const p of producers) {
    const consumers = consumersByEvent.get(p.event_id);
    if (!consumers) continue;
    for (const consumerRepoId of consumers) {
      if (consumerRepoId === p.repo_id) continue; // skip self-loops
      edges.push({
        fromRepoId: p.repo_id,
        toRepoId: consumerRepoId,
        mechanism: 'event',
        via: p.event_name,
        confidence: null, // Legacy event edges have no confidence
      });
    }
  }
  return edges;
}
```

### Pattern 2: Dual Adjacency Lists
**What:** Build separate forward and reverse `Map<number, GraphEdge[]>` from the same resolved edge set.
**When to use:** When different consumers need different traversal directions (impact=reverse, trace=both).

```typescript
interface GraphEdge {
  targetRepoId: number;  // Who this edge points to (in this direction)
  mechanism: string;     // 'calls_grpc' | 'calls_http' | 'routes_to' | 'event_mediated' | 'kafka_mediated'
  confidence: string | null;
  via: string | null;    // Intermediary name: event name or kafka topic
  relationshipType: string; // Original relationship_type for filtering
}

interface ServiceGraph {
  forward: Map<number, GraphEdge[]>;   // source -> targets (I call them)
  reverse: Map<number, GraphEdge[]>;   // target -> sources (they call me)
  repoNames: Map<number, string>;      // id -> name lookup
  repoIds: Map<string, number>;        // name -> id lookup
}
```

### Pattern 3: BFS with Parent Pointers (for shortest path)
**What:** Standard BFS using `parent: Map<repoId, { fromId, edge }>` instead of copying full path arrays per queue entry.
**When to use:** Shortest path queries (GRAPH-03). Memory-efficient path reconstruction.

```typescript
function shortestPath(
  graph: ServiceGraph,
  fromRepoId: number,
  toRepoId: number,
): GraphHop[] | null {
  if (fromRepoId === toRepoId) return [];

  const parent = new Map<number, { fromId: number; edge: GraphEdge }>();
  const visited = new Set<number>([fromRepoId]);
  const queue: number[] = [fromRepoId];

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Trace treats graph as undirected: check both forward and reverse
    const neighbors = [
      ...(graph.forward.get(current) ?? []),
      ...(graph.reverse.get(current) ?? []).map(e => ({
        ...e,
        targetRepoId: /* the source of this reverse edge */
      })),
    ];

    for (const edge of neighbors) {
      if (visited.has(edge.targetRepoId)) continue;
      visited.add(edge.targetRepoId);
      parent.set(edge.targetRepoId, { fromId: current, edge });

      if (edge.targetRepoId === toRepoId) {
        // Reconstruct path
        return reconstructPath(parent, fromRepoId, toRepoId);
      }
      queue.push(edge.targetRepoId);
    }
  }

  return null; // No path exists
}
```

### Anti-Patterns to Avoid
- **SQL self-join for event resolution:** The `produces_event JOIN consumes_event ON target_id` approach creates a cartesian product costing 800ms on production data. Always load sides separately and resolve in JS.
- **Path array copying in BFS:** Passing `[...currentPath, newNode]` per queue entry is O(V * max_path_length) memory. Use parent pointers and reconstruct once at the end.
- **Single adjacency list with direction flags:** Complicates every traversal operation. Two separate maps are cleaner and match the semantic split (impact=reverse, trace=both).
- **Graph caching:** Premature optimization. Fresh build is ~6-9ms, query budget is 2 seconds. Don't add cache invalidation complexity.
- **Touching dependencies.ts BFS:** The existing BFS in `queryDependencies()` works correctly with its per-hop SQL strategy. Don't rewrite it to use the graph module -- that's deferred post-v3.0.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Mechanism labels | New label map in graph.ts | Import from edge-utils.ts | Already defined, tested, used by dependencies.ts |
| Confidence extraction | New JSON parser | `extractConfidence()` from edge-utils.ts | Handles null, parse errors, missing fields |
| Metadata field access | Inline JSON.parse | `extractMetadataField()` from edge-utils.ts | Same defensive parsing logic |
| Mechanism formatting | Custom string builder | `formatMechanism()` from edge-utils.ts | Handles all edge cases: unresolved, events, confidence |
| Graph library | graphlib/graphology import | `Map<number, GraphEdge[]>` | 264 edges. A Map is the graph library. |

**Key insight:** The entire graph module is ~120 lines of code operating on standard Maps. The complexity is in the edge resolution logic (porting from dependencies.ts), not in graph data structures.

## Common Pitfalls

### Pitfall 1: Event Resolution Cartesian Product
**What goes wrong:** SQL JOIN on `produces_event` and `consumes_event` via `target_id` produces 800ms query on 9,804 rows.
**Why it happens:** 8,148 producer rows x 1,656 consumer rows create a massive intermediate result set even with DISTINCT.
**How to avoid:** Load producers and consumers as separate arrays, resolve in JS using `Map<eventId, repoId[]>`. Three queries at ~1ms each.
**Warning signs:** `buildGraph()` taking >10ms. Profile the SQL query, not the JS code.

### Pitfall 2: Duplicate Edges from Event Resolution
**What goes wrong:** Same repo pair connected through same event appears multiple times (e.g., repo 14 -> repo 66 via "Envelope" shows 6 times due to 6 `consumes_event` rows from repo 66 to event 38).
**Why it happens:** Multiple edge rows for the same logical relationship in the edges table (different source_files, same event).
**How to avoid:** Use `SELECT DISTINCT source_id, target_id` when loading event edges, or deduplicate in JS before resolution. The CONTEXT says "multiple edges per mechanism" -- but that means per mechanism TYPE, not per duplicate edge of the same mechanism.
**Warning signs:** Event-mediated edge count being much higher than expected (~24 distinct pairs vs hundreds without dedup).

### Pitfall 3: Missing Repo Name Lookups
**What goes wrong:** Graph stores repo IDs but consumers need repo names for display. Forgetting to load the `repos` table means N+1 lookups later.
**Why it happens:** Graph builder focuses on edges, forgets nodes.
**How to avoid:** Load `SELECT id, name FROM repos` (400 rows, <1ms) during graph build. Store as `repoNames: Map<number, string>` and `repoIds: Map<string, number>` in the ServiceGraph.
**Warning signs:** Graph consumers doing individual `db.prepare('SELECT name FROM repos WHERE id = ?')` calls.

### Pitfall 4: Direction Semantics Confusion
**What goes wrong:** Impact query returns upstream dependencies instead of downstream dependants (or vice versa).
**Why it happens:** Edge direction in the edges table: `source_id -> target_id` means "source calls/depends on target". Impact ("what breaks if I change X") needs reverse traversal -- follow edges WHERE `target_id = X` to find sources.
**How to avoid:** Document explicitly: forward adjacency = `source -> [targets]`, reverse adjacency = `target -> [sources]`. Impact uses reverse. Trace uses both.
**Warning signs:** Impact results for a gateway showing services it routes TO (wrong) instead of services that depend on it (right). Actually wait -- a gateway `routes_to` target, so if gateway changes, targets break. Impact for gateway = forward edges. But for a service that is called by others, impact = reverse edges. The semantics depend on edge direction in the DB. Document per-relationship-type.

### Pitfall 5: Unresolved Edges as Traversable Nodes
**What goes wrong:** BFS tries to traverse from an unresolved service_name target, finds no edges, wastes time.
**Why it happens:** Unresolved edges (target_type='service_name') have `target_id=0` -- they don't point to real repos.
**How to avoid:** Unresolved edges are leaf nodes only. Include in adjacency list for display (the locked decision says to) but mark them so BFS doesn't try to traverse from them. Use a separate flag or a different data structure.
**Warning signs:** BFS queue containing repo_id=0.

### Pitfall 6: Kafka Topic Dedup
**What goes wrong:** Same repo pair via same kafka topic appears multiple times.
**Why it happens:** Multiple edge rows for the same topic from different source files.
**How to avoid:** Deduplicate by (from_repo, to_repo, topic) after resolution. Production data shows 72 kafka-resolved edges (with potential duplicates from 413 consumes_kafka + 53 produces_kafka rows).
**Warning signs:** More kafka edges than expected between same pair.

## Code Examples

### Shared Utilities Extraction Pattern
```typescript
// src/search/edge-utils.ts
// Extracted from dependencies.ts -- all functions/constants move here unchanged

export const MECHANISM_LABELS: Record<string, string> = {
  produces_event: 'Kafka producer',
  consumes_event: 'Kafka consumer',
  calls_grpc: 'gRPC',
  calls_http: 'HTTP',
  routes_to: 'Gateway',
  produces_kafka: 'Kafka producer',
  consumes_kafka: 'Kafka consumer',
  exposes_graphql: 'GraphQL',
};

export const MECHANISM_FILTER_MAP: Record<string, string[]> = {
  grpc: ['calls_grpc'],
  http: ['calls_http'],
  gateway: ['routes_to'],
  kafka: ['produces_kafka', 'consumes_kafka'],
  event: ['produces_event', 'consumes_event'],
};

export const VALID_MECHANISMS = Object.keys(MECHANISM_FILTER_MAP);

export const DIRECT_EDGE_TYPES = ['calls_grpc', 'calls_http', 'routes_to'];
export const EVENT_EDGE_TYPES = ['produces_event', 'consumes_event'];
export const KAFKA_EDGE_TYPES = ['produces_kafka', 'consumes_kafka'];

export function extractConfidence(metadata: string | null): string | null { /* unchanged */ }
export function extractMetadataField(metadata: string | null, field: string): string | null { /* unchanged */ }
export function formatMechanism(/* ... */): string { /* unchanged */ }
export function buildInClause(types: string[]): string { /* unchanged */ }
export function getAllowedTypes(mechanism: string | undefined, categoryTypes: string[]): string[] { /* unchanged */ }
```

```typescript
// src/search/dependencies.ts -- modified to import from edge-utils
import {
  MECHANISM_LABELS, MECHANISM_FILTER_MAP, VALID_MECHANISMS,
  DIRECT_EDGE_TYPES, EVENT_EDGE_TYPES, KAFKA_EDGE_TYPES,
  extractConfidence, extractMetadataField, formatMechanism,
  buildInClause, getAllowedTypes,
} from './edge-utils.js';

// Re-export for backward compatibility
export { VALID_MECHANISMS } from './edge-utils.js';

// Rest of queryDependencies() unchanged
```

### Test Fixture Pattern (from existing tests)
```typescript
// Consistent with tests/search/dependencies.test.ts pattern
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { persistRepoData } from '../../src/indexer/writer.js';

let db: Database.Database;
let dbPath: string;

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-graph-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);  // Creates schema, runs migrations

  // Create repos with persistRepoData
  const { repoId: repoAId } = persistRepoData(db, {
    metadata: { name: 'svc-a', path: '/repos/svc-a', ... },
  });

  // Insert edges directly for fine-grained control
  db.prepare('INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES (?, ?, ?, ?, ?, ?)')
    .run('repo', repoAId, 'repo', repoBId, 'calls_grpc', JSON.stringify({ confidence: 'high' }));
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-hop SQL queries (dependencies.ts) | Single bulk load + JS BFS (graph.ts) | Phase 23 | 200-1000x faster for multi-hop traversal |
| SQL self-join for event resolution | Separate loads + JS Map resolution | Phase 23 | 800ms -> <1ms for event edge resolution |
| Private utilities in dependencies.ts | Shared edge-utils.ts | Phase 23 | Eliminates code duplication across graph.ts and dependencies.ts |

**Not changing:**
- `dependencies.ts` BFS logic stays. It works, has 30+ tests, and `kb deps` doesn't need the graph module's performance.
- Edge table schema. No migrations needed.

## Production Data Profile

Verified against the real production database (400 repos, 13,713 edges):

| Metric | Value |
|--------|-------|
| Total repos | 400 |
| Total raw edges | 13,713 |
| Direct repo-to-repo edges | 168 (146 gRPC, 3 HTTP, 19 gateway) |
| Event producer edges | 8,148 (114 repos producing 4,713 distinct events) |
| Event consumer edges | 1,656 (78 repos consuming 743 distinct events) |
| Resolved event edges (deduplicated) | 24 unique repo-to-repo pairs |
| Kafka producer edges | 53 |
| Kafka consumer edges | 413 |
| Resolved kafka edges | 72 unique repo-to-repo pairs |
| Unresolved service_name edges | 117 |
| **Total traversable graph edges** | **264** (168 direct + 24 event + 72 kafka) |
| Repo name/id lookup rows | 400 |

**Performance measurements (sqlite3 CLI on production DB):**
| Operation | Time |
|-----------|------|
| Load direct edges | <0.5ms |
| Load event producers (deduplicated) | ~1ms |
| Load event consumers (deduplicated) | ~1ms |
| Load kafka edges | ~1ms |
| Load repo names | <1ms |
| Event resolution SQL JOIN (DON'T USE) | 800ms |
| JS Map resolution | <0.1ms |
| BFS on 264 edges | <0.5ms |
| **Total expected buildGraph()** | **~6ms** |

## Open Questions

1. **Mechanism filtering: build-time vs traversal-time?**
   - What we know: CONTEXT says Claude's discretion. Build-time filtering means rebuilding the graph per query with different mechanisms. Traversal-time filtering means building once, skipping edges during BFS.
   - What's unclear: Whether mechanism filtering is even needed at the graph module level (it's specified for kb_impact/kb_trace, not the graph primitive).
   - Recommendation: Filter during traversal, not build. Graph build is shared infrastructure; mechanism filtering is a query-level concern. Pass an optional `mechanismFilter` to BFS functions.

2. **Multiple edges between same repo pair**
   - What we know: CONTEXT locks "kept separately, one per mechanism." Production data shows e.g., repo A -> repo B via both gRPC and Kafka.
   - What's unclear: For BFS, a node is visited once (first mechanism wins). Should adjacency list store all edges and let BFS pick the first, or should the graph expose "all mechanisms between A and B" as a separate API?
   - Recommendation: Store all edges in adjacency list. BFS visits node once but records the edge used. Downstream tools (impact/trace) can query "all edges between A and B" from the adjacency list directly for full mechanism reporting.

3. **Reverse edge semantics for different relationship types**
   - What we know: Impact = "what breaks if X changes." For `calls_grpc` (A calls B), if B changes, A breaks = reverse edge. For `routes_to` (gateway routes to B), if B changes, gateway... doesn't break? But users expect to see gateway in impact results.
   - What's unclear: Whether all edge types should be reversible for impact, or if some (like gateway) need special handling.
   - Recommendation: Treat all edges uniformly in the graph module. Impact traversal direction is a Phase 24 concern. The graph module just provides the adjacency lists; consumers decide which direction to traverse.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0.0 |
| Config file | `vitest.config.ts` (exists, `tests/**/*.test.ts` pattern) |
| Quick run command | `npx vitest run tests/search/graph.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRAPH-01 | Builds forward+reverse adjacency lists from bulk SQL | unit | `npx vitest run tests/search/graph.test.ts -t "buildGraph"` | Wave 0 |
| GRAPH-01 | Completes in <10ms for production-scale data | unit | `npx vitest run tests/search/graph.test.ts -t "performance"` | Wave 0 |
| GRAPH-02 | BFS downstream returns reachable nodes with depth | unit | `npx vitest run tests/search/graph.test.ts -t "bfsDownstream"` | Wave 0 |
| GRAPH-03 | Shortest path returns ordered hop list | unit | `npx vitest run tests/search/graph.test.ts -t "shortestPath"` | Wave 0 |
| GRAPH-04 | Event/Kafka intermediaries collapsed transparently | unit | `npx vitest run tests/search/graph.test.ts -t "event\|kafka"` | Wave 0 |
| GRAPH-05 | Shared edge utils importable from edge-utils.ts | unit | `npx vitest run tests/search/edge-utils.test.ts` | Wave 0 |
| GRAPH-05 | dependencies.ts still passes all existing tests | regression | `npx vitest run tests/search/dependencies.test.ts` | Exists (30+ tests) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/search/graph.test.ts tests/search/edge-utils.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/search/graph.test.ts` -- covers GRAPH-01 through GRAPH-04
- [ ] `tests/search/edge-utils.test.ts` -- covers GRAPH-05

*(Existing `tests/search/dependencies.test.ts` covers regression for the refactor)*

## Sources

### Primary (HIGH confidence)
- Production database: `~/.kb/knowledge.db` -- 400 repos, 13,713 edges, all edge type counts and resolution timings measured directly
- Codebase inspection: `src/search/dependencies.ts` -- full BFS implementation, shared utilities, edge resolution patterns
- Codebase inspection: `src/db/migrations.ts` -- edges table schema (V1 + V7 metadata column)
- Codebase inspection: `tests/search/dependencies.test.ts` -- test patterns, fixture setup, 30+ tests as regression safety net
- Codebase inspection: `src/search/types.ts` -- existing type definitions for DependencyResult, DependencyNode, DependencyOptions

### Secondary (MEDIUM confidence)
- Project research summary: `.planning/research/SUMMARY.md` -- JS BFS 200-1000x faster than SQL CTEs, zero new dependencies strategy
- Phase context: `.planning/phases/23-graph-infrastructure/23-CONTEXT.md` -- locked decisions and discretion areas

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, all existing libraries verified in project
- Architecture: HIGH -- all patterns derived from production data measurements and existing code inspection
- Pitfalls: HIGH -- every pitfall verified against real production database (especially the 800ms event JOIN)
- Edge resolution: HIGH -- actual query timings measured, row counts verified, dedup issues identified with specific examples

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- no external dependency changes expected)
