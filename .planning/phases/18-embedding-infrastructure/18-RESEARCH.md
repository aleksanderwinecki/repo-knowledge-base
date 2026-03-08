# Phase 18: Embedding Infrastructure - Research

**Researched:** 2026-03-08
**Domain:** Vector embeddings (local inference + SQLite storage)
**Confidence:** MEDIUM-HIGH

## Summary

This phase adds vector embedding generation and storage to the existing indexing pipeline. Two new dependencies are required: `sqlite-vec` (native SQLite extension for vector storage/KNN) and `@huggingface/transformers` (local ONNX model inference for nomic-embed-text-v1.5). The architecture is well-defined by user decisions: embeddings run as a post-persistence step in `kb index`, stored in a `vec0` virtual table, with graceful degradation when sqlite-vec is unavailable.

The primary risk is the sync/async bridge: better-sqlite3 is synchronous but Transformers.js is fully async. The pipeline already uses `async` functions (`indexAllRepos` returns `Promise<IndexResult[]>`), so the embedding step fits naturally after the Phase 3 serial persistence loop. The secondary risk is sqlite-vec platform compatibility on macOS ARM64 -- the npm package ships prebuilt binaries for darwin-arm64, but it's pre-v1 software.

**Primary recommendation:** Use `sqlite-vec` v0.1.7-alpha with its `load(db)` API for better-sqlite3, and `@huggingface/transformers` v3.x with the singleton pipeline pattern for lazy model loading. Store embeddings with integer rowid mapped to entity type+id via metadata columns, not text composite keys.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Embedding text composition per entity type:
  - **Modules**: `"{name} {type} {summary}"`
  - **Events**: `"{name} {schema_definition}"`
  - **Services**: `"{name} {description}"`
  - **Repos**: `"{name} {description}"`
  - **Learned facts**: `"{content} {repo}"`
- All text passed through `tokenizeForFts()` before feeding to model (SEM-03)
- Empty/null fields skipped (just use what's available)
- Conditional load at DB initialization -- try `db.loadExtension('vec0')`, catch failure
- Store load success as boolean flag accessible to pipeline code
- If sqlite-vec unavailable: skip V8 migration entirely, skip embedding step, log one warning
- No hard dependency -- `kb index` works fine without it, just no embeddings
- Track which entities have embeddings via presence in vec0 table
- On incremental/surgical index: embed only newly persisted or updated entities
- On `--force` full index: re-embed everything (vec0 table cleared with repo data)
- Cold start (first run after V8): embed all existing entities in one batch
- Batch size: process entities in chunks to manage Transformers.js memory
- Embedding is part of `kb index`, not a separate command
- Add `embeddings` count to existing `IndexStats` output
- Print timing for embedding step when `--timing` flag is set
- Single summary line: "Generated N embeddings (Xms)" after per-repo persistence
- If sqlite-vec unavailable, print once: "sqlite-vec not available, skipping embeddings"

### Claude's Discretion
- Transformers.js initialization and model caching strategy
- vec0 table schema (entity_type + entity_id composite key vs single rowid)
- Exact chunk/batch size for embedding generation
- Error handling for individual embedding failures (skip entity vs abort batch)
- Whether to lazy-load Transformers.js (first use) or eager-load (pipeline start)
- V8 migration structure (conditional DDL based on sqlite-vec availability)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SEM-01 | sqlite-vec integration -- load native extension into better-sqlite3, validate macOS ARM64 | sqlite-vec npm package provides `load(db)` API compatible with better-sqlite3; ships darwin-arm64 prebuilt binaries; pre-v1 but functional |
| SEM-02 | Embedding generation pipeline -- nomic-embed-text-v1.5 via Transformers.js, 256d Matryoshka, post-persistence phase | @huggingface/transformers v3.x provides `pipeline('feature-extraction')` + `layer_norm` + `slice` for Matryoshka 256d truncation; ESM-native |
| SEM-03 | Code-aware embedding text preprocessing -- reuse tokenizeForFts() for CamelCase/snake_case splitting | `tokenizeForFts()` in `src/db/tokenizer.ts` already handles CamelCase/snake_case splitting; direct reuse |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| sqlite-vec | 0.1.7-alpha.2 | Vec0 virtual table for vector storage + KNN | Only SQLite vector extension with npm package; `load(db)` API designed for better-sqlite3 |
| @huggingface/transformers | ^3.8.1 | Local ONNX inference for nomic-embed-text-v1.5 | Official Transformers.js v3; replaces @xenova/transformers; ESM-native |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| p-limit | 7.3.0 (existing) | Batch concurrency control | Already a dependency; reuse for embedding chunk processing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| sqlite-vec | Custom Float32Array BLOB storage | Loses KNN query support; must implement distance calculations manually |
| @huggingface/transformers | ollama/local API | Adds external service dependency; defeats "runs anywhere" philosophy |
| @xenova/transformers | @huggingface/transformers | @xenova is legacy (v1/v2); @huggingface/transformers is the v3 official package |

**Installation:**
```bash
npm install sqlite-vec @huggingface/transformers
```

## Architecture Patterns

### Recommended Project Structure
```
src/
  db/
    database.ts           # Modified: sqlite-vec extension loading
    migrations.ts         # Modified: V8 migration (conditional vec0 table)
    schema.ts             # Modified: SCHEMA_VERSION = 8
    vec.ts                # NEW: sqlite-vec availability flag + vec0 helpers
  embeddings/
    pipeline.ts           # NEW: Transformers.js singleton + embed batch
    text.ts               # NEW: embedding text composition per entity type
  indexer/
    pipeline.ts           # Modified: Phase 4 embedding step after persistence
```

### Pattern 1: sqlite-vec Extension Loading at DB Init
**What:** Load sqlite-vec as a conditional native extension during database initialization.
**When to use:** Every time `openDatabase()` is called.
**Example:**
```typescript
// src/db/vec.ts
import * as sqliteVec from 'sqlite-vec';
import type Database from 'better-sqlite3';

let vecAvailable = false;

export function loadVecExtension(db: Database.Database): boolean {
  try {
    sqliteVec.load(db);
    vecAvailable = true;
    return true;
  } catch {
    // sqlite-vec not available on this platform
    vecAvailable = false;
    return false;
  }
}

export function isVecAvailable(): boolean {
  return vecAvailable;
}
```

**Integration point in database.ts:**
```typescript
import { loadVecExtension } from './vec.js';

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  // ... existing pragmas ...

  // Try loading sqlite-vec (non-fatal if unavailable)
  loadVecExtension(db);

  initializeSchema(db);
  return db;
}
```

### Pattern 2: Conditional V8 Migration
**What:** Only create vec0 virtual table if sqlite-vec was loaded successfully.
**When to use:** During schema migration from V7 to V8.
**Example:**
```typescript
// In migrations.ts
import { isVecAvailable } from './vec.js';

function migrateToV8(db: Database.Database): void {
  if (!isVecAvailable()) return; // Skip vec0 DDL entirely

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS entity_embeddings USING vec0(
      embedding float[256],
      entity_type text,
      entity_id integer
    );
  `);
}
```

**IMPORTANT vec0 schema note:** vec0 virtual tables use integer rowid by default. Text primary keys are NOT supported. Use metadata columns (`entity_type text, entity_id integer`) for the entity reference, with the default auto-incrementing rowid as the vec0 primary key. To look up whether an entity already has an embedding, query: `SELECT rowid FROM entity_embeddings WHERE entity_type = ? AND entity_id = ?`.

### Pattern 3: Transformers.js Singleton Pipeline
**What:** Lazy-initialize the embedding model once, reuse across all embedding calls.
**When to use:** First time embeddings are requested during `kb index`.
**Example:**
```typescript
// src/embeddings/pipeline.ts
import { pipeline, layer_norm, env } from '@huggingface/transformers';
import type { FeatureExtractionPipeline, Tensor } from '@huggingface/transformers';

const MATRYOSHKA_DIM = 256;

let extractor: FeatureExtractionPipeline | null = null;

export async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    // Cache models in a predictable location
    env.cacheDir = './.cache/models';

    extractor = await pipeline(
      'feature-extraction',
      'nomic-ai/nomic-embed-text-v1.5',
      { dtype: 'fp32' }  // or 'q8' for quantized
    );
  }
  return extractor;
}

export async function generateEmbedding(text: string): Promise<Float32Array> {
  const pipe = await getEmbeddingPipeline();

  // nomic-embed-text requires "search_document: " prefix for indexing
  const prefixedText = `search_document: ${text}`;

  // Run inference
  let output = await pipe(prefixedText, { pooling: 'mean' });

  // Matryoshka truncation: layer_norm -> slice to 256d -> L2 normalize
  output = layer_norm(output, [output.dims[1]])
    .slice(null, [0, MATRYOSHKA_DIM])
    .normalize(2, -1);

  return new Float32Array(output.data);
}
```

### Pattern 4: Embedding Text Composition
**What:** Build embedding input text from entity fields, then preprocess with tokenizeForFts.
**When to use:** Before calling generateEmbedding for each entity.
**Example:**
```typescript
// src/embeddings/text.ts
import { tokenizeForFts } from '../db/tokenizer.js';

interface EmbeddingEntity {
  entityType: string;
  entityId: number;
  // Fields vary by type
  name?: string;
  type?: string;
  summary?: string;
  description?: string;
  schemaDefinition?: string;
  content?: string;
  repo?: string;
}

export function composeEmbeddingText(entity: EmbeddingEntity): string | null {
  const parts: string[] = [];

  switch (entity.entityType) {
    case 'module':
      if (entity.name) parts.push(entity.name);
      if (entity.type) parts.push(entity.type);
      if (entity.summary) parts.push(entity.summary);
      break;
    case 'event':
      if (entity.name) parts.push(entity.name);
      if (entity.schemaDefinition) parts.push(entity.schemaDefinition);
      break;
    case 'service':
      if (entity.name) parts.push(entity.name);
      if (entity.description) parts.push(entity.description);
      break;
    case 'repo':
      if (entity.name) parts.push(entity.name);
      if (entity.description) parts.push(entity.description);
      break;
    case 'learned_fact':
      if (entity.content) parts.push(entity.content);
      if (entity.repo) parts.push(entity.repo);
      break;
    default:
      return null;
  }

  if (parts.length === 0) return null;

  // SEM-03: preprocess through tokenizeForFts
  return tokenizeForFts(parts.join(' '));
}
```

### Pattern 5: Post-Persistence Embedding Step
**What:** After all repos are persisted (Phase 3), run embeddings as Phase 4.
**When to use:** In `indexAllRepos` after the persistence loop.
**Example:**
```typescript
// In indexAllRepos, after Phase 3 persistence and before FTS optimize:
if (success > 0 && isVecAvailable()) {
  try {
    const embeddingCount = await generateAllEmbeddings(db, options.force);
    console.log(`Generated ${embeddingCount} embeddings`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`Embedding generation failed: ${msg}`);
  }
}
```

### Anti-Patterns to Avoid
- **Embedding inside extractors:** Extractors run in parallel Phase 2 without DB access. Embeddings need persisted entity IDs. Always run after persistence.
- **Using raw db.loadExtension('vec0'):** Use `sqliteVec.load(db)` from the npm package instead -- it handles entry point discovery and extension path resolution.
- **Storing vectors as JSON strings:** Use `Float32Array` with `.buffer` accessor for proper binary binding. JSON is ~4x larger and requires parsing.
- **Skipping the "search_document:" prefix:** nomic-embed-text-v1.5 requires task-specific prefixes. Documents being indexed use `"search_document: "`, queries (Phase 19) use `"search_query: "`.
- **Generating embeddings one-at-a-time:** Transformers.js supports batched inference. Process entities in chunks (e.g., 32-64) for throughput.
- **Text primary keys in vec0:** vec0 only supports integer rowid. Use metadata columns for entity_type and entity_id.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vector storage + KNN | Custom BLOB columns + manual distance calc | sqlite-vec vec0 virtual table | KNN requires efficient indexing; manual brute-force won't scale |
| Text embedding inference | Custom ONNX runtime setup | @huggingface/transformers pipeline API | Handles model download, caching, ONNX backend, tokenization |
| Matryoshka dimension reduction | Manual array slicing + normalization | `layer_norm` + `slice` + `normalize` from transformers | Correct normalization order matters for quality |
| CamelCase/snake_case splitting | New tokenizer | Existing `tokenizeForFts()` | Already tested, handles edge cases (HTTPSServer, etc.) |
| Extension path resolution | Manual .dylib/.so finding | `sqliteVec.load(db)` | Handles platform detection, entry point discovery |

**Key insight:** The embedding pipeline is glue code between two well-tested libraries. The value is in correct integration, not custom ML or vector math.

## Common Pitfalls

### Pitfall 1: sqlite-vec Load Order vs Migration Order
**What goes wrong:** V8 migration tries to CREATE vec0 table before sqlite-vec extension is loaded.
**Why it happens:** `initializeSchema` runs migrations inside a function called from `openDatabase`. If extension loading happens after schema init, vec0 DDL fails.
**How to avoid:** Load sqlite-vec extension BEFORE calling `initializeSchema(db)` in `openDatabase()`.
**Warning signs:** "no such module: vec0" error during migration.

### Pitfall 2: nomic-embed-text Task Prefix Mismatch
**What goes wrong:** Embeddings generated without "search_document:" prefix produce poor similarity scores.
**Why it happens:** nomic-embed-text-v1.5 was trained with task-specific prefixes that control the embedding space geometry.
**How to avoid:** Always prefix index-time text with `"search_document: "`. Phase 19 will use `"search_query: "` for queries.
**Warning signs:** Semantic search returns unrelated results despite correct KNN mechanics.

### Pitfall 3: Float32Array Binding in better-sqlite3
**What goes wrong:** Vectors inserted as regular arrays or JSON strings instead of binary.
**Why it happens:** JavaScript arrays aren't automatically converted to the binary format sqlite-vec expects.
**How to avoid:** Always use `new Float32Array(values)` when binding vector parameters. The sqlite-vec npm package documentation confirms this is the expected format.
**Warning signs:** "invalid vector" errors or silently corrupt data.

### Pitfall 4: Async Transformers.js in Sync better-sqlite3 Pipeline
**What goes wrong:** Attempting to call `await` inside a `db.transaction()` block.
**Why it happens:** better-sqlite3 transactions are synchronous. You can't await inside them.
**How to avoid:** Generate embeddings async FIRST, then batch-insert into vec0 using a sync transaction. Two-phase: async generate, sync persist.
**Warning signs:** "Transaction was forcefully rolled back" or unresolved promises.

### Pitfall 5: Model Download on First Run
**What goes wrong:** First `kb index` with embeddings takes 5-30 seconds downloading the model before any inference begins.
**Why it happens:** Transformers.js downloads ONNX model files from Hugging Face Hub on first use.
**How to avoid:** Document this behavior. Consider logging "Downloading embedding model (first run only)..." Cached subsequent runs are fast.
**Warning signs:** User reports "kb index hangs" on first run with embeddings enabled.

### Pitfall 6: Memory Pressure from Large Batches
**What goes wrong:** OOM or slowdown when embedding thousands of entities in one call.
**Why it happens:** Transformers.js holds model + input tensors + output tensors in memory.
**How to avoid:** Process in chunks of 32-64 entities. Free intermediate results between chunks.
**Warning signs:** Node.js process exceeds 1-2GB memory during indexing.

### Pitfall 7: vec0 Integer Rowid Constraint
**What goes wrong:** Attempting to use `entity_type TEXT PRIMARY KEY` or composite text keys in vec0.
**Why it happens:** vec0 only supports integer rowid as primary key. Text primary keys are not supported.
**How to avoid:** Use the default integer rowid with `entity_type` and `entity_id` as metadata columns. Query by metadata to check existence.
**Warning signs:** "vec0 does not support text primary keys" or similar errors during table creation.

## Code Examples

### sqlite-vec Load + vec0 Table Creation
```typescript
// Source: sqlite-vec npm docs + GitHub examples
import * as sqliteVec from 'sqlite-vec';
import Database from 'better-sqlite3';

const db = new Database(':memory:');
sqliteVec.load(db);

// Verify loaded
const version = db.prepare('SELECT vec_version()').pluck().get();
console.log(`sqlite-vec ${version}`);

// Create vec0 table with 256d float vectors + metadata columns
db.exec(`
  CREATE VIRTUAL TABLE entity_embeddings USING vec0(
    embedding float[256],
    entity_type text,
    entity_id integer
  );
`);
```

### Inserting a Vector
```typescript
// Source: sqlite-vec GitHub examples/simple-node/demo.mjs
const embedding = new Float32Array(256); // fill with actual values
const insertStmt = db.prepare(`
  INSERT INTO entity_embeddings(embedding, entity_type, entity_id)
  VALUES (?, ?, ?)
`);
insertStmt.run(embedding, 'module', 42);
```

### KNN Query
```typescript
// Source: sqlite-vec docs
const queryVec = new Float32Array(256); // query embedding
const results = db.prepare(`
  SELECT rowid, entity_type, entity_id, distance
  FROM entity_embeddings
  WHERE embedding MATCH ?
  AND k = ?
  ORDER BY distance
`).all(queryVec, 10);
```

### Matryoshka 256d Embedding Generation
```typescript
// Source: nomic-ai/nomic-embed-text-v1.5 HuggingFace model card
import { pipeline, layer_norm } from '@huggingface/transformers';

const extractor = await pipeline(
  'feature-extraction',
  'nomic-ai/nomic-embed-text-v1.5',
);

// For indexing: prefix with "search_document: "
const texts = ['search_document: booking context creates a booking for a customer'];

let embeddings = await extractor(texts, { pooling: 'mean' });

// Matryoshka truncation to 256 dimensions
const matryoshka_dim = 256;
embeddings = layer_norm(embeddings, [embeddings.dims[1]])
  .slice(null, [0, matryoshka_dim])
  .normalize(2, -1);

// Extract Float32Array for sqlite-vec
const vector = new Float32Array(embeddings.data.slice(0, matryoshka_dim));
```

### Batch Embedding Generation
```typescript
// Batch multiple texts for efficient inference
const texts = entities.map(e => `search_document: ${composeEmbeddingText(e)}`);

// Process in chunks to manage memory
const CHUNK_SIZE = 32;
for (let i = 0; i < texts.length; i += CHUNK_SIZE) {
  const chunk = texts.slice(i, i + CHUNK_SIZE);
  let output = await extractor(chunk, { pooling: 'mean' });
  output = layer_norm(output, [output.dims[1]])
    .slice(null, [0, 256])
    .normalize(2, -1);

  // Convert each row to Float32Array and insert
  for (let j = 0; j < chunk.length; j++) {
    const vec = new Float32Array(
      output.data.slice(j * 256, (j + 1) * 256)
    );
    insertStmt.run(vec, entities[i + j].entityType, entities[i + j].entityId);
  }
}
```

### Deleting Embeddings for a Repo (Full Re-index)
```typescript
// When --force or full re-index, clear embeddings for entities being replaced
// Need to join against entity tables to find which embeddings belong to a repo
function clearRepoEmbeddings(db: Database.Database, repoId: number): void {
  if (!isVecAvailable()) return;

  // Delete embeddings for all entity types belonging to this repo
  for (const entityType of ['module', 'event', 'service', 'repo']) {
    const table = entityType === 'repo' ? 'repos' : `${entityType}s`;
    const idQuery = entityType === 'repo'
      ? `SELECT ${repoId} as id`
      : `SELECT id FROM ${table} WHERE repo_id = ?`;

    const ids = entityType === 'repo'
      ? [{ id: repoId }]
      : db.prepare(idQuery).all(repoId) as { id: number }[];

    for (const { id } of ids) {
      db.prepare(
        'DELETE FROM entity_embeddings WHERE entity_type = ? AND entity_id = ?'
      ).run(entityType, id);
    }
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| @xenova/transformers v1/v2 | @huggingface/transformers v3 | 2024 | Official package, ESM-native, better Node.js support |
| sqlite-vss (faiss-based) | sqlite-vec (pure C) | 2024 | No C++ deps, runs everywhere SQLite runs, simpler install |
| Full-dimension embeddings (768d) | Matryoshka truncation (256d) | 2024 | 3x storage savings with minimal quality loss |
| Fixed embedding dimensions | Flexible Matryoshka dimensions | 2024 | Can trade quality for size at query time |

**Deprecated/outdated:**
- `@xenova/transformers`: Legacy v1/v2, replaced by `@huggingface/transformers` v3
- `sqlite-vss`: Predecessor to sqlite-vec, based on Faiss, heavier C++ dependencies
- `Xenova/nomic-embed-text-v1` model ID: Use `nomic-ai/nomic-embed-text-v1.5` for ONNX models compatible with transformers.js v3

## Open Questions

1. **sqlite-vec entity_type/entity_id metadata filtering performance**
   - What we know: Metadata columns support `=` operator in WHERE clauses during KNN queries
   - What's unclear: Whether metadata columns on vec0 are indexed efficiently for DELETE operations (clearing embeddings for a repo's entities). May need to benchmark.
   - Recommendation: For Phase 18, use simple DELETE loops per entity. If slow, consider a separate lookup table in Phase 19.

2. **Transformers.js model cache location**
   - What we know: Default cache is `./node_modules/@huggingface/transformers/.cache/`. Can override via `env.cacheDir`.
   - What's unclear: Best cache location for a CLI tool installed globally via `npm link`. The node_modules cache may not persist across reinstalls.
   - Recommendation: Use `~/.cache/huggingface/` or `~/.kb/models/` for stable caching. The user's home directory is persistent.

3. **vec0 table behavior during full re-index**
   - What we know: On `--force`, `clearRepoEntities` deletes modules/events/services. Embeddings must also be cleared.
   - What's unclear: Whether `DELETE FROM entity_embeddings WHERE entity_type = 'module' AND entity_id IN (...)` is efficient with vec0, or if we need to drop/recreate the table.
   - Recommendation: Try metadata-filtered DELETE first. vec0 supports it per the docs. If performance is an issue, fall back to `DROP TABLE` + `CREATE TABLE` on `--force`.

4. **@huggingface/transformers ONNX model variant**
   - What we know: nomic-embed-text-v1.5 has multiple ONNX variants (fp32, fp16, q8)
   - What's unclear: Which variant Transformers.js v3 downloads by default, and whether quantized variants affect embedding quality meaningfully at 256d
   - Recommendation: Start with default (likely fp32). If model download size is too large (~500MB), investigate `dtype: 'q8'` option.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/db/schema.test.ts tests/embeddings/` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SEM-01 | sqlite-vec loads into better-sqlite3, vec0 table created | unit | `npx vitest run tests/db/vec.test.ts -x` | No -- Wave 0 |
| SEM-01 | Graceful fallback when sqlite-vec unavailable | unit | `npx vitest run tests/db/vec.test.ts -x` | No -- Wave 0 |
| SEM-02 | Embedding pipeline generates 256d Float32Array | unit | `npx vitest run tests/embeddings/pipeline.test.ts -x` | No -- Wave 0 |
| SEM-02 | Embeddings stored in vec0 table after indexing | integration | `npx vitest run tests/embeddings/integration.test.ts -x` | No -- Wave 0 |
| SEM-03 | Embedding text preprocessed through tokenizeForFts | unit | `npx vitest run tests/embeddings/text.test.ts -x` | No -- Wave 0 |
| SEM-03 | Entity text composition matches spec per type | unit | `npx vitest run tests/embeddings/text.test.ts -x` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/db/schema.test.ts tests/embeddings/ -x`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/db/vec.test.ts` -- sqlite-vec loading, graceful degradation, vec0 DDL
- [ ] `tests/embeddings/text.test.ts` -- embedding text composition per entity type, tokenizeForFts preprocessing
- [ ] `tests/embeddings/pipeline.test.ts` -- embedding generation, Matryoshka truncation, Float32Array output (may need mock for CI without model)
- [ ] `tests/embeddings/integration.test.ts` -- end-to-end: persist entities then generate and store embeddings
- [ ] `tests/db/schema.test.ts` -- update existing tests for SCHEMA_VERSION = 8 assertion

## Sources

### Primary (HIGH confidence)
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec) -- vec0 syntax, load API, platform support, version info
- [nomic-ai/nomic-embed-text-v1.5 HuggingFace](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) -- model card, Matryoshka dims, task prefixes, Transformers.js example
- [Transformers.js Node.js tutorial](https://huggingface.co/docs/transformers.js/tutorials/node) -- ESM setup, cache config, singleton pattern
- [sqlite-vec metadata blog post](https://alexgarcia.xyz/blog/2024/sqlite-vec-metadata-release/index.html) -- metadata columns, auxiliary columns, filtering syntax

### Secondary (MEDIUM confidence)
- [sqlite-vec npm page](https://www.npmjs.com/package/sqlite-vec) -- version 0.1.7-alpha.2, darwin-arm64 binary availability
- [@huggingface/transformers npm](https://www.npmjs.com/package/@huggingface/transformers) -- v3.8.1, 380+ dependents
- [sqlite-vec JS docs](https://alexgarcia.xyz/sqlite-vec/js.html) -- Float32Array binding, better-sqlite3 load() API
- [Transformers.js v3 blog](https://huggingface.co/blog/transformersjs-v3) -- v3 migration from @xenova

### Tertiary (LOW confidence)
- sqlite-vec text primary key support status -- could not find definitive docs confirming or denying; all examples use integer PK. Research indicates integer-only is safe assumption.
- @huggingface/transformers default ONNX variant selection -- training data suggests fp32 default, but needs validation at implementation time.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- both libraries are well-documented, actively maintained, and have clear npm packages
- Architecture: MEDIUM-HIGH -- integration patterns are well-established, but async/sync bridge and vec0 schema design have some open questions
- Pitfalls: HIGH -- most pitfalls documented from official sources and known SQLite extension patterns

**Research date:** 2026-03-08
**Valid until:** 2026-04-08 (sqlite-vec is pre-v1 with frequent alpha releases; check for breaking changes)
