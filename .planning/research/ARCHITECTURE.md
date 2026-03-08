# Architecture: v2.0 Design-Time Intelligence Integration

**Domain:** Service topology, CODEOWNERS, and embedding-based semantic search for existing knowledge base
**Researched:** 2026-03-08
**Confidence:** HIGH (direct codebase analysis of all source files + verified library APIs)

---

## Executive Summary

v2.0 adds three pillars to the existing knowledge base: (1) service topology edges from gRPC clients, HTTP clients, gateway configs, and Kafka wiring; (2) CODEOWNERS parsing for team ownership queries; and (3) embedding-based semantic search via sqlite-vec. The existing architecture is well-suited for all three -- the extractor pattern, edge-based relationship model, and three-phase pipeline all extend naturally. The biggest architectural decision is whether embeddings live in the same SQLite file or a sidecar. Same-file wins: simpler backup/cleanup/migration story, and sqlite-vec is designed exactly for this.

Build order matters: topology first (pure extraction, no new dependencies), then CODEOWNERS (simple parsing, new table), then embeddings last (new dependency on sqlite-vec + @huggingface/transformers, most complex). Topology and CODEOWNERS are independent of each other and could parallelize, but embeddings should come last because it benefits from having all entity data (including topology edges) available for embedding text construction.

---

## 1. Current Architecture (Baseline)

### Schema (V6)

```
repos (id, name, path, description, last_indexed_commit, default_branch, ...)
files (id, repo_id FK, path, language, ...)
modules (id, repo_id FK, file_id FK, name, type, summary, table_name, schema_fields, ...)
services (id, repo_id FK, name, description, service_type, ...)
events (id, repo_id FK, name, schema_definition, source_file, file_id FK, domain, owner_team, ...)
edges (id, source_type, source_id, target_type, target_id, relationship_type, source_file, ...)
learned_facts (id, content, repo, ...)
knowledge_fts (name, description, entity_type UNINDEXED, entity_id UNINDEXED) -- FTS5 virtual table
```

### Pipeline

```
Phase 1 (sequential): discoverRepos -> resolve branches -> snapshot DB state
Phase 2 (parallel):   extractRepoData() per repo (no DB access)
Phase 3 (sequential): persistExtractedData() per repo (DB writes)
Post:                  enrichFromEventCatalog(), FTS optimize, WAL checkpoint
```

### Key Interfaces

```typescript
// Extraction output -- all data from one repo, no DB dependency
interface ExtractedRepoData {
  repoName, repoPath, metadata, mode,
  allModules: ModuleData[],
  events: EventData[],
  services: ServiceData[],
  elixirModules: ElixirModule[],
  protoDefinitions: ProtoDefinition[],
  eventRelationships: EventRelationship[],
  // surgical fields...
}

// Writer interfaces
interface ModuleData { name, type, filePath, summary, tableName?, schemaFields? }
interface EventData { name, schemaDefinition, sourceFile }
interface ServiceData { name, description, serviceType }
interface EdgeData { sourceType, sourceId, targetType, targetId, relationshipType, sourceFile }
```

### Edge Model

Edges are polymorphic: `source_type + source_id -> target_type + target_id` with `relationship_type`. Current relationship types:
- `produces_event` (repo -> event)
- `consumes_event` (repo -> event)
- `calls_grpc` (repo -> service)
- `exposes_graphql` (not yet populated)
- Ecto associations (module -> module): `belongs_to`, `has_many`, `has_one`, `many_to_many`

### Entity Types

`'repo' | 'file' | 'module' | 'service' | 'event' | 'learned_fact'`

---

## 2. Pillar 1: Service Topology Edges

### What Changes

New extractors that produce `EdgeData[]` (or a topology-specific intermediate) representing service-to-service communication. These fit directly into the existing edge model -- no schema changes needed for the core topology concept. The edges table already supports arbitrary `relationship_type` strings.

### New Extractors

| Extractor | Input Files | Output | Relationship Type |
|-----------|------------|--------|-------------------|
| `topology/grpc-clients.ts` | `.ex` files (already parsed by elixir.ts) | repo -> service edges | `calls_grpc` (already exists, but needs enrichment) |
| `topology/http-clients.ts` | `.ex` files with HTTPoison/Tesla/Req patterns | repo -> repo edges | `calls_http` |
| `topology/gateway.ts` | Gateway config files (YAML/JSON/Elixir) | repo -> repo edges | `routes_to` |
| `topology/kafka.ts` | Already partially in events.ts | repo -> event edges | `produces_event` / `consumes_event` (enriched) |

### Integration Points

**Extraction phase** -- topology extractors run during `extractRepoData()`, alongside existing extractors. They receive `(repoPath, branch)` and return structured data. No DB access.

```typescript
// Addition to ExtractedRepoData
interface ExtractedRepoData {
  // ... existing fields ...
  topologyEdges: TopologyEdge[];  // NEW
}

interface TopologyEdge {
  type: 'calls_grpc' | 'calls_http' | 'routes_to' | 'produces_kafka' | 'consumes_kafka';
  sourceFile: string;
  targetService: string;     // service name or repo name
  targetEndpoint?: string;   // optional: specific endpoint/topic
  confidence: 'high' | 'medium' | 'low';  // regex confidence signal
}
```

**Persistence phase** -- `persistExtractedData()` gains a new `insertTopologyEdges()` function, following the same pattern as `insertEventEdges()` and `insertGrpcClientEdges()`. This function resolves target names to entity IDs and inserts into the existing `edges` table.

**No schema migration needed.** The existing `edges` table handles this. The `relationship_type` column accepts any string. The `source_file` column already captures provenance.

### Schema Enhancement (Optional but Recommended)

Add an `edge_metadata` TEXT column to the edges table for storing structured context (endpoint path, topic name, confidence level) without over-normalizing:

```sql
-- Migration V7
ALTER TABLE edges ADD COLUMN metadata TEXT;  -- JSON blob for edge-specific context
```

This avoids needing a separate table per edge type. Example metadata:
- HTTP edge: `{"endpoint": "/api/v1/bookings", "method": "POST", "confidence": "medium"}`
- Kafka edge: `{"topic": "bookings.created.v2", "confidence": "high"}`
- gRPC edge: `{"service": "BookingService", "rpc": "CreateBooking", "confidence": "high"}`

### Extractor Patterns (How They'll Work)

**gRPC clients** -- Already partially extracted via `extractGrpcStubs()` in elixir.ts. Current implementation finds `Stub` references and creates `calls_grpc` edges. Enhancement: also extract the specific RPC methods being called to populate edge metadata.

**HTTP clients** -- Regex patterns on Elixir files:
```elixir
# Pattern 1: Tesla/HTTPoison with base_url config
@base_url "https://booking-service.internal"
HTTPoison.get("#{@base_url}/api/v1/...")

# Pattern 2: module-level client config
defmodule MyApp.BookingClient do
  use Tesla
  plug Tesla.Middleware.BaseUrl, "https://booking-service.internal"

# Pattern 3: direct URL construction
HTTPoison.post(booking_service_url() <> "/api/v1/...")
```

**Gateway routing** -- Parse config files (likely YAML or Elixir config) that map URL paths to upstream services. Pattern depends on gateway technology (Kong, custom Elixir gateway, etc.).

**Kafka wiring** -- Already partially handled by events.ts consumer detection. Enhancement: extract topic names as edge metadata, and link topics to producing/consuming repos more precisely.

### Impact on Dependencies Query

`queryDependencies()` in `search/dependencies.ts` currently only traverses `produces_event`/`consumes_event` edges. It needs to be extended to also traverse `calls_http`, `calls_grpc`, and `routes_to` edges. The `MECHANISM_LABELS` map needs new entries.

The BFS traversal logic stays the same -- it just needs to query more relationship types. The `findLinkedRepos()` function needs generalization:

```typescript
// Current: hardcoded to event-based traversal
const sourceEdgesStmt = direction === 'upstream' ? consumedEdgesStmt : producedEdgesStmt;

// New: generalized to all edge types
// For upstream: find edges where this repo is source (it calls/consumes others)
// For downstream: find edges where this repo is target (others call/consume it)
```

### Impact on Entity Cards

`createRelationshipLookup()` in `search/entity.ts` already returns ALL edges for an entity. No changes needed -- new edge types automatically appear in entity card relationships.

### Impact on MCP/CLI

- `kb_deps` MCP tool: no schema changes, just richer results from the generalized dependency traversal
- `kb deps` CLI command: same -- the output structure is unchanged, just more dependency types
- Consider adding a `--mechanism` filter: `kb deps booking-service --mechanism grpc`

---

## 3. Pillar 2: CODEOWNERS Parsing

### What Changes

New table, new extractor, new search function, new MCP tool, new CLI command.

### Schema Changes (Migration V7 or V8)

```sql
CREATE TABLE IF NOT EXISTS owners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,          -- glob pattern from CODEOWNERS (e.g., "lib/booking/**")
  owner TEXT NOT NULL,            -- @org/team-name or @username or email
  owner_type TEXT NOT NULL,       -- 'team' | 'user' | 'email'
  source_file TEXT NOT NULL,      -- path to CODEOWNERS file
  line_number INTEGER,            -- line in CODEOWNERS for debugging
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_owners_repo ON owners(repo_id);
CREATE INDEX IF NOT EXISTS idx_owners_owner ON owners(owner);
```

**Why a separate table instead of a column on repos/modules/files?** CODEOWNERS is a many-to-many relationship: one pattern can match many files, one file can match multiple patterns (last match wins), and one team owns patterns across many repos. A normalized table preserves this structure and enables queries like "what does team X own across all repos?"

### New Extractor: `src/indexer/codeowners.ts`

```typescript
export interface CodeownersEntry {
  pattern: string;
  owners: string[];          // can have multiple owners per line
  ownerTypes: string[];      // parallel array: 'team' | 'user' | 'email'
  sourceFile: string;        // CODEOWNERS, .github/CODEOWNERS, or docs/CODEOWNERS
  lineNumber: number;
}

/**
 * Parse CODEOWNERS from standard locations.
 * GitHub checks: CODEOWNERS, .github/CODEOWNERS, docs/CODEOWNERS
 * Last-match-wins semantics handled at query time, not extraction time.
 */
export function extractCodeowners(repoPath: string, branch: string): CodeownersEntry[];
```

File format is straightforward: each line is `<pattern> <owner1> <owner2> ...`. Comments start with `#`. Blank lines are ignored. Owner format: `@org/team-name`, `@username`, or `user@example.com`.

### Integration into Pipeline

**ExtractedRepoData gains:**
```typescript
interface ExtractedRepoData {
  // ... existing fields ...
  codeowners: CodeownersEntry[];  // NEW
}
```

**extractRepoData()** calls `extractCodeowners(repoPath, branch)` alongside other extractors. No DB access.

**persistExtractedData()** gains `insertCodeowners()`:
```typescript
function insertCodeowners(db: Database, repoId: number, entries: CodeownersEntry[]): void {
  // Clear existing ownership entries for this repo
  db.prepare('DELETE FROM owners WHERE repo_id = ?').run(repoId);

  const insert = db.prepare(
    'INSERT INTO owners (repo_id, pattern, owner, owner_type, source_file, line_number) VALUES (?, ?, ?, ?, ?, ?)'
  );

  for (const entry of entries) {
    for (let i = 0; i < entry.owners.length; i++) {
      insert.run(repoId, entry.pattern, entry.owners[i], entry.ownerTypes[i], entry.sourceFile, entry.lineNumber);
    }
  }
}
```

**clearRepoEntities()** in writer.ts gains `DELETE FROM owners WHERE repo_id = ?`.

### New Search Function: `src/search/ownership.ts`

```typescript
export interface OwnershipResult {
  owner: string;
  ownerType: string;
  repos: { name: string; patterns: string[] }[];
}

/** Query what a team/user owns across all repos */
export function queryOwnership(db: Database, owner: string): OwnershipResult;

/** Query who owns a specific file path in a repo */
export function queryFileOwner(db: Database, repoName: string, filePath: string): string[];

/** Query all teams/owners for a repo */
export function queryRepoOwners(db: Database, repoName: string): OwnershipResult[];
```

For `queryFileOwner`, implement last-match-wins semantics: fetch all patterns for the repo ordered by line_number, iterate in order, keep track of which patterns match the file path (using gitignore-style glob matching), return the owners from the last matching pattern.

**Glob matching consideration:** CODEOWNERS uses gitignore-style globs. Options:
1. **micromatch** npm package -- mature, widely used, handles gitignore patterns
2. **minimatch** -- simpler, built into npm
3. **Custom implementation** -- the patterns are simple enough (mostly `*`, `**`, directory prefixes)

Recommendation: use **micromatch** (or **picomatch** which is its core). It handles the edge cases of gitignore patterns correctly. Small dependency, well-tested.

### FTS Integration

Index ownership entries into `knowledge_fts` so team names are searchable:
```typescript
indexEntity(db, {
  type: 'owner' as EntityType,  // NEW entity type
  id: ownerId,
  name: entry.owner,
  description: `Owns ${entry.pattern} in ${repoName}`,
  subType: entry.ownerType,
});
```

**EntityType expansion:** Add `'owner'` to the union type in `src/types/entities.ts`.

### New MCP Tool: `kb_owners`

```typescript
server.tool(
  'kb_owners',
  'Query code ownership from CODEOWNERS files',
  {
    owner: z.string().optional().describe('Team or user to query (e.g., @org/team-name)'),
    repo: z.string().optional().describe('Repo name to query owners for'),
    file: z.string().optional().describe('File path to find owner of (requires --repo)'),
  },
  wrapToolHandler('kb_owners', async ({ owner, repo, file }) => {
    // Dispatch to appropriate search function based on params
  }),
);
```

### New CLI Command: `kb owners`

```
kb owners @org/payments-team     # What does this team own?
kb owners --repo booking-service  # Who owns what in this repo?
kb owners --repo booking-service --file lib/booking/context.ex  # Who owns this file?
```

---

## 4. Pillar 3: Embedding-Based Semantic Search

### What Changes

New dependency (sqlite-vec, @huggingface/transformers), new virtual table, new embedding generation step in pipeline, new search function, enhanced MCP/CLI search.

### New Dependencies

| Package | Version | Purpose | Size Impact |
|---------|---------|---------|-------------|
| `sqlite-vec` | ^0.1.6 | Vector storage + KNN search in SQLite | ~2MB native extension |
| `@huggingface/transformers` | ^3.x | Local ONNX embedding generation | ~50MB (includes ONNX runtime) |

**Model:** `Xenova/all-MiniLM-L6-v2` -- 384 dimensions, ~80MB ONNX model (downloaded on first use, cached locally). Fast on CPU, no GPU needed. Good quality for code/technical text.

**Why not an API (OpenAI, etc.)?** Constraints say "local only, no external infrastructure." Transformers.js runs entirely locally via ONNX Runtime.

### Schema Changes (Migration V8 or V9)

```sql
-- Vector embeddings table using sqlite-vec
CREATE VIRTUAL TABLE IF NOT EXISTS vec_entities USING vec0(
  entity_id integer primary key,
  embedding float[384] distance_metric=cosine
);

-- Metadata linking vec_entities back to the knowledge base
-- (vec0 auxiliary columns can't be used in WHERE filters,
--  so we use a regular table for metadata)
CREATE TABLE IF NOT EXISTS entity_embeddings (
  entity_id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,        -- 'repo', 'module', 'event', 'service'
  source_entity_id INTEGER NOT NULL, -- ID in the source table
  text_hash TEXT NOT NULL,           -- hash of embedded text (skip re-embedding unchanged content)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entity_embeddings_type ON entity_embeddings(entity_type);
CREATE INDEX IF NOT EXISTS idx_entity_embeddings_source ON entity_embeddings(entity_type, source_entity_id);
```

**Why a separate metadata table?** sqlite-vec's `vec0` metadata columns support only `=`, `!=`, `>`, `<`, `BETWEEN` -- not `LIKE` or `IN`. A JOIN-based approach gives full SQL flexibility for post-filtering KNN results by entity type, repo, etc.

**Why `text_hash`?** Embedding generation is expensive (~50-100ms per text on CPU). During incremental indexing, skip re-embedding entities whose text hasn't changed. Hash the concatenated name + description, compare to stored hash.

### sqlite-vec Loading

sqlite-vec is a native extension loaded at runtime. Integration with `openDatabase()`:

```typescript
import * as sqliteVec from 'sqlite-vec';

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);

  // Load sqlite-vec extension
  sqliteVec.load(db);

  // ... existing pragmas and schema init ...
}
```

**Platform concern:** sqlite-vec ships prebuilt binaries for darwin-arm64 (Apple Silicon). The npm package `sqlite-vec-darwin-arm64` exists. The `sqlite-vec` package auto-resolves the correct platform binary. This should work, but needs validation -- flagged as the primary risk for this pillar.

### Embedding Generation Pipeline

Embedding generation is **not** part of the main extraction phase. It's a post-indexing step, because:
1. It needs the final persisted entity data (name + description) from DB
2. It's slow (CPU-bound ONNX inference) and shouldn't block the parallel extraction phase
3. It can be incremental (skip unchanged entities via text_hash)

```
Existing pipeline:
  Phase 1 -> Phase 2 (parallel) -> Phase 3 (sequential) -> Post (catalog, FTS optimize)

New pipeline:
  Phase 1 -> Phase 2 (parallel) -> Phase 3 (sequential) -> Post -> Phase 4: Embed
```

**Phase 4: Embedding Generation**
```typescript
async function generateEmbeddings(db: Database.Database): Promise<void> {
  // 1. Lazy-load the embedding model (first call downloads ~80MB model, subsequent calls use cache)
  const embedder = await loadEmbeddingModel();

  // 2. Query all entities that need embedding (new or changed)
  const entities = getEntitiesNeedingEmbedding(db);

  // 3. Batch embed (transformers.js supports batching)
  for (const batch of chunk(entities, 32)) {
    const texts = batch.map(e => buildEmbeddingText(e));
    const embeddings = await embedder(texts);

    // 4. Upsert into vec_entities + entity_embeddings
    const insertVec = db.prepare(
      'INSERT OR REPLACE INTO vec_entities (entity_id, embedding) VALUES (?, ?)'
    );
    const insertMeta = db.prepare(
      'INSERT OR REPLACE INTO entity_embeddings (entity_id, entity_type, source_entity_id, text_hash) VALUES (?, ?, ?, ?)'
    );

    for (let i = 0; i < batch.length; i++) {
      const entityId = batch[i].globalId;
      insertVec.run(entityId, embeddings[i].buffer);
      insertMeta.run(entityId, batch[i].type, batch[i].sourceId, batch[i].textHash);
    }
  }
}
```

**Entity ID mapping:** The vec0 table needs a single integer primary key. Since entities span multiple tables (repos, modules, events, services), we need a global ID scheme. Options:

1. **Synthetic global ID** -- `entity_embeddings.entity_id` is an auto-increment PK, and the table maps back to `(entity_type, source_entity_id)`. This is the cleanest approach.
2. **Offset-based** -- repos at 0-999, modules at 1000-99999, etc. Fragile and ugly.

Recommendation: **Option 1** -- synthetic global ID via the `entity_embeddings` table, which acts as the mapping layer.

### Embedding Text Construction

What text gets embedded for each entity type:

```typescript
function buildEmbeddingText(entity: { type: string; name: string; description?: string; repoName?: string }): string {
  // Combine name + description + context for rich embeddings
  // Use the SAME tokenizeForFts preprocessing to handle CamelCase/snake_case
  const parts = [entity.name];
  if (entity.description) parts.push(entity.description);
  if (entity.repoName) parts.push(`repo: ${entity.repoName}`);
  return parts.join(' ');
}
```

The existing `tokenizeForFts()` function splits CamelCase and snake_case into words. This is valuable for embeddings too -- "BookingCreated" becomes "booking created" which the embedding model understands better.

### New Search Function: `src/search/semantic.ts`

```typescript
export interface SemanticSearchResult {
  entityType: EntityType;
  entityId: number;
  name: string;
  description: string | null;
  repoName: string;
  distance: number;        // cosine distance (0 = identical, 2 = opposite)
  // hydrated fields from entity tables
}

export async function searchSemantic(
  db: Database.Database,
  query: string,
  options?: { limit?: number; entityTypeFilter?: string; repoFilter?: string },
): Promise<SemanticSearchResult[]> {
  // 1. Embed the query text
  const embedder = await loadEmbeddingModel();
  const [queryEmbedding] = await embedder([tokenizeForFts(query)]);

  // 2. KNN search via vec0
  const knnResults = db.prepare(`
    SELECT entity_id, distance
    FROM vec_entities
    WHERE embedding MATCH ?
      AND k = ?
  `).all(queryEmbedding.buffer, (options?.limit ?? 20) * 2);  // over-fetch for post-filtering

  // 3. Join with entity_embeddings for type info
  // 4. Hydrate with entity tables (reuse createEntityHydrator)
  // 5. Apply filters (entity type, repo)
  // 6. Return top N
}
```

**Performance note:** The query embedding step adds ~50-100ms latency per search. For the MCP use case this is acceptable (queries are human-initiated). For CLI, consider caching the model in memory across commands by keeping the process alive or using a warm cache file.

### Enhanced MCP/CLI Search

**Option A (recommended): Unified search with mode flag**
```
kb search "which services handle payments" --semantic
kb_search { query: "...", mode: "semantic" }
```

**Option B: Separate tool**
```
kb semantic "which services handle payments"
kb_semantic { query: "..." }
```

Recommendation: **Option A** for CLI (add `--semantic` flag to existing `kb search`), **Option B** for MCP (separate `kb_semantic` tool). Rationale: MCP tools should be discoverable with clear names. An AI agent choosing between `kb_search` and `kb_semantic` is clearer than a mode flag.

### Handling Model Lifecycle

The embedding model (~80MB) downloads on first use. This needs UX consideration:

1. **First-run download:** `kb index` should print progress: "Downloading embedding model (80MB)... done"
2. **Model cache location:** `~/.cache/huggingface/` (transformers.js default) -- no custom config needed
3. **Offline fallback:** If model can't be downloaded, skip embedding generation with a warning. FTS search still works.
4. **Opt-out:** Environment variable `KB_SKIP_EMBEDDINGS=1` to disable embedding generation entirely (useful in CI, testing)

---

## 5. Schema Migration Strategy

### Migration Ordering

```
V7: Add edges.metadata column (JSON blob for topology edge context)
    Add owners table + indexes for CODEOWNERS
V8: Create vec_entities virtual table (requires sqlite-vec extension)
    Create entity_embeddings metadata table + indexes
```

**Why split?** V7 has no new dependencies -- pure SQL DDL. V8 requires sqlite-vec to be loaded before the virtual table can be created. This separation means:
- Topology + CODEOWNERS features work even if sqlite-vec fails to load
- The schema init code can gracefully handle sqlite-vec absence

### Conditional sqlite-vec Loading

```typescript
// schema.ts
let sqliteVecAvailable = false;

export function initializeSchema(db: Database.Database): void {
  // Run standard migrations (V1-V7)
  // ...

  // Try loading sqlite-vec for V8+
  try {
    sqliteVec.load(db);
    sqliteVecAvailable = true;
    // Run V8 migration if needed
  } catch {
    console.warn('[kb] sqlite-vec not available -- semantic search disabled');
  }

  initializeFts(db);
}

export function isSqliteVecAvailable(): boolean {
  return sqliteVecAvailable;
}
```

---

## 6. Component Map -- New vs Modified

### New Files

| File | Purpose |
|------|---------|
| `src/indexer/topology/grpc-clients.ts` | Extract gRPC client calls from Elixir files |
| `src/indexer/topology/http-clients.ts` | Extract HTTP client calls from Elixir files |
| `src/indexer/topology/gateway.ts` | Extract gateway routing configs |
| `src/indexer/topology/kafka.ts` | Enhanced Kafka producer/consumer extraction |
| `src/indexer/topology/index.ts` | Barrel export + orchestration |
| `src/indexer/codeowners.ts` | Parse CODEOWNERS files |
| `src/indexer/embeddings.ts` | Embedding generation pipeline (Phase 4) |
| `src/search/ownership.ts` | Ownership query functions |
| `src/search/semantic.ts` | Semantic search via sqlite-vec |
| `src/mcp/tools/owners.ts` | `kb_owners` MCP tool |
| `src/mcp/tools/semantic.ts` | `kb_semantic` MCP tool |
| `src/cli/commands/owners.ts` | `kb owners` CLI command |

### Modified Files

| File | Changes |
|------|---------|
| `src/db/schema.ts` | Bump SCHEMA_VERSION, conditional sqlite-vec loading |
| `src/db/migrations.ts` | Add migrateToV7() and migrateToV8() |
| `src/db/database.ts` | Load sqlite-vec extension in openDatabase() |
| `src/db/fts.ts` | Add 'owner' to COARSE_TYPES |
| `src/types/entities.ts` | Add 'owner' to EntityType union, new RelationshipTypes |
| `src/indexer/pipeline.ts` | Add topology + codeowners extraction to extractRepoData(), embedding gen post-step |
| `src/indexer/writer.ts` | Add insertCodeowners(), insertTopologyEdges(), clearOwners() |
| `src/search/dependencies.ts` | Generalize findLinkedRepos() to handle all edge types |
| `src/search/entity.ts` | Add 'owner' to hydrator, add to nameStmts |
| `src/search/index.ts` | Export new search functions |
| `src/search/types.ts` | Add SemanticSearchResult, OwnershipResult types |
| `src/mcp/server.ts` | Register new tools (kb_owners, kb_semantic) |
| `src/cli/index.ts` | Register new commands (owners) |
| `src/cli/commands/search.ts` | Add --semantic flag |
| `src/cli/commands/deps.ts` | Add --mechanism filter option |

### Unchanged Files

| File | Why Unchanged |
|------|---------------|
| `src/db/tokenizer.ts` | Reused as-is for embedding text preprocessing |
| `src/db/path.ts` | No changes needed |
| `src/mcp/handler.ts` | Generic HOF, works for new tools |
| `src/mcp/sync.ts` | Generic auto-sync, works for new queries |
| `src/mcp/format.ts` | Generic formatter, works for new response types |
| `src/mcp/hygiene.ts` | No changes needed |
| `src/indexer/scanner.ts` | Repo discovery unchanged |
| `src/indexer/git.ts` | Git operations unchanged |
| `src/indexer/metadata.ts` | Repo metadata unchanged (CODEOWNERS is separate data) |
| `src/indexer/elixir.ts` | Existing extractor stays as-is; topology reads its output |
| `src/indexer/proto.ts` | Unchanged |
| `src/indexer/graphql.ts` | Unchanged |
| `src/indexer/events.ts` | Mostly unchanged; Kafka enhancement may move to topology/ |
| `src/indexer/catalog.ts` | Unchanged |

---

## 7. Data Flow for Each Pillar

### Topology Data Flow

```
extractRepoData()
  |-- existing extractors (elixir, proto, events, graphql)
  |-- NEW: extractTopologyEdges(repoPath, branch, elixirModules)
  |         |-- extractGrpcClientCalls(elixirModules)   // reuses parsed Elixir data
  |         |-- extractHttpClientCalls(repoPath, branch) // scans .ex files
  |         |-- extractGatewayRoutes(repoPath, branch)   // scans config files
  |         |-- extractKafkaWiring(repoPath, branch)     // enhanced consumer/producer
  |         \-- returns TopologyEdge[]
  |
  \-- ExtractedRepoData { ..., topologyEdges }

persistExtractedData()
  |-- existing: persistRepoData() / persistSurgicalData()
  |-- existing: insertEventEdges(), insertGrpcClientEdges(), insertEctoAssociationEdges()
  |-- NEW: insertTopologyEdges(db, repoId, topologyEdges)
  |         |-- resolves target service/repo names to IDs
  |         |-- inserts into edges table with metadata JSON
  |         \-- deduplicates with existing gRPC edges
```

### CODEOWNERS Data Flow

```
extractRepoData()
  |-- NEW: extractCodeowners(repoPath, branch)
  |         |-- reads CODEOWNERS from standard locations
  |         |-- parses pattern + owners per line
  |         \-- returns CodeownersEntry[]
  |
  \-- ExtractedRepoData { ..., codeowners }

persistExtractedData()
  |-- NEW: insertCodeowners(db, repoId, codeowners)
  |         |-- clears existing owners for repo
  |         |-- inserts into owners table
  |         \-- indexes owner names into FTS
```

### Embeddings Data Flow

```
indexAllRepos() / indexSingleRepo()
  |-- Phase 1-3: existing pipeline (unchanged)
  |-- Post: catalog enrichment, FTS optimize (unchanged)
  |-- NEW Phase 4: generateEmbeddings(db)
            |-- loads embedding model (lazy, cached)
            |-- queries entities needing embedding (new or changed via text_hash)
            |-- batches text through model
            |-- upserts into vec_entities + entity_embeddings
            \-- logs progress: "Embedded 1234 entities"
```

---

## 8. Suggested Build Order

### Phase A: Service Topology (no new dependencies)

1. **Topology extractors** -- new `src/indexer/topology/*.ts` files
2. **Pipeline integration** -- add to `extractRepoData()` and `persistExtractedData()`
3. **Schema migration V7** -- add `edges.metadata` column
4. **Dependencies generalization** -- update `search/dependencies.ts` to handle all edge types
5. **CLI/MCP enhancements** -- `--mechanism` filter on deps

**Why first:** Pure regex extraction, no new dependencies, extends existing patterns. Provides the richest new data for embedding text later.

### Phase B: CODEOWNERS (one small new dependency: picomatch)

1. **Extractor** -- `src/indexer/codeowners.ts`
2. **Schema migration** -- owners table in V7 (can be combined with topology migration)
3. **Writer integration** -- `insertCodeowners()` in writer.ts
4. **Search function** -- `src/search/ownership.ts`
5. **EntityType expansion** -- add 'owner'
6. **MCP tool + CLI command** -- `kb_owners` / `kb owners`

**Why second:** Independent of topology but simpler. One new table, one new extractor, straightforward file parsing.

### Phase C: Semantic Search (two new dependencies: sqlite-vec, @huggingface/transformers)

1. **Dependency installation** -- sqlite-vec, @huggingface/transformers
2. **Platform validation** -- verify sqlite-vec loads on macOS ARM64
3. **Schema migration V8** -- vec_entities + entity_embeddings (conditional on sqlite-vec)
4. **Embedding pipeline** -- `src/indexer/embeddings.ts`
5. **Semantic search function** -- `src/search/semantic.ts`
6. **MCP tool + CLI flag** -- `kb_semantic` / `kb search --semantic`
7. **Graceful degradation** -- skip embeddings when sqlite-vec unavailable

**Why last:** Most complex, most dependencies, most risk. Benefits from having all entity data (including topology + ownership) for richer embedding text. Can be deferred or feature-flagged without blocking the other pillars.

---

## 9. Patterns to Follow

### Pattern 1: Extractor Interface Consistency

All extractors follow: `(repoPath: string, branch: string) => SomeData[]`. Topology extractors should follow this same pattern. Pure functions, no DB access.

### Pattern 2: Two-Phase Pipeline Separation

Extraction (Phase 2, parallel) produces a data structure. Persistence (Phase 3, sequential) writes to DB. New features must respect this boundary. Embedding generation is Phase 4 because it needs DB data.

### Pattern 3: Edge-Based Relationships

All inter-entity relationships go through the `edges` table with `source_type/id -> target_type/id + relationship_type`. Don't create separate tables for specific relationship types.

### Pattern 4: FTS Entity Indexing

All searchable entities get indexed via `indexEntity()` with composite `parent:subtype` format. New entity types (owners) should follow this pattern.

### Pattern 5: MCP Tool Registration

Each tool is a separate file in `src/mcp/tools/`, registered via `register*Tool(server, db)`, wrapped with `wrapToolHandler()`, and optionally using `withAutoSync()`.

---

## 10. Anti-Patterns to Avoid

### Anti-Pattern 1: DB Access in Extractors

**What:** Having topology extractors query the DB to resolve service names during extraction.
**Why bad:** Breaks Phase 2 parallelism (extractors must be DB-free).
**Instead:** Return unresolved names in TopologyEdge; resolve to IDs during Phase 3 persistence.

### Anti-Pattern 2: Embedding in Extraction Phase

**What:** Generating embeddings during `extractRepoData()`.
**Why bad:** CPU-bound ONNX inference blocks the p-limit concurrency pool, starving other repos.
**Instead:** Embedding generation is a separate Phase 4, after all repos are persisted.

### Anti-Pattern 3: Separate Tables Per Edge Type

**What:** Creating `grpc_edges`, `http_edges`, `kafka_edges` tables.
**Why bad:** Fragments the relationship model, makes graph traversal require UNION across tables.
**Instead:** Use the existing polymorphic `edges` table with `relationship_type` + `metadata` JSON.

### Anti-Pattern 4: Eager Model Loading

**What:** Loading the embedding model at application startup.
**Why bad:** Adds 2-5 seconds to every `kb search` or MCP server start, even for FTS-only queries.
**Instead:** Lazy-load the model only when `--semantic` flag is used or `kb_semantic` tool is called.

---

## 11. Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| sqlite-vec fails to load on macOS ARM64 | HIGH | Test early in Phase C. Fallback: brute-force cosine distance on regular table (slower but functional) |
| Embedding model download fails (offline, disk space) | MEDIUM | Graceful degradation: skip embeddings, warn user, FTS still works |
| Transformers.js ONNX inference too slow for ~50 repos | LOW | Batch processing + text_hash skipping. Worst case: ~5000 entities * 50ms = 250s. Incremental: much faster |
| CODEOWNERS glob patterns don't match gitignore semantics exactly | LOW | Use picomatch which handles gitignore semantics. Test against real CODEOWNERS files |
| HTTP client patterns too regex-fragile | MEDIUM | Start with high-confidence patterns (Tesla.Middleware.BaseUrl), add more patterns iteratively. Confidence field allows filtering |
| Edge metadata JSON bloats DB | LOW | JSON is compact. At ~50 repos * ~20 edges = 1000 rows, even 500 bytes/row = 0.5MB |

---

## Sources

- Direct codebase analysis: all 46 source files in `src/`
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec) -- vec0 virtual table API, metadata columns, KNN query syntax
- [sqlite-vec Node.js guide](https://alexgarcia.xyz/sqlite-vec/js.html) -- better-sqlite3 integration, Float32Array usage
- [sqlite-vec metadata release](https://alexgarcia.xyz/blog/2024/sqlite-vec-metadata-release/index.html) -- metadata columns, auxiliary columns, partition keys
- [sqlite-vec npm](https://www.npmjs.com/package/sqlite-vec) -- v0.1.7-alpha.2, platform binaries
- [sqlite-vec-darwin-arm64 npm](https://www.npmjs.com/package/sqlite-vec-darwin-arm64) -- macOS ARM64 binary exists
- [Transformers.js v3](https://huggingface.co/blog/transformersjs-v3) -- ONNX inference, feature-extraction pipeline
- [Xenova/all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2) -- 384d embeddings, ONNX optimized
- [GitHub CODEOWNERS docs](https://docs.github.com/articles/about-code-owners) -- file format, last-match-wins, pattern syntax
