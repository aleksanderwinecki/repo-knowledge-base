# Technology Stack: v3.0 Graph Intelligence

**Project:** repo-knowledge-base v3.0
**Researched:** 2026-03-09
**Focus:** Stack for recursive CTE-based graph traversal, shortest path, impact analysis over existing edges table (~12K edges, ~400 repos)

## Critical Finding: Hybrid SQL+JS Beats Pure SQL CTEs

**Benchmark results on synthetic graph matching production topology (400 repos, ~12K edges):**

| Strategy | Impact (hub) | Impact (leaf) | Shortest Path | Notes |
|----------|-------------|---------------|---------------|-------|
| UNION recursive CTE | 287ms | 152ms | 414ms | SQLite dedup overhead per iteration |
| UNION ALL + instr() cycle detection | 2726ms | -- | 1456ms | String path grows, instr() scans every row |
| SQL load + JS BFS | **0.6ms** | **0.4ms** | **0.2ms** | 200-1000x faster |
| SQL load overhead | 6.4ms + 2.6ms build | -- | -- | One-time per query batch |

**Recommendation: Load edges from SQLite, traverse in JavaScript.** The adjacency list fits in ~12MB heap. Even with the one-time 9ms SQL load, a full impact analysis completes in under 10ms total vs 150-2700ms for pure SQL CTEs.

**Why CTEs lose at this graph density:** SQLite recursive CTEs are append-only -- they cannot prune previously visited nodes mid-recursion. UNION provides dedup but at O(n^2) cost per iteration. UNION ALL with `instr()` cycle detection concatenates path strings that grow with depth, making each row heavier. With ~30 edges per node average, the working set explodes at depth 3+. JavaScript BFS with a `Set` for visited nodes is O(V+E) with constant-time cycle checks.

**Confidence: HIGH** -- benchmarked locally using better-sqlite3 ^12.0.0 with SQLite 3.51.2 on the exact schema structure from `src/db/migrations.ts`.

## Recommended Stack

### No New Dependencies Required

The entire v3.0 milestone requires zero new npm packages. This is a pure application-logic milestone.

| Technology | Version | Purpose | Status |
|------------|---------|---------|--------|
| better-sqlite3 | ^12.0.0 (existing) | Load edges for in-memory graph, all persistence | No changes |
| TypeScript | ^5.7.0 (existing) | Graph traversal modules, type-safe results | No changes |
| vitest | ^3.0.0 (existing) | Test graph algorithms | No changes |

### SQLite Role: Storage + Filtering, Not Traversal

SQLite remains the data layer. The change is what happens after the query returns.

**Current pattern (dependencies.ts):** BFS loop with per-hop SQL queries
**New pattern:** Single SQL bulk load, then JS BFS/Dijkstra/path-finding

```typescript
// Load all repo-to-repo edges in one query (~6ms for 12K edges)
const edges = db.prepare(`
  SELECT e.source_id, e.target_id, e.relationship_type, e.metadata,
         rs.name as source_name, rt.name as target_name
  FROM edges e
  JOIN repos rs ON rs.id = e.source_id
  JOIN repos rt ON rt.id = e.target_id
  WHERE e.source_type = 'repo' AND e.target_type = 'repo'
`).all();
```

Mechanism filtering, confidence extraction, and name resolution happen during the load, not during traversal.

### Graph Module: Custom In-Memory BFS/Path-Finder

New module: `src/search/graph.ts` -- pure TypeScript, no external graph library.

**Why no graph library:**

| Library | Why Not |
|---------|---------|
| graphlib | Unmaintained (last publish 2019), 290KB, Lodash dependency |
| ngraph.graph | Good but overkill -- we need BFS + shortest path on <500 nodes |
| cytoscape | Browser-focused graph visualization library, massive |
| js-graph-algorithms | Academic, unmaintained |
| graphology | Best option if we needed a library, but 400-node BFS is ~20 lines |

At 400 nodes and 12K edges, a hand-written BFS is trivial, debuggable, and has no dependency risk. A `Map<number, Edge[]>` adjacency list + `Set<number>` visited + array queue is the entire implementation.

### SQLite Features Used (Already Available)

| Feature | Version Required | Status in better-sqlite3 12.x |
|---------|-----------------|-------------------------------|
| Recursive CTEs (`WITH RECURSIVE`) | SQLite 3.8.3+ | Available (SQLite 3.51.2 bundled) |
| `instr()` function | SQLite 3.7.15+ | Available |
| `json_extract()` | SQLite 3.9.0+ | Available |
| MATERIALIZED hint | SQLite 3.35.0+ | Available |
| LIMIT on recursive-select | SQLite 3.34.0+ | Available |
| Compound indexes | Always | Already created (idx_edges_source, idx_edges_target) |

**Recursive CTEs are still useful for `kb_explain`** -- the service explanation card aggregates from multiple tables (repos, entities, edges) without graph traversal. A CTE there is cleaner than multiple separate queries.

### Existing Indexes (Sufficient)

```sql
-- Already exist from V1 migration
CREATE INDEX idx_edges_source ON edges(source_type, source_id);
CREATE INDEX idx_edges_target ON edges(target_type, target_id);
CREATE INDEX idx_edges_relationship ON edges(relationship_type);
```

The bulk load query for graph building uses `source_type = 'repo' AND target_type = 'repo'`, which hits `idx_edges_source` for the source side. The existing indexes are sufficient -- no new indexes needed.

**Optional optimization (defer unless profiling shows need):**
```sql
-- Covering index for the bulk load query
CREATE INDEX idx_edges_repo_to_repo
  ON edges(source_type, target_type, source_id, target_id, relationship_type, metadata)
  WHERE source_type = 'repo' AND target_type = 'repo';
```
This is a partial covering index that would make the bulk load a pure index scan. At 6ms current load time, not worth adding unless we profile and find it's a bottleneck.

## better-sqlite3 Considerations for Graph Queries

### Synchronous API is Actually Perfect Here

better-sqlite3's synchronous `.all()` returns the full result set in one call. For the bulk edge load (~12K rows), this means:
- Single V8 <-> native boundary crossing
- No async overhead or callback chains
- Result array is immediately available for adjacency list construction

### Prepared Statements for Repeated Use

The bulk load query should be a prepared statement stored on the module, not re-prepared per call:

```typescript
// Prepare once at module level or in a factory
const loadEdgesStmt = db.prepare(`
  SELECT e.source_id, e.target_id, e.relationship_type, e.metadata,
         rs.name as source_name, rt.name as target_name
  FROM edges e
  JOIN repos rs ON rs.id = e.source_id
  JOIN repos rt ON rt.id = e.target_id
  WHERE e.source_type = 'repo' AND e.target_type = 'repo'
`);

// Use per query -- preparation cost paid once
const edges = loadEdgesStmt.all();
```

### No Query Timeout / Progress Handler Available

**OMIT_PROGRESS_CALLBACK is compiled into the bundled SQLite** (confirmed via `PRAGMA compile_options`). This means:
- No `sqlite3_progress_handler()` available
- No way to interrupt a long-running recursive CTE mid-execution
- If a pure-SQL recursive CTE hits a pathological graph, it blocks the Node.js thread until completion

This is another reason to prefer JS-side traversal: you control the loop and can add timeout checks, depth limits, or AbortSignal support trivially.

### Memory Considerations

| Data | Size | Notes |
|------|------|-------|
| 12K edge rows loaded | ~2-3MB JS objects | Temporary, GC'd after adjacency list built |
| Adjacency list (forward) | ~5MB | Map<number, Edge[]> |
| Adjacency list (reverse) | ~5MB | Map<number, Edge[]> for upstream queries |
| Visited set (per query) | ~4KB | Set<number> for 400 nodes |
| **Total working set** | ~12MB | Well within Node.js defaults |

For comparison, the database file itself is likely 50-100MB with all entities, FTS, etc. A 12MB in-memory graph is negligible.

## Query Patterns Per Tool

### kb_impact (downstream blast radius)

```
SQL: Bulk load edges (one query)
JS:  BFS from start node, forward adjacency, collect all reachable + depth + mechanism
```

No recursive CTE. The existing `queryDependencies` BFS pattern from `dependencies.ts` is exactly right -- just lift the SQL-per-hop queries into a single bulk load.

### kb_trace (shortest path)

```
SQL: Bulk load edges (same query, potentially cached)
JS:  BFS from source to target, tracking parent pointers for path reconstruction
```

BFS on an unweighted graph naturally finds shortest paths. No Dijkstra needed (all edges have weight 1). Path reconstruction via parent pointer backtracking is O(path_length).

### kb_explain (service summary)

```
SQL: Multi-table aggregation query (repos + entities + edges)
     CTE for structured grouping is appropriate here -- no graph traversal
JS:  Format the result card
```

This is the one tool where a CTE makes sense -- not for recursion, but for organizing a multi-join query cleanly.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Graph traversal | JS BFS on loaded edges | SQLite recursive CTEs | 200-1000x slower (benchmarked). No progress handler for timeout safety. |
| Graph traversal | JS BFS on loaded edges | Neo4j / graph database | Violates local-only constraint. 12K edges is comically small for a graph DB. |
| Graph library | Hand-written BFS | graphology | Adding a dependency for 20 lines of BFS. 400 nodes. |
| Graph library | Hand-written BFS | ngraph.graph | Same reasoning. Dependency weight > implementation weight. |
| Shortest path | BFS (unweighted) | Dijkstra / A* | All edges have equal weight. BFS gives optimal shortest path on unweighted graphs. |
| Edge caching | Load-per-query | In-memory cache with TTL | Premature optimization. 9ms load is well under the 2-second budget. Add caching only if profiling shows repeated queries in a session. |
| Edge loading | Single bulk query | Separate queries per mechanism | The bulk query returns in 6ms. Filtering per mechanism in JS after load is negligible. |

## What NOT to Do

1. **Do NOT add Neo4j, ArangoDB, or any external graph store.** The graph has 400 nodes and 12K edges. It fits in a JavaScript Map.

2. **Do NOT add a graph algorithm library.** BFS is a while loop with a queue and a Set. Shortest path on an unweighted graph IS BFS.

3. **Do NOT use recursive CTEs for impact/trace.** Benchmarked at 150-2700ms vs 0.2-0.6ms for JS BFS. The difference is not marginal -- it's orders of magnitude.

4. **Do NOT add an edge caching layer.** The SQL bulk load takes 9ms. The 2-second query budget gives ~200x headroom. Cache only if profiling shows actual need.

5. **Do NOT change the edges table schema.** The existing schema with `source_type/source_id/target_type/target_id/relationship_type/metadata` is exactly what we need. The graph module just reads it differently.

## Installation

```bash
# No new dependencies. Seriously.
# The entire v3.0 milestone is pure application logic.
```

## SQLite Recursive CTE Reference (for kb_explain and fallback)

Even though JS BFS is the primary strategy, recursive CTEs are useful for `kb_explain` and as documentation. Key syntax verified against SQLite 3.51.2:

### UNION vs UNION ALL in Recursive CTEs

- **UNION**: Automatically deduplicates rows, preventing cycles. Each row is compared against all previously generated rows. Cost: O(n^2) for dedup checking.
- **UNION ALL**: No dedup. Requires manual cycle detection (e.g., `instr(visited_path, node)` or depth limit). Faster per iteration but can explode on cyclic graphs.

**For this graph size: UNION is the safer choice when CTEs are used.** The dedup overhead is acceptable for <500 nodes.

### Depth Control

```sql
WITH RECURSIVE downstream(id, depth) AS (
  SELECT :start_id, 0
  UNION
  SELECT e.target_id, d.depth + 1
  FROM downstream d
  JOIN edges e ON e.source_id = d.id
  WHERE d.depth < :max_depth  -- depth limiter
)
```

The `LIMIT` clause on the recursive-select controls total rows added (not depth). Use `WHERE depth < N` for depth control.

### BFS vs DFS Order

- **BFS (default)**: No ORDER BY on recursive-select. Queue semantics.
- **DFS**: `ORDER BY depth DESC` on recursive-select. Stack semantics.
- **Priority**: `ORDER BY some_cost` for weighted exploration.

For shortest path, BFS order (the default) is correct.

### Event/Kafka Intermediate Node Handling

The edges table has intermediate nodes (events, topics) between repos:
```
repo A --produces_kafka--> topic X (target_type='service_name')
repo B --consumes_kafka--> topic X (target_type='service_name')
```

The graph builder must resolve these during adjacency list construction:
1. Load all edges (including non-repo-to-repo)
2. Match producers to consumers by topic name (from metadata JSON)
3. Create synthetic direct edges: `repo A --kafka:topicX--> repo B`

This is exactly what `findKafkaTopicEdges()` in `dependencies.ts` already does per-hop. The graph builder just does it once for all topics upfront.

## Sources

### Primary (HIGH confidence -- verified via benchmarks and official docs)
- [SQLite WITH clause (recursive CTEs)](https://sqlite.org/lang_with.html) -- official syntax, UNION vs UNION ALL, LIMIT behavior
- [SQLite implementation limits](https://sqlite.org/limits.html) -- MAX_COMPOUND_SELECT=500
- [SQLite Forum: BFS traversal](https://sqlite.org/forum/info/3b309a9765636b79) -- cycle detection patterns, performance discussion
- [SQLite Forum: Shortest path](https://sqlite.org/forum/info/a79ba01a941c29b3) -- path tracking with instr(), LIMIT safety
- Local benchmarks (this research) -- 400 nodes, 9K-12K edges, better-sqlite3 ^12.0.0, SQLite 3.51.2

### Secondary (MEDIUM confidence)
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) -- synchronous API, prepared statements
- [better-sqlite3 interrupt issue #568](https://github.com/JoshuaWise/better-sqlite3/issues/568) -- no sqlite3_interrupt() exposed
- [SQLite Forum: Surprise overhead with recursive queries](https://sqlite.org/forum/info/283c90339da632c617ace6a92715fc4ed7dc9cb81d3a2b24878d6a7ca3f6cab9)

### Confirmed Environment
- SQLite version: 3.51.2 (bundled with better-sqlite3 ^12.0.0)
- Compile flags: OMIT_PROGRESS_CALLBACK (no runtime query interruption), ENABLE_FTS5, MAX_COMPOUND_SELECT=500
- Platform: darwin arm64, Node.js

---
*Research completed: 2026-03-09*
*Ready for roadmap: yes*
