# Architecture: v3.0 Graph Intelligence

**Project:** repo-knowledge-base v3.0
**Researched:** 2026-03-09
**Key update:** Hybrid SQL+JS architecture replaces pure CTE approach (benchmarked 200-1000x faster)

## Executive Summary

The three new tools integrate into the existing layered architecture: query logic in `src/search/`, MCP tools in `src/mcp/tools/`, CLI commands in `src/cli/commands/`. The key architectural addition is a new **graph module** (`src/search/graph.ts`) that loads all edges via a single SQL query and builds in-memory adjacency lists for sub-millisecond BFS traversal. No schema migration required -- existing edges table with its indexes is sufficient.

## The Core Decision: SQL Load + JS Traverse

**Why not pure recursive CTEs:** Benchmarked at 150-2700ms on production-scale graph (400 repos, 12K edges). JS BFS on in-memory adjacency list: 0.2-0.6ms. The gap is not marginal -- it's orders of magnitude. SQLite recursive CTEs are append-only, can't prune visited nodes mid-recursion, and have O(n^2) dedup overhead with UNION.

**Why not pure JS (skip SQL entirely):** SQLite remains the storage layer. Edges are persisted, indexed, and filtered there. The graph module loads from SQL, not from raw files.

**Architecture:**
```
SQLite (storage)  -->  Graph Module (in-memory)  -->  Query Functions  -->  MCP/CLI
     6ms load            0.2-0.6ms queries           format + return
```

## Component Map

### New Files

| File | Purpose | Pattern Reference |
|------|---------|-------------------|
| `src/search/graph.ts` | In-memory graph: edge loading, adjacency lists, BFS, shortest path | New module, no direct precedent |
| `src/search/impact.ts` | Downstream BFS, blast radius aggregation | `dependencies.ts` |
| `src/search/trace.ts` | Shortest path with path reconstruction | `dependencies.ts` |
| `src/search/explain.ts` | Multi-table SQL aggregation (no graph traversal) | `entity.ts` |
| `src/mcp/tools/impact.ts` | MCP tool: kb_impact | `deps.ts` |
| `src/mcp/tools/trace.ts` | MCP tool: kb_trace | `deps.ts` |
| `src/mcp/tools/explain.ts` | MCP tool: kb_explain | `entity.ts` |
| `src/cli/commands/impact.ts` | CLI: kb impact | existing CLI pattern |
| `src/cli/commands/trace.ts` | CLI: kb trace | existing CLI pattern |
| `src/cli/commands/explain.ts` | CLI: kb explain | existing CLI pattern |

### Modified Files (additive only)

| File | Change | Risk |
|------|--------|------|
| `src/search/index.ts` | Export new functions + types | Zero breakage |
| `src/mcp/server.ts` | Register 3 new tools | Additive |
| `src/cli/index.ts` | Register 3 new commands | Additive |
| `src/index.ts` | Re-export new search functions | Additive |

### Untouched

Everything else. Critically, `dependencies.ts` stays as-is -- it handles kb_deps. The new tools are complementary.

## Graph Module Design: `src/search/graph.ts`

This is the only genuinely new architectural component. Everything else follows existing patterns.

### Data Structures

```typescript
interface GraphEdge {
  targetId: number;
  targetName: string;
  mechanism: string;          // relationship_type
  confidence: string | null;  // from metadata JSON
  via?: string;               // event name or topic for mediated edges
}

interface ServiceGraph {
  forward: Map<number, GraphEdge[]>;   // source -> targets (for downstream/impact)
  reverse: Map<number, GraphEdge[]>;   // target -> sources (for upstream)
  repoNames: Map<number, string>;      // id -> name lookup
  repoIds: Map<string, number>;        // name -> id lookup
}
```

### Building the Graph

Single SQL query loads all edges:

```typescript
function buildGraph(db: Database.Database): ServiceGraph {
  const graph: ServiceGraph = { forward: new Map(), reverse: new Map(), repoNames: new Map(), repoIds: new Map() };

  // 1. Load repos for name resolution
  const repos = db.prepare('SELECT id, name FROM repos').all();
  for (const r of repos) {
    graph.repoNames.set(r.id, r.name);
    graph.repoIds.set(r.name, r.id);
  }

  // 2. Load direct repo-to-repo edges (~6ms for 12K rows)
  const directEdges = db.prepare(`
    SELECT e.source_id, e.target_id, e.relationship_type, e.metadata
    FROM edges e
    WHERE e.source_type = 'repo' AND e.target_type = 'repo'
  `).all();

  for (const e of directEdges) {
    addEdge(graph, e.source_id, e.target_id, e.relationship_type, e.metadata);
  }

  // 3. Resolve event-mediated edges (repo -> event -> repo)
  resolveEventEdges(db, graph);

  // 4. Resolve kafka-mediated edges (matched by topic name)
  resolveKafkaEdges(db, graph);

  return graph;
}
```

### Event/Kafka Resolution

Port the logic from `findEventMediatedEdges()` and `findKafkaTopicEdges()` in dependencies.ts, but run it once upfront instead of per-hop:

```typescript
function resolveEventEdges(db: Database.Database, graph: ServiceGraph): void {
  // Find pairs: repo A produces_event X, repo B consumes_event X
  const pairs = db.prepare(`
    SELECT e1.source_id as producer_id, e2.source_id as consumer_id,
           ev.name as event_name
    FROM edges e1
    JOIN edges e2 ON e1.target_id = e2.target_id
      AND e1.target_type = 'event' AND e2.target_type = 'event'
    WHERE e1.relationship_type = 'produces_event'
      AND e2.relationship_type = 'consumes_event'
      AND e1.source_type = 'repo' AND e2.source_type = 'repo'
      AND e1.source_id != e2.source_id
  `).all();

  for (const p of pairs) {
    addEdge(graph, p.producer_id, p.consumer_id, 'event', null, p.event_name);
  }
}

function resolveKafkaEdges(db: Database.Database, graph: ServiceGraph): void {
  // Load all kafka edges, group by topic, match producers to consumers
  const kafkaEdges = db.prepare(`
    SELECT source_id, relationship_type, metadata
    FROM edges
    WHERE source_type = 'repo'
      AND relationship_type IN ('produces_kafka', 'consumes_kafka')
  `).all();

  const producers = new Map<string, number[]>();  // topic -> [repo_ids]
  const consumers = new Map<string, number[]>();  // topic -> [repo_ids]

  for (const e of kafkaEdges) {
    const topic = extractMetadataField(e.metadata, 'topic');
    if (!topic) continue;
    const map = e.relationship_type === 'produces_kafka' ? producers : consumers;
    if (!map.has(topic)) map.set(topic, []);
    map.get(topic)!.push(e.source_id);
  }

  // Create edges: each producer -> each consumer for same topic
  for (const [topic, producerIds] of producers) {
    const consumerIds = consumers.get(topic);
    if (!consumerIds) continue;
    for (const pid of producerIds) {
      for (const cid of consumerIds) {
        if (pid !== cid) {
          addEdge(graph, pid, cid, 'kafka', null, topic);
        }
      }
    }
  }
}
```

### BFS Primitives

```typescript
// Downstream impact: what services are affected if this one changes
function bfsDownstream(graph: ServiceGraph, startId: number, maxDepth: number): ImpactNode[] {
  const visited = new Set<number>([startId]);
  const queue: Array<{ id: number; depth: number }> = [{ id: startId, depth: 0 }];
  const results: ImpactNode[] = [];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    // Follow REVERSE edges: who depends on me = who has edges pointing to me
    for (const edge of (graph.reverse.get(id) ?? [])) {
      // edge.targetId here is the SOURCE of the original edge (the dependent)
      if (visited.has(edge.targetId)) continue;
      visited.add(edge.targetId);
      results.push({
        name: edge.targetName,
        repoName: edge.targetName,
        mechanism: edge.mechanism,
        confidence: edge.confidence,
        depth: depth + 1,
        via: edge.via,
      });
      queue.push({ id: edge.targetId, depth: depth + 1 });
    }
  }
  return results;
}

// Shortest path: BFS with parent pointers for reconstruction
function shortestPath(graph: ServiceGraph, startId: number, endId: number, maxDepth: number): TraceHop[] | null {
  if (startId === endId) return [];

  const parent = new Map<number, { from: number; edge: GraphEdge }>();
  const queue: Array<{ id: number; depth: number }> = [{ id: startId, depth: 0 }];
  const visited = new Set<number>([startId]);

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    // Follow edges in BOTH directions for path finding
    const neighbors = [
      ...(graph.forward.get(id) ?? []),
      ...(graph.reverse.get(id) ?? []),
    ];

    for (const edge of neighbors) {
      if (visited.has(edge.targetId)) continue;
      visited.add(edge.targetId);
      parent.set(edge.targetId, { from: id, edge });

      if (edge.targetId === endId) {
        return reconstructPath(parent, startId, endId, graph);
      }
      queue.push({ id: edge.targetId, depth: depth + 1 });
    }
  }
  return null; // No path found
}
```

### Direction Semantics (Critical)

This is the trickiest part. Document it explicitly:

```
Impact analysis: "What breaks if I change service X?"
  = What services DEPEND ON X
  = Who has edges pointing TO X
  = Follow REVERSE adjacency list from X

Flow tracing: "How does a request get from A to B?"
  = Any path between A and B, regardless of direction
  = Follow BOTH forward and reverse edges
  = BFS finds shortest path naturally
```

The existing `dependencies.ts` has the same semantics:
- `direction: 'downstream'` follows edges WHERE target_id = my_id (things that call me)
- `direction: 'upstream'` follows edges WHERE source_id = my_id (things I call)

Impact analysis = downstream = reverse adjacency.

## kb_explain: No Graph Module Needed

kb_explain is pure SQL aggregation -- no traversal, no recursion, no BFS. A CTE is useful here (but non-recursive) for organizing a multi-join query:

```typescript
function queryExplain(db: Database.Database, name: string): ExplainResult | null {
  const repo = db.prepare('SELECT id, name, path, description, default_branch, last_indexed_commit FROM repos WHERE name = ?').get(name);
  if (!repo) return null;

  // Entity counts
  const counts = db.prepare(`
    SELECT 'module' as type, COUNT(*) as count FROM modules WHERE repo_id = ?
    UNION ALL SELECT 'event', COUNT(*) FROM events WHERE repo_id = ?
    UNION ALL SELECT 'service', COUNT(*) FROM services WHERE repo_id = ?
  `).all(repo.id, repo.id, repo.id);

  // Connections (inbound + outbound)
  const connections = db.prepare(`
    SELECT 'outbound' as direction, e.relationship_type, e.metadata,
           COALESCE(r.name, json_extract(e.metadata, '$.targetName'), 'unknown') as peer
    FROM edges e
    LEFT JOIN repos r ON e.target_type = 'repo' AND e.target_id = r.id
    WHERE e.source_type = 'repo' AND e.source_id = ?
    UNION ALL
    SELECT 'inbound', e.relationship_type, e.metadata,
           COALESCE(r.name, 'unknown') as peer
    FROM edges e
    LEFT JOIN repos r ON e.source_type = 'repo' AND e.source_id = r.id
    WHERE e.target_type = 'repo' AND e.target_id = ?
  `).all(repo.id, repo.id);

  // Top modules (limit 10)
  const topModules = db.prepare(`
    SELECT name, type FROM modules WHERE repo_id = ? ORDER BY name LIMIT 10
  `).all(repo.id);

  // Assemble card...
}
```

## Shared Code Extraction

Before building any new module, extract shared utilities from `dependencies.ts`:

| Function/Constant | Current Location | Action |
|-------------------|-----------------|--------|
| `MECHANISM_LABELS` | dependencies.ts (exported) | Import from there, or extract to graph-utils.ts |
| `MECHANISM_FILTER_MAP` | dependencies.ts (exported) | Same |
| `VALID_MECHANISMS` | dependencies.ts (exported) | Same |
| `extractConfidence()` | dependencies.ts (private) | Extract to shared module |
| `extractMetadataField()` | dependencies.ts (private) | Extract to shared module |
| `formatMechanism()` | dependencies.ts (private) | Extract to shared module |

Recommendation: Create `src/search/edge-utils.ts` with the extracted functions. Update `dependencies.ts` to import from there. Run existing tests to confirm zero regressions.

## MCP Tool Pattern

Each tool follows the established pattern from `deps.ts`:

```typescript
export function registerImpactTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_impact',
    'Analyze blast radius: what services are affected if this service changes',
    { name: z.string(), mechanism: z.enum([...]).optional(), depth: z.number().optional() },
    wrapToolHandler('kb_impact', async ({ name, mechanism, depth }) => {
      const result = await withAutoSync(db,
        () => queryImpact(db, name, { mechanism, depth }),
        (r) => [r.source.repoName, ...r.affected.map(a => a.repoName)],
      );
      return formatImpactResponse(result); // Dedicated formatter, NOT generic halving
    }),
  );
}
```

## Module Dependency Diagram

```
                 CLI Layer                          MCP Layer
           +-----------------+              +------------------+
           | cli/commands/   |              | mcp/tools/       |
           |   impact.ts     |              |   impact.ts      |
           |   trace.ts      |              |   trace.ts       |
           |   explain.ts    |              |   explain.ts     |
           +-------+---------+              +--------+---------+
                   |                                 |
                   v                                 v
           +-------+---------+              +--------+---------+
           | cli/db.ts       |              | mcp/handler.ts   |
           | cli/output.ts   |              | mcp/format.ts    |
           +-------+---------+              | mcp/sync.ts      |
                   |                        +--------+---------+
                   +---------------+-----------------+
                                   |
                                   v
                   +---------------+-----------------+
                   | search/                         |
                   |   impact.ts  ----+              |
                   |   trace.ts   ----|-> graph.ts   |
                   |   explain.ts     |  (in-memory  |
                   |   edge-utils.ts  |   adjacency) |
                   |   types.ts       |              |
                   |   dependencies.ts (unchanged)   |
                   +---------------+-----------------+
                                   |
                                   v
                   +---------------+-----------------+
                   | db/                             |
                   |   database.ts (better-sqlite3)  |
                   +---------------+-----------------+
```

## What NOT to Do

1. **Don't add a graph query abstraction layer.** Design doc says "No abstraction layer." Each query function owns its data access.
2. **Don't modify dependencies.ts query logic.** Existing BFS serves kb_deps. Leave it working. Only extract shared utilities.
3. **Don't add schema migrations.** Existing edges table + indexes are sufficient.
4. **Don't use recursive CTEs for traversal.** Use CTEs only for non-recursive aggregation in kb_explain.
5. **Don't prepare statements at module load time.** Follow existing pattern of preparing within function scope.
6. **Don't add a graph caching layer.** 9ms load time. 2-second budget. 200x headroom.

## Sources

All findings from direct codebase inspection:
- `src/search/dependencies.ts`: BFS traversal, edge resolution, direction semantics, private utilities
- `src/search/entity.ts`: entity hydration pattern
- `src/search/types.ts`: existing type definitions
- `src/mcp/tools/deps.ts`: MCP tool registration pattern
- `src/mcp/handler.ts`: wrapToolHandler HOF
- `src/mcp/format.ts`: formatResponse / formatSingleResponse
- `src/mcp/sync.ts`: withAutoSync pattern
- `src/db/migrations.ts`: edges table schema (V1 + V7 metadata)
- `src/db/database.ts`: pragmas, confirms db/ is infrastructure only
- Local benchmarks: SQL CTE vs JS BFS performance (this research cycle)

---
*Research completed: 2026-03-09*
