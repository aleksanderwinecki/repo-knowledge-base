# Technology Stack: v2.0 Design-Time Intelligence

**Project:** repo-knowledge-base v2.0
**Researched:** 2026-03-08
**Focus:** Stack additions for service topology, CODEOWNERS parsing, and embedding-based semantic search

## Existing Stack (DO NOT CHANGE)

| Technology | Version | Purpose |
|------------|---------|---------|
| better-sqlite3 | ^12.0.0 | SQLite access (sync API) |
| @modelcontextprotocol/sdk | ^1.27.1 | MCP server |
| commander | ^14.0.3 | CLI framework |
| p-limit | ^7.3.0 | Concurrency control |
| zod | ^4.3.6 | Schema validation |
| TypeScript | ^5.7.0 | Language (strict + noUncheckedIndexedAccess) |
| vitest | ^3.0.0 | Testing |

## New Stack Additions

### 1. Vector Storage: sqlite-vec

| Property | Value |
|----------|-------|
| **Package** | `sqlite-vec` |
| **Version** | `0.1.7-alpha.2` (latest on npm) |
| **Status** | Pre-v1 alpha, but widely adopted and actively developed |
| **Confidence** | HIGH -- official docs + npm verified |

**Why sqlite-vec:** It's the only viable option. Pure C, zero dependencies, loads directly into better-sqlite3 via `sqliteVec.load(db)`. Keeps everything in one SQLite file -- no new infrastructure. The predecessor sqlite-vss (Faiss-based) is deprecated in favor of sqlite-vec.

**Integration with better-sqlite3:**
```typescript
import * as sqliteVec from 'sqlite-vec';
import Database from 'better-sqlite3';

const db = new Database(dbPath);
sqliteVec.load(db);  // Loads vec0 extension

// Create vector table with cosine distance
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
    entity_id INTEGER PRIMARY KEY,
    embedding float[256] distance_metric=cosine
  );
`);

// Insert: vectors as Float32Array binary
const embedding = new Float32Array([0.1, 0.2, ...]);
db.prepare('INSERT INTO vec_embeddings(entity_id, embedding) VALUES (?, ?)')
  .run(entityId, embedding.buffer);

// KNN query
const results = db.prepare(`
  SELECT entity_id, distance
  FROM vec_embeddings
  WHERE embedding MATCH ? AND k = 10
`).all(queryEmbedding.buffer);
```

**macOS ARM64 compatibility:** Prebuilt binaries available via `sqlite-vec-darwin-arm64` (auto-resolved by `sqlite-vec` package). Verified on npm. Pure C extension, no Faiss/BLAS dependencies -- much simpler than the old sqlite-vss.

**Key capabilities:**
- vec0 virtual tables with float32, int8, and binary vector types
- Distance metrics: L2 (default), cosine, hamming (binary only)
- KNN queries via `MATCH` operator with `k` parameter or `LIMIT`
- Metadata columns, partition keys, auxiliary columns (v0.1.6+)
- JSON or binary vector input formats
- Brute-force scan (no index structure) -- fine for ~50 repos / ~10K entities

**Limitations:**
- Pre-v1: expect breaking changes between alpha versions
- Brute-force KNN (no approximate nearest neighbors) -- not an issue at our scale
- No built-in HNSW or IVF indexing -- again, irrelevant for ~10K vectors

### 2. Embedding Model: nomic-embed-text-v1.5 via Transformers.js

| Property | Value |
|----------|-------|
| **Runtime** | `@huggingface/transformers` |
| **Runtime Version** | `^3.8.1` (stable; v4 preview exists but unnecessary) |
| **Model** | `nomic-ai/nomic-embed-text-v1.5` |
| **Parameters** | 137M |
| **Max dimensions** | 768 (Matryoshka: truncate to 256 for our use) |
| **Context length** | 8,192 tokens |
| **Quantization** | q8 (ONNX quantized, ~34MB on disk) |
| **Confidence** | HIGH -- model on HuggingFace with ONNX + Transformers.js tags |

**Why nomic-embed-text-v1.5 over alternatives:**

| Model | Params | Dims | Why Not |
|-------|--------|------|---------|
| all-MiniLM-L6-v2 | 22M | 384 | Faster but ~5-8% lower retrieval accuracy. No task prefixes. No Matryoshka. 256-token context limit is tight for architecture descriptions. |
| nomic-embed-text-v1.5 | 137M | 768 (truncatable) | **Selected.** Task prefixes (search_query/search_document) improve retrieval. Matryoshka lets us use 256d for speed+storage. 8K context. |
| Jina Code Embeddings V2 | 137M | 768 | Code-focused but overkill -- we're embedding module names and descriptions, not raw source code. |
| CodeSage Large V2 | 1.3B | -- | Way too large for local inference on a CLI tool. |
| VoyageCode3 / OpenAI | API | varies | Requires API keys + network. Violates local-only constraint. |

**Why local inference over API:**
- Project constraint: "Runtime: Local only, no external infrastructure"
- No API keys to manage, no rate limits, no cost
- Embedding ~10K entity descriptions is a one-time batch job per index run
- Transformers.js with ONNX on CPU handles this in seconds

**Matryoshka dimension choice: 256**
- nomic-embed-text-v1.5 at 256d: MTEB score 61.04 (vs 62.28 at 768d)
- Negligible quality loss, but 3x less storage and faster cosine distance
- 256 floats * 4 bytes = 1KB per entity. At 10K entities = ~10MB. Trivially small.

**Task prefix requirement (important):**
nomic-embed-text-v1.5 requires prefixes:
- `search_document: <text>` for indexing entity descriptions
- `search_query: <text>` for user queries
This is critical for good retrieval quality -- the model was trained with these prefixes.

**Transformers.js integration:**
```typescript
import { pipeline, env } from '@huggingface/transformers';

// Cache models in the KB data directory
env.cacheDir = path.join(kbDir, 'models');

// Singleton pattern (model loads once, reused across calls)
const extractor = await pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5', {
  dtype: 'q8',           // 8-bit quantized ONNX
  // device: 'cpu',      // default for Node.js
});

// Generate embeddings
const output = await extractor('search_document: PaymentService handles Stripe integration', {
  pooling: 'mean',
  normalize: true,
});

// Truncate to 256 dimensions (Matryoshka)
const fullEmbedding = output.tolist()[0];  // 768d
const embedding = new Float32Array(fullEmbedding.slice(0, 256));
```

**First-run behavior:** The model downloads (~130MB ONNX quantized) on first use and caches locally. Subsequent runs are instant. This is acceptable for a developer tool.

### 3. CODEOWNERS Parsing: Manual regex (no library)

| Property | Value |
|----------|-------|
| **Approach** | Custom regex parser (~40 lines) |
| **Library** | None |
| **Confidence** | HIGH -- format is trivially simple |

**Why no library:**

The CODEOWNERS format is embarrassingly simple:
```
# Comment
*.js @frontend-team
/src/payments/ @payments-team @alice
```

Each non-comment, non-empty line is: `<glob-pattern> <space-separated owners>`

Available libraries and why they're all overkill:

| Library | Weekly DL | Last Update | Why Skip |
|---------|-----------|-------------|----------|
| codeowners-utils | ~5K | 2020 (stale) | 7 commits total. Unmaintained. Adds minimatch dep for glob matching we don't need. |
| codeowners | ~15K | Moderate | CLI-focused, reads from git. We just need to parse the file content. |
| @snyk/github-codeowners | ~3K | Moderate | Enterprise-oriented, TypeScript but heavy. |
| @gitlab/codeowners | ~2K | Active | GitLab-specific format extensions we don't need. |

**What we actually need:** Parse CODEOWNERS into `{ pattern: string, owners: string[] }[]` entries, then store owners per repo. We do NOT need glob matching (we're not matching files to owners -- we're answering "who owns this repo/path?").

**Implementation sketch:**
```typescript
interface CodeOwnerEntry {
  pattern: string;
  owners: string[];  // @team or email
}

function parseCodeOwners(content: string): CodeOwnerEntry[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const parts = line.split(/\s+/);
      const pattern = parts[0]!;
      const owners = parts.slice(1).filter(p => p.startsWith('@') || p.includes('@'));
      return { pattern, owners };
    })
    .reverse();  // Later rules take precedence
}
```

This is ~15 lines. Adding a dependency for this is negative value.

**Where to find CODEOWNERS:** Check `CODEOWNERS`, `.github/CODEOWNERS`, `docs/CODEOWNERS` (in order). Read from git tree (already have `git show branch:path` infrastructure in `src/indexer/git.ts`).

### 4. Service Topology Extraction: No new libraries needed

| Property | Value |
|----------|-------|
| **Approach** | New regex-based extractors following existing patterns |
| **Dependencies** | None -- reuse existing git.ts + extractor architecture |
| **Confidence** | HIGH -- follows validated v1.x extractor pattern |

**Why no new dependencies:** The existing codebase already does regex-based extraction of Elixir modules, proto definitions, GraphQL types, gRPC stubs, and event relationships. Service topology extraction is the same pattern applied to different file types:

| Topology Signal | File Pattern | Regex Target |
|-----------------|--------------|--------------|
| gRPC client calls | `*.ex` | `Stub.function_name` calls (already partially done via `grpcStubs` in elixir.ts) |
| HTTP client calls | `*.ex` | `HTTPoison.get/post`, `Tesla.get/post`, custom client module calls |
| Gateway routing | `config/*.exs`, `router.ex` | `forward "/path", ServiceModule` |
| Kafka producers | `*.ex` | `:brod.produce`, `KafkaEx.produce` patterns |
| Kafka consumers | `*.ex` | `Broadway` pipeline configs, `KafkaEx.stream` |

These all follow the same `extractXxx(repoPath, branch): XxxDefinition[]` pattern established by elixir.ts, proto.ts, events.ts. New edge types (`calls_http`, `routes_to`, `produces_kafka`, `consumes_kafka`) join the existing `calls_grpc`, `produces_event`, `consumes_event` edges.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Vector DB | sqlite-vec | Separate ChromaDB/Qdrant | Violates local-only, zero-infrastructure constraint. Adds operational complexity for ~10K vectors. |
| Vector DB | sqlite-vec | Manual brute-force in JS | Why reinvent? sqlite-vec is a single `load()` call and handles binary I/O efficiently in C. |
| Vector DB | sqlite-vec | @sqliteai/sqlite-vector | Newer competitor, less battle-tested. sqlite-vec has broader community adoption and the author (Alex Garcia) is the acknowledged authority on SQLite extensions. |
| Embeddings | Transformers.js | Ollama | Requires Ollama running as a daemon. Not zero-dependency. Heavier runtime for just embeddings. |
| Embeddings | Transformers.js | node-llama-cpp | GGUF-focused, designed for LLM inference not embeddings. |
| Embeddings | nomic-embed-text-v1.5 | OpenAI text-embedding-3-small | API-only. Local constraint. |
| CODEOWNERS | Custom regex | codeowners-utils | Unmaintained (last commit 2020), adds deps, does more than we need. |

## Installation

```bash
# New production dependencies
npm install sqlite-vec @huggingface/transformers

# No new dev dependencies needed
```

**Disk impact:**
- `sqlite-vec`: ~2MB (native binary per platform)
- `@huggingface/transformers`: ~15MB (includes onnxruntime-node)
- Model download (first run): ~130MB cached in `~/.kb/models/`

**Total new dependency weight:** ~17MB in node_modules, ~130MB cached model on first use

## Version Pinning Strategy

| Package | Pin Strategy | Reason |
|---------|-------------|--------|
| sqlite-vec | `^0.1.7-alpha.2` | Alpha -- pin to caret to get patch fixes but audit before minor bumps |
| @huggingface/transformers | `^3.8.1` | Stable v3 -- caret is safe. Do NOT use v4 preview yet. |

## Integration Points with Existing Code

### Database Layer (src/db/)
- `database.ts`: Add `sqliteVec.load(db)` call after opening database
- `schema.ts`: Bump SCHEMA_VERSION to 7
- `migrations.ts`: Add `migrateToV7()` creating vec_embeddings table + ownership tables

### Indexer Layer (src/indexer/)
- New files: `topology.ts` (HTTP/gateway/Kafka extractors), `codeowners.ts` (CODEOWNERS parser)
- `pipeline.ts`: Add topology extractor calls + CODEOWNERS extraction to `extractRepoData()`
- `writer.ts`: Add `TopologyEdgeData` type + persist functions

### Search Layer (src/search/)
- New file: `semantic.ts` (embedding generation + vec0 KNN queries)
- `index.ts`: Add semantic search pathway alongside FTS5

### CLI / MCP
- New commands: `kb owners <repo>`, `kb topology <repo>`
- New MCP tools: `kb_semantic_search`, `kb_owners`, `kb_topology`

## Sources

- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec) -- v0.1.6 stable, v0.1.7-alpha.2 npm
- [sqlite-vec Node.js docs](https://alexgarcia.xyz/sqlite-vec/js.html) -- better-sqlite3 integration
- [sqlite-vec KNN queries](https://alexgarcia.xyz/sqlite-vec/features/knn.html) -- MATCH + distance_metric=cosine
- [sqlite-vec-darwin-arm64 npm](https://www.npmjs.com/package/sqlite-vec-darwin-arm64) -- macOS ARM64 prebuilt
- [nomic-embed-text-v1.5 HuggingFace](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5) -- 137M params, 768d, Matryoshka
- [Transformers.js v3](https://huggingface.co/docs/transformers.js/en/index) -- @huggingface/transformers
- [Transformers.js Node.js tutorial](https://huggingface.co/docs/transformers.js/en/tutorials/node) -- server-side inference
- [Transformers.js dtypes guide](https://huggingface.co/docs/transformers.js/en/guides/dtypes) -- q8 quantization
- [codeowners-utils](https://github.com/jamiebuilds/codeowners-utils) -- evaluated and rejected (unmaintained)
- [CODEOWNERS format](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) -- GitHub official spec
- [Embedding model comparison (HN)](https://news.ycombinator.com/item?id=46081800) -- "Don't use all-MiniLM-L6-v2 for new datasets"
- [Best code embedding models](https://modal.com/blog/6-best-code-embedding-models-compared) -- VoyageCode3, CodeSage, Jina evaluated
- [Embedding model benchmarks](https://supermemory.ai/blog/best-open-source-embedding-models-benchmarked-and-ranked/) -- nomic vs MiniLM accuracy comparison
