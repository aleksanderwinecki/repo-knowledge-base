# Phase 31: Field Edges & Field Impact - Research

**Researched:** 2026-03-10
**Domain:** Cross-service field tracing via graph edges + impact query
**Confidence:** HIGH

## Summary

Phase 31 builds field-level edges and a `kb_field_impact` query on top of the existing fields table (Phase 29) and field search/entity cards (Phase 30). The work has two distinct halves: (1) creating `maps_to` edges between Ecto schema fields and proto message fields that share the same name within the same repo during indexing, and (2) exposing a `kb_field_impact` query that traces a field name across repos via the existing service graph (Kafka/event edges).

The existing `edges` table already supports polymorphic source/target types (`source_type`, `target_type`, `source_id`, `target_id`), and the existing graph.ts BFS machinery operates on repo-level adjacency. The key architectural insight: field edges don't need BFS to traverse field-to-field edges directly. Instead, field edges establish the intra-repo ecto->proto mapping, and then the existing repo-level Kafka/event graph provides the inter-repo hop. The `kb_field_impact` query stitches these together: find all field occurrences, identify which repos produce those fields via proto messages, follow Kafka/event edges to consuming repos, and check whether those consuming repos also have the field.

**Primary recommendation:** Use the existing `edges` table for `maps_to` field edges (source_type='field', target_type='field'), wire edge creation into the pipeline's persist phase, build `analyzeFieldImpact()` as a standalone function in `src/search/field-impact.ts` that combines field DB queries with the service graph, and expose via MCP tool + CLI command following the exact patterns of `kb_impact`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FEDGE-01 | During indexing, when a field name in a proto message matches a field name in an Ecto schema within the same repo, a `maps_to` edge is created between them | Insert into `edges` table with source_type='field', target_type='field' after fields are persisted. Match by field_name + repo_id + parent_type filter. |
| FEDGE-02 | Field-level edges are traversable by existing BFS machinery in graph.ts (bfsDownstream/bfsUpstream work with field edges) | BFS operates on repo-level adjacency. Field edges map to the same repo (intra-repo), so they don't add new graph hops. "Traversable by BFS" means the field edges connect to repo-level edges via the field's repo_id. The field_impact query uses field edges + repo-level BFS together. |
| FIMPACT-01 | `kb_field_impact "<field_name>"` traces a field from its origin schemas through proto/event boundaries to all consuming services | `analyzeFieldImpact()` queries the fields table for all occurrences, groups by repo, follows Kafka/event edges in the service graph to find consuming repos, then checks those consuming repos for matching field names. |
| FIMPACT-02 | Output shows: origin repo + parent schema, proto boundary with topic, consuming repos + their local field info, nullability at each hop | Query result structure includes origin fields (ecto), proto boundary fields with Kafka topics from graph edges, and consumer-side field occurrences with full nullable metadata. |
| FIMPACT-03 | Available as both MCP tool (`kb_field_impact`) and CLI command (`kb field-impact`) | Follow existing patterns: `src/mcp/tools/field-impact.ts` + `src/cli/commands/field-impact.ts`. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | (existing) | Sync SQLite queries for field edge insert + field impact queries | Already used everywhere |
| vitest | (existing) | Test framework | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zod | (existing) | MCP tool schema validation | Field impact MCP tool params |
| @commander-js/extra-typings | (existing) | CLI command definition | `kb field-impact` command |
| @modelcontextprotocol/sdk | (existing) | MCP server tool registration | `kb_field_impact` tool |

No new dependencies needed. All required libraries are already in the project.

## Architecture Patterns

### Recommended Project Structure
```
src/
  indexer/
    writer.ts           # Add insertFieldEdges() after field INSERT in persist functions
    pipeline.ts         # (no changes needed - writer handles edge creation internally)
  search/
    field-impact.ts     # NEW - analyzeFieldImpact() + formatters
    graph.ts            # (no changes needed - BFS already works at repo level)
  mcp/
    tools/
      field-impact.ts   # NEW - registerFieldImpactTool()
    server.ts           # Register new tool
  cli/
    commands/
      field-impact.ts   # NEW - registerFieldImpact()
    index.ts            # Register new command
  types/
    entities.ts         # Add 'maps_to' to RelationshipType union
tests/
  indexer/
    writer.test.ts      # Field edge insertion tests
  search/
    field-impact.test.ts # NEW - field impact query tests
```

### Pattern 1: Field Edge Creation During Indexing

**What:** After fields are inserted into the `fields` table, scan for same-repo ecto/proto field name matches and insert `maps_to` edges.

**When to use:** In both `persistRepoData` and `persistSurgicalData`, after the fields INSERT block.

**Example:**
```typescript
// In writer.ts, after field INSERT loop:
function insertFieldEdges(db: Database.Database, repoId: number): void {
  // Find matching ecto <-> proto field names within the same repo
  const matches = db.prepare(`
    SELECT e.id AS ecto_id, p.id AS proto_id
    FROM fields e
    JOIN fields p ON e.field_name = p.field_name AND e.repo_id = p.repo_id
    WHERE e.repo_id = ?
      AND e.parent_type = 'ecto_schema'
      AND p.parent_type = 'proto_message'
  `).all(repoId) as Array<{ ecto_id: number; proto_id: number }>;

  const insertEdge = db.prepare(
    `INSERT INTO edges (source_type, source_id, target_type, target_id,
                        relationship_type, source_file)
     VALUES ('field', ?, 'field', ?, 'maps_to', NULL)`
  );

  for (const match of matches) {
    insertEdge.run(match.ecto_id, match.proto_id);
  }
}
```

### Pattern 2: Field Impact Query (Stitching Field DB + Service Graph)

**What:** Combines field table queries with the existing service graph to trace a field across repo boundaries.

**Algorithm:**
1. Query `fields` table for all occurrences of the field name, grouped by repo
2. Identify "origin" repos (those with ecto_schema fields) and "boundary" repos (those with proto_message fields)
3. For boundary repos, find Kafka/event edges in the service graph leading to consumer repos
4. For each consumer repo, check if it also has the field name (in its own ecto schemas or proto messages)
5. Assemble the result: origins -> proto boundaries -> consumers, with nullability at each hop

**Example:**
```typescript
export function analyzeFieldImpact(
  db: Database.Database,
  fieldName: string,
): FieldImpactResult {
  // Step 1: Find all field occurrences
  const occurrences = db.prepare(`
    SELECT f.id, f.parent_type, f.parent_name, f.field_type, f.nullable,
           f.source_file, f.repo_id, r.name AS repo_name
    FROM fields f JOIN repos r ON f.repo_id = r.id
    WHERE f.field_name = ?
    ORDER BY r.name, f.parent_type
  `).all(fieldName);

  // Step 2: Build service graph and find consuming repos
  const graph = buildGraph(db);

  // Step 3: For each proto-holding repo, find downstream consumers via kafka/event
  // Step 4: Assemble result with nullability at each hop
  // ...
}
```

### Pattern 3: MCP + CLI Exposure (Matching Existing Conventions)

**What:** Follow the exact patterns from `kb_impact` for both MCP tool and CLI command.

**MCP tool pattern:**
```typescript
// src/mcp/tools/field-impact.ts
export function registerFieldImpactTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_field_impact',
    'Trace a field name from origin schemas through proto/event boundaries to consuming services',
    {
      name: z.string().describe('Field name to trace (e.g., "employee_id")'),
    },
    wrapToolHandler('kb_field_impact', async ({ name }) => {
      const result = analyzeFieldImpact(db, name);
      // Auto-sync, format compact, return JSON
    }),
  );
}
```

**CLI command pattern:**
```typescript
// src/cli/commands/field-impact.ts
export function registerFieldImpact(program: Command) {
  program
    .command('field-impact')
    .description('Trace a field across service boundaries with nullability')
    .argument('<field>', 'field name to trace')
    .option('--timing', 'report timing to stderr', false)
    .action((field, opts) => {
      const result = withDb((db) => analyzeFieldImpact(db, field));
      output(result);
    });
}
```

### Anti-Patterns to Avoid

- **Building a separate field-level graph:** Don't try to make field edges participate in a separate BFS. Fields are intra-repo links; the inter-repo traversal uses the existing repo-level service graph. Building a field-level BFS would be overengineering with no benefit.

- **Schema migration for field edges:** Don't add a new table. The existing `edges` table with its polymorphic source/target types already supports field-to-field edges. Just use `source_type='field'` and `target_type='field'`.

- **Modifying graph.ts buildGraph():** The service graph is repo-level. Field edges are intra-repo (same repo). Adding field edges to the service graph would pollute it with intra-repo self-loops that serve no traversal purpose. Keep the service graph unchanged.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Service graph traversal | Custom field-level BFS | Existing `buildGraph()` + `bfsDownstream()` | Service graph already resolves Kafka/event hops between repos |
| Kafka topic resolution | Manual topic->repo lookup | `graph.forward.get(repoId)` with `mechanism === 'kafka'` | Graph already resolves topic-mediated edges to repo-to-repo adjacency |
| Edge storage | New table | Existing `edges` table with `source_type='field'` | Polymorphic edge table handles this natively |
| MCP tool wiring | Custom error handling | `wrapToolHandler()` from handler.ts | Consistent error wrapping across all tools |
| Auto-sync | Custom staleness check | `withAutoSync()` from sync.ts | Same pattern as all other read tools |

## Common Pitfalls

### Pitfall 1: Field Edge Cleanup on Re-Index
**What goes wrong:** Field edges remain in the `edges` table after a repo is re-indexed, creating duplicates.
**Why it happens:** `clearRepoEntities` deletes edges where `source_type = 'repo'` or `source_type = 'service'`, but not `source_type = 'field'`.
**How to avoid:** Add field edge cleanup to `clearRepoEntities()` and `clearRepoFiles()` in writer.ts. Delete edges where `source_type = 'field'` AND `source_id IN (SELECT id FROM fields WHERE repo_id = ?)`.
**Warning signs:** Duplicate `maps_to` edges after running `kb index` twice.

### Pitfall 2: Field Edge Direction Semantics
**What goes wrong:** Confusing which direction the `maps_to` edge should point (ecto->proto or proto->ecto).
**Why it happens:** FEDGE-01 says "when an Ecto schema field matches a proto message field, a maps_to edge is created between them." The direction matters for traversal clarity.
**How to avoid:** Make the edge point from ecto_schema field (source) to proto_message field (target). This matches the data flow: application schema -> wire format. The `maps_to` relationship reads naturally as "ecto field maps_to proto field."

### Pitfall 3: Multiple Proto Messages Matching Same Ecto Field
**What goes wrong:** An Ecto field `employee_id` might match multiple proto messages in the same repo (e.g., `CreateEmployee`, `UpdateEmployee`).
**Why it happens:** Field name matching is N:M within a repo.
**How to avoid:** Create edges for ALL matches, not just the first. The JOIN query naturally handles this. Don't try to disambiguate -- all matches are valid.

### Pitfall 4: Field Impact With No Proto Boundary
**What goes wrong:** A field exists only in Ecto schemas with no corresponding proto field. The impact query returns origins but no boundaries or consumers.
**Why it happens:** Not all Ecto fields are serialized via proto.
**How to avoid:** Handle gracefully -- return the field occurrences grouped by origin and note that no proto boundary was found. Don't throw an error.

### Pitfall 5: Surgical Re-Index and Field Edges
**What goes wrong:** Surgical re-index deletes fields from changed files but doesn't update field edges involving those fields.
**Why it happens:** Surgical path only clears entities from changed files, not their edges.
**How to avoid:** In the surgical persist path, clear ALL field-to-field edges for the repo (not just changed files) and re-create them. This is cheap since it's a JOIN query within a single repo.

## Code Examples

### Existing Edge Table Schema (for reference)
```sql
-- From migrateToV1
CREATE TABLE edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_type TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  relationship_type TEXT NOT NULL,
  source_file TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- V7 added: metadata TEXT
```

### Existing Fields Table Schema (for reference)
```sql
-- From migrateToV8
CREATE TABLE fields (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  parent_type TEXT NOT NULL,          -- 'ecto_schema' | 'proto_message' | 'graphql_type'
  parent_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL,
  nullable INTEGER NOT NULL DEFAULT 1,
  source_file TEXT,
  module_id INTEGER REFERENCES modules(id) ON DELETE SET NULL,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Field Impact Result Structure
```typescript
interface FieldImpactResult {
  fieldName: string;
  origins: FieldHop[];       // Ecto schema fields (where the data originates)
  boundaries: FieldBoundary[]; // Proto fields + Kafka topic info
  consumers: FieldHop[];     // Fields in consuming repos
  summary: string;
}

interface FieldHop {
  repoName: string;
  parentType: string;
  parentName: string;
  fieldType: string;
  nullable: boolean;
}

interface FieldBoundary {
  repoName: string;
  parentName: string;     // Proto message name
  fieldType: string;
  nullable: boolean;
  topics: string[];        // Kafka topics this proto flows through
}
```

### Registering MCP Tool (pattern from server.ts)
```typescript
// In src/mcp/server.ts, add import + register call:
import { registerFieldImpactTool } from './tools/field-impact.js';
// ...
registerFieldImpactTool(server, db);
```

### Registering CLI Command (pattern from cli/index.ts)
```typescript
// In src/cli/index.ts, add import + register call:
import { registerFieldImpact } from './commands/field-impact.js';
// ...
registerFieldImpact(program);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No field-level data | Field extraction + fields table | Phase 29 (v4.0) | Fields are individually queryable |
| No field search | FTS field indexing + entity cards | Phase 30 (v4.0) | Fields searchable + shared concepts detected |
| Repo-level only graph | Repo-level graph + field edges | Phase 31 (this phase) | Intra-repo ecto->proto mapping bridges field world and graph world |

## Open Questions

1. **GraphQL field edges?**
   - What we know: FEDGE-01 specifies "Ecto schema field name matches proto message field name." No mention of GraphQL.
   - What's unclear: Should GraphQL fields also create `maps_to` edges?
   - Recommendation: Stick to FEDGE-01 scope (ecto <-> proto only). GraphQL field edges can be added later if needed.

2. **Field impact depth/filtering options?**
   - What we know: FIMPACT-01/02/03 don't mention depth or mechanism filtering options.
   - What's unclear: Should `kb_field_impact` accept depth/mechanism filters like `kb_impact`?
   - Recommendation: Start simple -- no filters. The field impact is already scoped by field name. Can add filters in a future phase if useful.

3. **FEDGE-02 interpretation: "BFS machinery works with field edges"**
   - What we know: BFS operates on repo-level graph (forward/reverse maps keyed by repo ID).
   - What's unclear: Success criterion says "bfsDownstream/bfsUpstream work with field edges." Does this mean field edges must be loaded into the service graph, or that the field impact query uses BFS under the hood?
   - Recommendation: Interpret as "field impact query uses the existing BFS machinery to traverse repo-level edges." Field edges are stored in the edges table (queryable), and the field impact function uses `buildGraph()` + BFS for the inter-repo hop. The field edges themselves are queryable via SQL JOIN but don't need to be in the in-memory graph.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest) |
| Config file | vitest.config.ts (at repo root) |
| Quick run command | `npm test -- --run` |
| Full suite command | `npm test -- --run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FEDGE-01 | maps_to edges created between ecto/proto fields with same name in same repo | integration | `npx vitest run tests/indexer/writer.test.ts -t "field edge"` | Exists (add tests) |
| FEDGE-02 | Field impact query uses BFS for inter-repo traversal | unit | `npx vitest run tests/search/field-impact.test.ts -t "BFS"` | Wave 0 |
| FIMPACT-01 | Traces field from origin through proto/event to consumers | unit | `npx vitest run tests/search/field-impact.test.ts -t "trace"` | Wave 0 |
| FIMPACT-02 | Output includes origin, proto boundary with topic, consumers, nullability | unit | `npx vitest run tests/search/field-impact.test.ts -t "output"` | Wave 0 |
| FIMPACT-03 | Available as MCP tool and CLI command | integration | `npx vitest run tests/mcp/tools.test.ts -t "field_impact"` | Exists (add tests) |

### Sampling Rate
- **Per task commit:** `npm test -- --run`
- **Per wave merge:** `npm test -- --run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/search/field-impact.test.ts` -- covers FIMPACT-01, FIMPACT-02, FEDGE-02
- [ ] Field edge tests in `tests/indexer/writer.test.ts` -- covers FEDGE-01
- [ ] MCP tool test in `tests/mcp/tools.test.ts` -- covers FIMPACT-03

## Sources

### Primary (HIGH confidence)
- **Codebase analysis** - Direct reading of all source files:
  - `src/search/graph.ts` - BFS machinery (buildGraph, bfsDownstream, bfsUpstream)
  - `src/search/impact.ts` - analyzeImpact pattern
  - `src/search/entity.ts` - field entity card pattern
  - `src/indexer/writer.ts` - field persistence, edge insertion
  - `src/indexer/pipeline.ts` - field mapping pipeline
  - `src/db/migrations.ts` - V8 fields table, edges table schema
  - `src/mcp/tools/impact.ts` - MCP tool registration pattern
  - `src/cli/commands/impact.ts` - CLI command registration pattern
  - `src/mcp/server.ts` - Tool registration wiring
  - `src/cli/index.ts` - Command registration wiring
  - `src/types/entities.ts` - EntityType, RelationshipType unions

### Secondary (MEDIUM confidence)
- Phase 29/30 SUMMARY files - established patterns for field extraction and search

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all patterns from existing codebase
- Architecture: HIGH - direct extension of existing patterns (edges table, impact query, MCP/CLI wiring)
- Pitfalls: HIGH - identified from codebase analysis (cleanup paths, surgical re-index, N:M matches)

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable internal codebase, no external dependencies)
