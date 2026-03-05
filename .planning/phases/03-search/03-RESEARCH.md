# Phase 3: Search - Research

**Researched:** 2026-03-05
**Domain:** SQLite FTS5 text search, structured entity queries, graph traversal
**Confidence:** HIGH

## Summary

Phase 3 builds a query layer over the existing SQLite database populated by Phase 2. The codebase already has FTS5 infrastructure (`knowledge_fts` virtual table, `search()` function in `src/db/fts.ts`, custom tokenizer for CamelCase/snake_case). The existing `search()` returns `{entityType, entityId, name, description, relevance}` but lacks: (1) joining back to source tables for file paths and repo names, (2) entity-specific structured queries, and (3) graph traversal over the `edges` table for dependency lookups.

The implementation requires no new dependencies. All three query types (text search, entity queries, dependency queries) are pure SQL operations against the existing schema. The `edges` table with `source_type/source_id/target_type/target_id/relationship_type` already supports the graph model needed for dependency traversal. The existing `repos`, `modules`, `events`, `services`, and `files` tables provide all the metadata needed for contextual results.

**Primary recommendation:** Build a `src/search/` module with three focused functions (`searchText`, `findEntity`, `queryDependencies`) that compose SQL queries against existing tables. No schema changes needed.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Text search returns snippet (matching line + ~3-5 lines surrounding context) plus metadata (repo name, file path, entity type)
- Plain text results -- no FTS5 highlight markers; formatting is Phase 4's concern
- Entity queries return structured "entity card" objects: entity name, type, repo, file path, relationship direction, plus relevant code snippet
- Default 20 results per query; caller can override
- Separate functions per query type: `searchText()`, `findEntity()`, `queryDependencies()`
- Text search accepts FTS5 match syntax directly (AND, OR, NOT, phrase matching) -- plain text also works as-is
- Entity queries use name + optional filter object: `findEntity('BookingCreated', {type: 'event', relationship: 'consumers'})`
- All search functions accept optional repo filter to scope results
- Text search supports optional entity type filter to scope FTS to specific content types
- FTS5 built-in BM25 ranking only -- no custom scoring logic
- No cross-function deduplication at search layer; caller handles if needed
- Entity and dependency results sorted grouped by repo, then alphabetical within each group
- Configurable depth: default to direct dependencies (depth 1), accept depth parameter (1, 2, or 'all')
- Results include connection mechanism (Kafka, gRPC, direct call)
- Both directions supported: upstream ('what does X depend on') and downstream ('what depends on X') via direction parameter
- Multi-hop traversals show full path with intermediate steps

### Claude's Discretion
- Internal query building and FTS5 optimization
- Error handling for malformed queries
- Exact snippet extraction algorithm (how to determine the ~3-5 line window)
- Cycle detection in dependency graph traversal

### Deferred Ideas (OUT OF SCOPE)
- None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SRCH-01 | Text search across all indexed content ("booking cancellation") | FTS5 `knowledge_fts` table already indexed; need JOIN to source tables for file path/repo context |
| SRCH-02 | Structured entity queries ("which services consume BookingCreated?") | `edges` table with relationship_type + entity lookups enable this; filter by entity type + relationship direction |
| SRCH-03 | Service dependency queries ("what does payments-service depend on?") | BFS/DFS over `edges` table with configurable depth; cycle detection needed for 'all' depth |
| SRCH-04 | Search results include file paths, repo names, and relevant context | JOINs from entity tables back to `repos` and `files` tables; snippet extraction from description/schema fields |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.0.0 | Already in project -- synchronous SQLite bindings | Already used in Phase 1/2 |
| SQLite FTS5 | built-in | Full-text search | Already initialized in `initializeFts()` |

### Supporting
No new libraries needed. All search functionality is pure SQL + TypeScript over existing infrastructure.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw SQL queries | Query builder (knex/drizzle) | Overkill for 3 focused functions; raw SQL is clearer for FTS5 |
| BFS in SQL (recursive CTE) | In-memory graph traversal | Recursive CTEs work well for depth-limited traversal; simpler than loading full graph |

**Installation:**
```bash
# No new dependencies needed
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  search/
    text.ts          # searchText() - FTS5 text search with context
    entity.ts        # findEntity() - structured entity queries
    dependencies.ts  # queryDependencies() - graph traversal
    types.ts         # shared result types
    index.ts         # re-exports
```

### Pattern 1: FTS5 JOIN for Contextual Results
**What:** The existing `search()` in `fts.ts` returns raw FTS matches without context. Phase 3 wraps this with JOINs back to source entity tables to hydrate results with repo name, file path, etc.
**When to use:** All text search results
**Example:**
```typescript
// Join FTS results to source entity tables for context
const stmt = db.prepare(`
  SELECT
    f.entity_type, f.entity_id, f.name, f.description, rank as relevance,
    r.name as repo_name, r.path as repo_path
  FROM knowledge_fts f
  LEFT JOIN repos r ON (
    (f.entity_type = 'repo' AND f.entity_id = r.id) OR
    (f.entity_type = 'module' AND f.entity_id IN (SELECT id FROM modules WHERE repo_id = r.id)) OR
    (f.entity_type = 'event' AND f.entity_id IN (SELECT id FROM events WHERE repo_id = r.id))
  )
  WHERE knowledge_fts MATCH ?
  ORDER BY rank
  LIMIT ?
`);
```

**Note:** The above subquery-in-JOIN pattern works but may be slow. Better approach: use a CASE/UNION or two-step query (FTS first, then hydrate).

### Pattern 2: Two-Step Query (FTS + Hydration)
**What:** First get FTS matches (fast), then hydrate each result with full context from source tables.
**When to use:** More efficient than complex JOINs for polymorphic entity_type
**Example:**
```typescript
// Step 1: FTS match
const matches = db.prepare(`
  SELECT entity_type, entity_id, name, description, rank as relevance
  FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY rank LIMIT ?
`).all(query, limit);

// Step 2: Hydrate each match
for (const match of matches) {
  switch (match.entity_type) {
    case 'module':
      const mod = db.prepare(`
        SELECT m.*, r.name as repo_name, f.path as file_path
        FROM modules m
        JOIN repos r ON m.repo_id = r.id
        LEFT JOIN files f ON m.file_id = f.id
        WHERE m.id = ?
      `).get(match.entity_id);
      break;
    // ... other types
  }
}
```

### Pattern 3: Recursive CTE for Dependency Traversal
**What:** SQLite supports WITH RECURSIVE for graph traversal over the `edges` table
**When to use:** Dependency queries with depth > 1
**Example:**
```typescript
// Upstream: what does entity X depend on?
const stmt = db.prepare(`
  WITH RECURSIVE deps(source_type, source_id, target_type, target_id, relationship_type, depth, path) AS (
    SELECT source_type, source_id, target_type, target_id, relationship_type, 1,
           source_type || ':' || source_id || '->' || target_type || ':' || target_id
    FROM edges
    WHERE source_type = ? AND source_id = ?
    UNION ALL
    SELECT e.source_type, e.source_id, e.target_type, e.target_id, e.relationship_type, d.depth + 1,
           d.path || '->' || e.target_type || ':' || e.target_id
    FROM edges e
    JOIN deps d ON e.source_type = d.target_type AND e.source_id = d.target_id
    WHERE d.depth < ? AND d.path NOT LIKE '%' || e.target_type || ':' || e.target_id || '%'
  )
  SELECT * FROM deps
`);
```

**Cycle detection:** The `path NOT LIKE` clause prevents revisiting nodes. For 'all' depth, use a reasonable max (e.g., 10) to prevent runaway queries.

### Anti-Patterns to Avoid
- **Loading full graph into memory:** The edges table is small enough for recursive CTEs; don't build an in-memory graph structure
- **Complex multi-JOIN queries:** Polymorphic entity_type makes single-query JOINs ugly; use two-step pattern instead
- **FTS5 highlight():** User decided plain text only; don't use FTS5 auxiliary functions

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Graph traversal | Custom BFS/DFS in TypeScript | SQLite recursive CTE | DB handles cycle detection and depth limits; fewer round trips |
| Text tokenization | Custom search tokenizer | Existing `tokenizeForFts()` | Already handles CamelCase, snake_case, dots |
| BM25 ranking | Custom relevance scoring | FTS5 built-in `rank` | User explicitly decided BM25 only |

**Key insight:** The existing schema + FTS5 do most of the heavy lifting. Phase 3 is a thin query composition layer, not a search engine.

## Common Pitfalls

### Pitfall 1: FTS5 Query Syntax Errors
**What goes wrong:** Users pass invalid FTS5 syntax (unmatched quotes, bare operators) and get SQLite errors
**Why it happens:** FTS5 MATCH syntax is strict; `AND`, `OR`, `NOT` are operators
**How to avoid:** Wrap queries in try/catch; on FTS5 syntax error, fall back to quoting the entire query as a phrase match
**Warning signs:** SQLite "fts5: syntax error" exceptions

### Pitfall 2: Polymorphic Entity Hydration
**What goes wrong:** Trying to JOIN across all entity types in one query produces cartesian products or nulls
**Why it happens:** entity_type is a string discriminator, not a FK; can't JOIN to 4 tables at once
**How to avoid:** Use two-step pattern: FTS match first, then type-switch hydration
**Warning signs:** Results with null repo_name or duplicate entries

### Pitfall 3: Depth-All Dependency Traversal
**What goes wrong:** `depth='all'` on a cyclic graph causes infinite recursion or massive result sets
**Why it happens:** Event relationships can form cycles (service A produces event consumed by service B which produces event consumed by A)
**How to avoid:** Cap recursive CTE at max depth 10; use path-based cycle detection in the CTE
**Warning signs:** Queries taking > 100ms, result counts > 100 for single entity

### Pitfall 4: Edge Direction Confusion
**What goes wrong:** Upstream vs downstream queries return wrong results
**Why it happens:** `edges` stores `source -> target` but meaning depends on relationship_type (produces_event vs consumes_event)
**How to avoid:** Clear documentation of edge semantics; for "what does X depend on" (upstream), follow X's *outgoing* edges; for "what depends on X" (downstream), follow *incoming* edges to X
**Warning signs:** "what does X depend on" returning X's consumers instead of dependencies

### Pitfall 5: Snippet Context Window
**What goes wrong:** Snippets are either too short (no context) or too long (useless)
**Why it happens:** Entity descriptions vary in length; some are one line, some are paragraphs
**How to avoid:** For short descriptions (< 5 lines), return the full description. For longer content, find the match position and extract surrounding lines. Since we're searching FTS name/description fields (not raw file content), most descriptions are already concise.
**Warning signs:** Snippets always returning full content regardless of length

## Code Examples

### Text Search with Context
```typescript
export interface TextSearchResult {
  entityType: EntityType;
  entityId: number;
  name: string;
  snippet: string;
  repoName: string;
  repoPath: string;
  filePath: string | null;
  relevance: number;
}

export function searchText(
  db: Database.Database,
  query: string,
  options: { limit?: number; repoFilter?: string; entityTypeFilter?: EntityType } = {},
): TextSearchResult[] {
  const { limit = 20, repoFilter, entityTypeFilter } = options;
  // ... implementation
}
```

### Entity Query
```typescript
export interface EntityCard {
  name: string;
  type: EntityType;
  repoName: string;
  filePath: string | null;
  description: string | null;
  relationships: {
    direction: 'incoming' | 'outgoing';
    type: string;
    targetName: string;
    targetType: string;
  }[];
}

export function findEntity(
  db: Database.Database,
  name: string,
  filters?: { type?: EntityType; relationship?: string; repo?: string },
): EntityCard[] {
  // ... implementation
}
```

### Dependency Query
```typescript
export interface DependencyResult {
  entity: { name: string; type: string; repoName: string };
  dependencies: DependencyNode[];
}

export interface DependencyNode {
  name: string;
  type: string;
  repoName: string;
  mechanism: string; // 'Kafka consumer', 'gRPC', etc.
  depth: number;
  path: string[]; // full traversal path for multi-hop
}

export function queryDependencies(
  db: Database.Database,
  entityName: string,
  options?: { direction?: 'upstream' | 'downstream'; depth?: number | 'all'; repo?: string },
): DependencyResult {
  // ... implementation
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| FTS3/FTS4 | FTS5 | SQLite 3.9.0 (2015) | Better ranking, tokenization |
| External search (Elasticsearch) | SQLite FTS5 | N/A | Single-file, no infra |

**Deprecated/outdated:**
- FTS3/FTS4: Still work but FTS5 is the recommended replacement
- `offsets()` function: FTS5 uses different API for match positions

## Open Questions

1. **Snippet extraction from indexed content**
   - What we know: FTS5 indexes tokenized name + description fields. The `description` field contains entity summaries, not raw file content.
   - What's unclear: User wants "matching line + ~3-5 lines surrounding context" but entity descriptions are typically 1-3 lines. Raw file content isn't in the DB.
   - Recommendation: Return the full description as the snippet for entities. The snippet concept makes more sense for Phase 4's formatted output. For Phase 3, provide the description + metadata; formatting layer can truncate.

2. **Service entity resolution for dependency queries**
   - What we know: Edge source_type is 'repo' (not 'service') in current `pipeline.ts`. Repos produce/consume events, not services.
   - What's unclear: User says "what does payments-service depend on" but edges link repos to events, not services to events.
   - Recommendation: Treat repo as the service-level entity for dependency queries (repo name ~= service name in microservice architecture). Document this assumption.

## Sources

### Primary (HIGH confidence)
- Existing codebase: `src/db/fts.ts`, `src/db/migrations.ts`, `src/indexer/writer.ts`, `src/indexer/pipeline.ts`
- SQLite FTS5 documentation: https://www.sqlite.org/fts5.html
- better-sqlite3 API: Used throughout Phase 1/2 codebase

### Secondary (MEDIUM confidence)
- SQLite recursive CTE documentation: https://www.sqlite.org/lang_with.html

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all existing infrastructure
- Architecture: HIGH - straightforward query composition over existing schema
- Pitfalls: HIGH - derived from direct analysis of existing code and schema

**Research date:** 2026-03-05
**Valid until:** 2026-04-05 (stable domain, no external dependencies changing)
