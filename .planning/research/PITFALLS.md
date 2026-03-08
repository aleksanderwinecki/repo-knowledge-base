# Pitfalls Research: v2.0 Design-Time Intelligence

**Domain:** Adding embedding-based semantic search, service topology extraction, and CODEOWNERS parsing to an existing SQLite/FTS5 knowledge base
**Researched:** 2026-03-08
**Confidence:** HIGH (sqlite-vec integration, schema migration, codebase analysis), MEDIUM (embedding quality for code identifiers, topology extraction accuracy)

This document covers pitfalls specific to *adding three new feature pillars* to a working v1.2 system with 125K entities in SQLite, FTS5 search, and regex-based extractors. The risk profile is integration-heavy: every new feature must coexist with existing infrastructure without degrading it.

---

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or render entire feature pillars unusable.

### Pitfall 1: sqlite-vec Extension Loading Fails on macOS ARM64

**What goes wrong:**
You `npm install sqlite-vec` and call `sqliteVec.load(db)` on your better-sqlite3 connection. On CI or a colleague's x86 machine it works. On your M1/M2/M3 Mac, the extension either fails to load with a `dlopen` error about missing dylib files, or worse, loads successfully but uses the wrong architecture binary, producing corrupted vector data or segfaults during queries.

The `sqlite-vec-darwin-arm64` package (currently v0.1.7-alpha.2) provides prebuilt binaries, but the prebuilt discovery mechanism can fail when: (a) the npm install was done under Rosetta, (b) the Node.js binary is x86 running under Rosetta while the extension is ARM64, (c) the `DYLD_LIBRARY_PATH` isn't set correctly, or (d) better-sqlite3's bundled SQLite version is incompatible with the sqlite-vec extension's expected SQLite API version.

**Why it happens:**
sqlite-vec is pre-v1 (latest v0.1.6 stable, v0.1.7-alpha.2 for ARM64). The npm distribution uses optional platform-specific packages (`sqlite-vec-darwin-arm64`, `sqlite-vec-darwin-x64`, `sqlite-vec-linux-x64`) that the main `sqlite-vec` package selects at install time. This is the same pattern better-sqlite3 uses, but there's an additional complexity: sqlite-vec must be ABI-compatible with the SQLite version bundled inside better-sqlite3 (currently SQLite 3.46+ in better-sqlite3 v12). If these drift apart, the extension loads but corrupts memory.

**How to avoid:**
1. **Validate extension loading in the very first PR.** Before writing any vector search code, create a minimal smoke test: `sqliteVec.load(db); db.exec("CREATE VIRTUAL TABLE test USING vec0(v float[4])"); db.prepare("INSERT INTO test VALUES (?, ?)").run(1, new Float32Array([1,2,3,4]).buffer);` -- this must pass on macOS ARM64.
2. **Pin exact versions** of both `better-sqlite3` and `sqlite-vec` in package.json. Don't use `^` ranges for sqlite-vec. Document the validated combination.
3. **Add a runtime compatibility check** in `openDatabase()` that detects when sqlite-vec fails to load and falls back gracefully -- vector search becomes unavailable, but FTS5 keyword search continues working. Never crash the entire CLI because a vector extension didn't load.
4. **If the prebuilt approach fails**, have a fallback plan: brute-force cosine distance on a regular BLOB column, or consider `@dao-xyz/sqlite3-vec` as an alternative wrapper that handles prebuilt binary discovery automatically for better-sqlite3 >= 12.

**Warning signs:**
- `npm install` succeeds but `vec_version()` throws at runtime
- Tests pass on one developer's machine but fail on another
- `dlopen` errors mentioning `.dylib` or architecture mismatches in stderr
- Segfaults or bus errors during vector insert/query operations

**Phase to address:** Phase 1 (Foundation). Extension loading validation must be the gating criterion before any vector table creation code is written.

---

### Pitfall 2: Embedding Dimensions Blow Up Database Size and Query Latency

**What goes wrong:**
You choose a high-quality embedding model (OpenAI `text-embedding-3-large` at 3072 dimensions, or `nomic-embed-code` at 768 dimensions) and embed all 125K entities. Each float32 vector at 768 dimensions is 3KB. At 125K entities, that's ~375MB of vector data alone -- larger than the entire existing database. At 3072 dimensions, it's 1.5GB. sqlite-vec uses brute-force search (no ANN index yet), so query time scales linearly with both entity count and dimensions. At 125K entities x 768 dimensions, each query scans ~375MB of vector data.

Per sqlite-vec benchmarks: 100K vectors at 768 dimensions with float32 queries in <75ms, but at 1M vectors the same query takes seconds. At 125K entities we're in the zone where dimension choice determines whether queries complete in 50ms or 500ms.

**Why it happens:**
Developers choose embedding dimensions based on quality benchmarks without considering storage and query cost. sqlite-vec v0.1.x only supports brute-force KNN search -- there's no approximate nearest neighbor (ANN) indexing. The author explicitly states it "scales to tens of thousands or maybe hundreds of thousands" of vectors practically. At 125K entities you're at the upper bound of what brute-force can handle, and dimension count is the multiplier.

**How to avoid:**
1. **Use 384-dimension embeddings.** OpenAI's `text-embedding-3-small` supports dimension truncation to 384 via the `dimensions` parameter. At 384 dims x 125K entities = ~187MB, with query times well under 75ms per sqlite-vec benchmarks.
2. **Don't embed everything.** Not every entity benefits from semantic search. Embed entity names + descriptions (which are already in FTS5), not raw code or schema definitions. This may reduce the embeddable set to 50-80K entities.
3. **Use binary quantization** if storage or latency is still an issue. sqlite-vec supports int8 and binary vectors, offering 4x and 32x size reduction respectively with ~95% accuracy retention on modern embedding models. Binary quantized vectors query in under 11ms even at 3072 dimensions.
4. **Benchmark early.** Before embedding all 125K entities, embed 1K, measure insert time, query latency, and database size growth. Extrapolate. If the numbers don't work at 1K, they won't work at 125K.

**Warning signs:**
- Database file grows by more than 200MB after vector indexing
- Semantic search queries take >200ms
- WAL file grows very large during vector insertion (sqlite-vec inserts are transaction-heavy)
- Machine memory pressure increases during vector queries

**Phase to address:** Phase 1 (Foundation). Dimension choice and entity selection must be decided before any embedding pipeline is built.

---

### Pitfall 3: Embedding Quality Is Terrible for Code Identifiers Without Preprocessing

**What goes wrong:**
You embed entity names like `BookingContext.Commands.CreateBooking` or `Rpc.Booking.V1.BookingService.Stub` directly. The embedding model was trained on natural language, not Elixir module paths. It treats `BookingContext.Commands.CreateBooking` as a single opaque token or splits it poorly. A semantic query for "service that handles bookings" returns irrelevant results because the model doesn't understand that `BookingContext` relates to "booking" and `.Commands.` relates to "commands."

Meanwhile, your existing FTS5 search with `tokenizeForFts()` correctly splits `BookingContext.Commands.CreateBooking` into `"booking context commands create booking"` and finds it easily. The expensive new embedding search performs worse than the free FTS5 search you already have.

**Why it happens:**
General-purpose embedding models (even code-specific ones like `nomic-embed-code`, `jina-embeddings-v2-base-code`, or `CodeRankEmbed`) are optimized for natural language queries matching against code snippets or docstrings. They're trained on `docstring-to-code` and `code-to-code` retrieval tasks -- not on `natural-language-to-module-name` retrieval. Elixir module naming conventions (CamelCase.Dot.Separated), proto message names (CamelCase), and snake_case function names are edge cases in their training data.

**How to avoid:**
1. **Embed the preprocessed text, not the raw identifier.** You already have `tokenizeForFts()` that turns `BookingContext.Commands.CreateBooking` into `"booking context commands create booking"`. Use the tokenized form as input to the embedding model. This bridges the vocabulary gap.
2. **Embed name + description together.** Concatenate the tokenized name with the entity's description/summary. A module with `name: "BookingContext.Commands.CreateBooking"` and `summary: "Creates a new booking in the system"` should be embedded as `"booking context commands create booking - Creates a new booking in the system"`.
3. **Build an evaluation set before choosing a model.** Create 20 queries that users would actually ask ("which service handles payments", "how do bookings work", "what events does the gateway produce") with expected results. Test candidate models against this set. Don't choose based on MTEB leaderboard scores -- they measure different tasks.
4. **Hybrid search is the correct architecture.** FTS5 for keyword matching + vector search for semantic similarity, with results merged. Never rely on embedding search alone -- it will always miss exact keyword matches that FTS5 catches instantly.

**Warning signs:**
- FTS5 search returns better results than embedding search for most queries
- Queries using exact entity names (e.g., `kb search "BookingService"`) return worse results in semantic mode
- Embedding similarity scores cluster tightly (everything is 0.7-0.8 similar to everything else)

**Phase to address:** Phase 1-2 (Embedding pipeline). Preprocessing pipeline and evaluation set must exist before model selection is finalized.

---

### Pitfall 4: Schema Migration Breaks Existing Databases When Adding Vector Tables

**What goes wrong:**
You add migration V7 that creates a `vec0` virtual table for embeddings. The migration runs fine on a fresh database. But on an existing v1.2 database (schema version 6), the migration fails because: (a) `vec0` module isn't registered yet (sqlite-vec hasn't been loaded when the migration runs), (b) the migration is inside `runMigrations()` which runs before the extension is loaded in the startup sequence, or (c) the extension loads but `CREATE VIRTUAL TABLE` for vec0 can't execute inside the transaction wrapper that `runMigrations()` uses.

**Why it happens:**
The current initialization sequence in `openDatabase()` is: (1) create Database, (2) set pragmas, (3) `initializeSchema()` which runs migrations wrapped in `db.transaction()`, (4) `initializeFts()`. sqlite-vec must be loaded via `sqliteVec.load(db)` BEFORE any SQL that references vec0 tables. But the migration system doesn't know about extension loading -- it assumes all SQL features are available when migrations run. The existing `initializeFts()` already works around this by creating the FTS5 virtual table outside the migration transaction -- vec0 needs the same treatment.

**How to avoid:**
1. **Load sqlite-vec BEFORE `initializeSchema()`.** Change `openDatabase()` to: (1) create Database, (2) set pragmas, (3) try to load sqlite-vec, (4) `initializeSchema()`, (5) `initializeFts()`, (6) `initializeVec()`. Extension loading before migrations is order-critical.
2. **Don't put vec0 creation in a migration.** Migrations should only handle regular tables (the `entity_embeddings` metadata table tracking which entities have been embedded, model version, etc.). The vec0 virtual table creation belongs in an idempotent initialization step, following the exact pattern of `initializeFts()`.
3. **Handle extension-not-available gracefully.** If sqlite-vec fails to load (missing binary, incompatible platform), skip vec0 initialization. The regular schema and FTS5 must still work. Add a `hasVectorSupport(): boolean` function that downstream code checks.
4. **Test migration on a copy of the production database.** Copy `~/.kb/knowledge.db` (a real v1.2 database with 125K entities), run the new `openDatabase()` against it, verify everything works.

**Warning signs:**
- `openDatabase()` throws "no such module: vec0" on existing databases
- Migration works on fresh databases but fails on upgraded ones
- Tests with in-memory databases work but file-based databases fail
- Migration function calls `db.loadExtension()` -- extension loading should happen once at startup, not inside migrations

**Phase to address:** Phase 1 (Foundation). Startup sequence change must be the first PR, before any vec0 code.

---

### Pitfall 5: Topology Extraction Regex Misses Dynamic Service Communication Patterns

**What goes wrong:**
You write regex extractors for gRPC clients (already partially done via `extractGrpcStubs()`), HTTP clients, gateway routing, and Kafka wiring. The extractors work on the 10 repos you tested against. Then you run `kb index --force` across all 400+ repos and discover: (a) 30% of HTTP client calls use environment-variable-based URLs (`System.get_env("BOOKING_SERVICE_URL")`) that regex can't resolve, (b) gateway routing is defined in YAML/JSON config files, not code, (c) Kafka topic names are constructed dynamically (`"#{@topic_prefix}.booking.created"`), and (d) some services communicate via shared database access, not HTTP/gRPC at all.

The topology graph looks confident but is actually missing 30-50% of real service connections. Users trust the graph, make architectural decisions based on it, and discover the gaps the hard way.

**Why it happens:**
Microservice communication patterns are inherently dynamic. The existing extractors (`extractGrpcStubs`, `detectEventRelationships`) work because they target well-structured, convention-following patterns in proto files and Elixir macros. But HTTP client calls, config-driven routing, and dynamic topic names don't follow single patterns across 400 repos. Each team does it differently. Regex extraction works for the common case but can't handle the long tail.

**How to avoid:**
1. **State confidence level with each edge.** Every extracted topology edge should have a `confidence: 'high' | 'medium' | 'low'` field. High = extracted from proto files, explicit gRPC stub references. Medium = pattern-matched from code heuristics. Low = inferred from config or naming conventions. Let consumers filter by confidence.
2. **Start with patterns you can detect reliably:** gRPC stubs (already have this), Kafka topic declarations in module attributes (`@topic "booking.created"`), explicit HTTP client module patterns (Tesla.Middleware.BaseUrl). Don't try to resolve environment variables or dynamic string interpolation.
3. **Add a `kb learn` extension for manual topology.** When regex can't detect a connection, let users teach it: `kb learn "booking-service calls payment-service via HTTP" --repo booking-service --type topology`. This fills gaps the extractors miss.
4. **Ship topology with an explicit completeness metric.** After extraction, report: "Found N edges from M repos. K repos have no outbound edges detected." Repos with zero detected outbound connections are likely missing connections, not truly isolated.
5. **Filter out comments, test files, and documentation strings** from extraction. These are the primary source of false positives.

**Warning signs:**
- Repos known to call many services show zero or one outbound edge
- The topology graph has isolated clusters with no connections to the rest
- HTTP client extraction returns results for only 20-30% of repos
- All detected connections are gRPC with no HTTP or Kafka edges

**Phase to address:** Phase 2-3 (Topology extractors). Each extractor type should be a separate deliverable with its own accuracy assessment.

---

### Pitfall 6: CODEOWNERS Pattern Matching Is Not Gitignore (Despite Looking Like It)

**What goes wrong:**
You implement a CODEOWNERS parser using a gitignore library (like `ignore` or `minimatch`). It works for simple patterns (`*.ex @team-backend`, `/docs/* @team-docs`). Then you hit edge cases: (a) `docs/*` should match `docs/getting-started.md` but NOT `docs/build-app/troubleshooting.md` -- gitignore `*` matches across directories, but CODEOWNERS `*` only matches one level deep, (b) `!` negation patterns silently do nothing in CODEOWNERS (GitHub drops them), (c) `[]` character ranges don't work in GitHub CODEOWNERS, (d) the last matching rule wins (not first), and (e) a trailing `/` means the pattern matches the entire directory tree (equivalent to `/**`).

Your parser produces wrong ownership mappings for 10-20% of files because the glob semantics are subtly different from both gitignore and standard globbing.

**Why it happens:**
GitHub's CODEOWNERS documentation says it "follows most of the same rules used in gitignore files" -- the key word being "most." The differences are specific and underdocumented: no negation (`!`), no character ranges (`[]`), no `\#` escaping, and different `*` vs `**` semantics. Every CODEOWNERS parser library has had bugs around nested directory matching (see `beaugunderson/codeowners` issue #15 about incorrect nested match rules).

**How to avoid:**
1. **Don't use a gitignore library for CODEOWNERS parsing.** Use picomatch with careful configuration, or write a dedicated matcher that handles the GitHub-specific semantics.
2. **Test with real CODEOWNERS files from your repos.** Take 5-10 actual CODEOWNERS files from the indexed repos, manually determine expected ownership for 10 files each, and assert the parser matches.
3. **Implement "last match wins" correctly.** Store `line_number` in the ownership data. Process all rules top-to-bottom, let later rules override earlier ones. Test with overlapping patterns.
4. **Handle missing CODEOWNERS gracefully.** Many repos won't have a CODEOWNERS file. Some will have it in `.github/CODEOWNERS`, others in `CODEOWNERS` at root, others in `docs/CODEOWNERS`. Check all three locations per GitHub's spec.
5. **Validate patterns at parse time.** If a CODEOWNERS line has invalid syntax, skip it (matching GitHub's behavior) rather than throwing. Log skipped lines.

**Warning signs:**
- Ownership queries return different teams than GitHub's PR review assignments
- Files in nested directories show unexpected ownership (the `*` vs `**` trap)
- Parser fails on patterns with `!` or `[]` characters instead of ignoring them
- Tests only cover flat directory structures, not deeply nested paths

**Phase to address:** Phase 2 (CODEOWNERS parser). Dedicated test suite with real CODEOWNERS files must exist before the parser is integrated.

---

## Moderate Pitfalls

### Pitfall 7: Breaking Existing Edge Semantics with Topology Edges

**What goes wrong:**
Topology extractors create edges with new relationship types (`calls_http`, `routes_to`, `produces_kafka`, `consumes_kafka`), but `queryDependencies()` in `search/dependencies.ts` is likely hardcoded to only follow specific relationship types (`produces_event`, `consumes_event`, `calls_grpc`). New edges exist in DB but don't appear in dependency queries. Users see no improvement from v2.0 topology work.

**How to avoid:**
1. Generalize `findLinkedRepos()` / dependency queries to discover ALL relationship types, or use a configurable set
2. Define the topology edge type vocabulary before building extractors: `calls_grpc`, `calls_http`, `routes_to`, `produces_kafka`, `consumes_kafka`
3. Use the existing `calls_grpc` type -- don't invent a new one for the same concept
4. Add a UNIQUE constraint on `(source_type, source_id, target_type, target_id, relationship_type)` to prevent duplicate edges
5. Coordinate with existing `insertGrpcClientEdges()` in pipeline.ts -- either replace it or document the overlap

**Phase to address:** Phase 2 (Topology extractors). Edge schema design must precede any extractor implementation.

---

### Pitfall 8: Embedding Pipeline Blocks the Indexing Flow

**What goes wrong:**
You add embedding generation to the indexing pipeline. For each entity, you call an embedding API (or local model) to generate a vector, then insert it into the vec0 table. With 125K entities and an API that takes 50ms per call, that's 104 minutes for embeddings -- turning a 2-minute index into a 2-hour ordeal. Or with a local model at 200ms per entity, it's 7 hours. The existing `extractRepoData()` is designed for parallel extraction with no blocking operations -- embedding inference (CPU-bound ONNX) or API calls (network-bound) in this phase would destroy the pipeline's concurrency.

**How to avoid:**
1. **Decouple embedding from indexing.** Indexing creates/updates entities in regular tables and FTS5 (as now). A separate `kb embed` command generates vectors asynchronously. This preserves the current indexing speed.
2. **Batch API calls.** OpenAI's embedding API accepts batches (up to ~300K tokens per request). Batch 100-200 entity texts per API call instead of one-by-one.
3. **Incremental embedding.** Track which entities have been embedded via content hash. On re-index, only embed new/changed entities.
4. **If using a local model**, it runs in a separate phase (Phase 4 of the pipeline, after all persistence is complete), not inside `extractRepoData()` or `persistExtractedData()`.

**Phase to address:** Phase 2 (Embedding pipeline). Architecture decision on separation is critical early.

---

### Pitfall 9: Hybrid Search Result Merging Produces Confusing Rankings

**What goes wrong:**
You implement hybrid search: run both FTS5 keyword search and vector similarity search, then merge results. But FTS5 returns BM25 relevance scores (negative numbers, lower is better, unbounded) and sqlite-vec returns cosine distance (0-2, lower is better). You normalize both to 0-1, apply equal weights, and merge. The result: exact keyword matches get diluted by mediocre vector matches, and great semantic matches get diluted by poor keyword matches. Users search for "BookingService" and the exact match appears at position 3 instead of position 1.

**How to avoid:**
1. **Keyword-first architecture.** If FTS5 returns an exact name match, always rank it #1 regardless of vector score. Embedding search augments keyword search; it doesn't replace it.
2. **Use reciprocal rank fusion (RRF)** instead of score normalization: `1/(k + rank_fts) + 1/(k + rank_vec)` with k=60. This is position-aware and doesn't require normalizing incomparable score scales.
3. **Let users control the mode.** `kb search "query"` uses FTS5 (fast, exact). `kb search "query" --semantic` adds vector results. Don't force hybrid on every query -- most queries are keyword-based and FTS5 is better for those.

**Phase to address:** Phase 3 (Search integration). Design hybrid ranking after both FTS5 and vector search work independently.

---

### Pitfall 10: sqlite-vec Pre-v1 Breaking Changes Corrupt Existing Vector Data

**What goes wrong:**
You ship v2.0 with sqlite-vec v0.1.6. Months later, sqlite-vec releases v0.2.0 with a breaking change to the vec0 shadow table format. Users update their npm dependencies and suddenly vec0 queries return garbage or crash. The regular database (entities, FTS5) is fine, but all vector data is unreadable. There's no migration path because sqlite-vec doesn't provide one -- it's pre-v1, breaking changes are expected.

**How to avoid:**
1. **Pin sqlite-vec to an exact version** in package.json. Document the pinned version.
2. **Store the sqlite-vec version in the database** (e.g., in a `meta` table). On startup, compare runtime version to stored version. If mismatched, warn the user and offer to regenerate vectors.
3. **Design vector storage as regenerable.** Vector data is derived from entity text -- it can always be regenerated. Never treat vector data as primary storage.
4. **Isolate vec0 tables from core schema.** If vec0 corruption occurs, it must be possible to drop and rebuild without affecting entities, FTS5, or learned facts.

**Phase to address:** Phase 1 (Foundation). Version tracking and regeneration design are part of initial architecture.

---

### Pitfall 11: API Embedding Costs Spiral on Full Re-Index

**What goes wrong:**
You use OpenAI `text-embedding-3-small` ($0.02/1M tokens). Initial embedding of 125K entities costs ~$2-5. Then a user runs `kb index --force` which re-indexes everything, and entity IDs change during full re-index (because `clearRepoEntities()` deletes and re-inserts). The embedding pipeline detects "new" entities and re-embeds all 125K. Every full re-index costs another $2-5. Weekly during active development: $100+/year for a local dev tool.

**How to avoid:**
1. **Content-hash based embedding cache.** Hash the text that was embedded. If the text hasn't changed (even if the entity ID changed), reuse the cached vector. Store: `(content_hash, model_version, vector)`.
2. **Support local models as the default.** A local model like `CodeRankEmbed` (521MB, MIT license) has zero marginal cost. Use it as default, with OpenAI as opt-in for higher quality.
3. **Track embedding cost.** If using an API, log token count per embedding batch and display in `kb status`.
4. **Never re-embed unchanged text.** Compare content hashes, not entity IDs or timestamps.

**Phase to address:** Phase 2 (Embedding pipeline). Content-hashing must be in the initial design.

---

### Pitfall 12: vec0 Table Can't Be Created Inside Transaction

**What goes wrong:**
SQLite virtual table creation often can't happen inside an explicit transaction. The existing migration system wraps all migrations in `db.transaction(() => { ... })`. If a migration step creates vec0 inside this transaction, it may fail silently or throw.

**How to avoid:**
Run vec0 table creation outside the migration transaction, in a separate idempotent initialization step. The existing `initializeFts()` already establishes this pattern -- it creates the FTS5 virtual table outside the migration transaction. Create `initializeVec()` that follows the identical pattern.

**Phase to address:** Phase 1 (Foundation). Follow the `initializeFts()` pattern exactly.

---

### Pitfall 13: Entity Embedding IDs Collide Across Entity Types

**What goes wrong:**
vec0 needs integer primary keys. If you naively use entity table IDs (module.id=5, event.id=5), they collide in the vec0 table because different entity types have independent auto-increment sequences.

**How to avoid:**
Use a dedicated `entity_embeddings` mapping table as the authoritative ID source. Its auto-increment `id` becomes the vec0 primary key. The table maps `(id) -> (entity_type, source_entity_id, content_hash, model_version)`. Never use source table IDs directly in vec0.

**Phase to address:** Phase 1 (Foundation). Part of the embedding schema design.

---

### Pitfall 14: Embedding Model Download Blocks First-Time Use

**What goes wrong:**
If using a local model, first `kb embed` triggers an 80-500MB model download. If the user is offline, on a slow connection, or doesn't expect it, the command appears hung or fails.

**How to avoid:**
1. Print clear progress: "Downloading embedding model (Xmb, one-time)..."
2. Set a timeout on the download
3. If download fails, abort with a clear error, not a cryptic exception
4. Support `KB_SKIP_EMBEDDINGS=1` env var for CI/testing
5. Consider a `kb setup` command that pre-downloads the model

**Phase to address:** Phase 2 (Embedding pipeline). UX consideration during model integration.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Embedding all entities at once on first run | Simple one-shot pipeline | 10+ minute blocking operation; bad first-run experience | Only for local models with progress bar; never for API models |
| Storing vectors in the main database file | Single file, simple deployment | Database file doubles in size; backups take longer; WAL checkpoints slower | Acceptable at 384 dims; unacceptable at 768+ dims |
| Using OpenAI API as the only embedding provider | Highest quality, simplest integration | Vendor lock-in; costs money; requires internet; fails offline | Only as opt-in, never default; local model must be default |
| Skipping content-hash dedup for vectors | Simpler embedding pipeline | Re-embeds unchanged content on every force re-index; wastes money/time | Only in initial prototype; must add before shipping |
| Hardcoding CODEOWNERS file locations | Covers 95% of repos | Misses non-standard locations | Acceptable if checking `.github/CODEOWNERS`, `CODEOWNERS`, and `docs/CODEOWNERS` |
| Regex-only topology extraction | Works for well-structured codebases | Misses dynamic routing, config-driven connections, env-var URLs | Acceptable if confidence levels are surfaced; combine with `kb learn` for gaps |
| Separate `kb embed` command instead of auto-embedding | Simpler architecture; user controls when to embed | Extra manual step; vectors can become stale | Correct for v2.0 -- auto-embedding is v2.1 optimization |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| sqlite-vec + better-sqlite3 | Loading extension after schema initialization; vec0 creation fails | Load extension immediately after `new Database()`, before `initializeSchema()` |
| sqlite-vec + WAL mode | vec0 inserts may hold locks longer than regular inserts | Batch vec0 inserts in transactions of 1000; test with concurrent CLI usage |
| FTS5 + vec0 in same query | Trying to JOIN FTS5 and vec0 results in a single SQL statement | Run as two separate queries, merge in application code; virtual tables can't be joined efficiently |
| Embedding API + Node.js | Calling embedding API synchronously or one-by-one | Use async/await with p-limit for concurrent batched API calls |
| CODEOWNERS + git branch reads | Reading CODEOWNERS from working directory instead of git branch | Use existing `readBranchFile()` from the same branch used for extraction |
| New topology edges + existing gRPC edges | New topology extractor duplicates edges from `insertGrpcClientEdges()` | Migrate existing gRPC edge insertion into the new topology framework; don't create a parallel system |
| Vector dimensions + model changes | Changing embedding model (different dimensions) with existing vector data | Track model version per-embedding; rebuild vec0 table when model changes |
| Transformer.js versions | Using deprecated `@xenova/transformers` (v2) instead of `@huggingface/transformers` (v3) | Pin to `@huggingface/transformers` ^3.x; v3 changed the package name and import paths |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Embedding 125K entities sequentially via API | Index takes hours; API rate limits hit | Batch 100+ texts per API call; use concurrent batches | Immediately at >1000 entities |
| Using 768+ dimension float32 vectors with brute-force search | Query latency >200ms; database file >500MB | Use 384 dimensions or binary quantization | At 50K+ entities |
| Running embedding inside `extractRepoData()` pipeline phase | p-limit concurrency pool blocked; other repos stall | Embedding is a separate post-persistence phase | At any entity count |
| Full vec0 table scan on every semantic query | Embedding search slower than FTS5 | Pre-filter with FTS5, then rank top-K with vectors | At 10K+ vectors |
| Not batching vec0 inserts in a transaction | Insert 125K vectors takes 30+ minutes | Wrap batches of 1000 inserts in a single transaction | At 1K+ vectors |
| `VACUUM` after adding vectors | Blocks all reads/writes; rewrites entire file; doubles disk usage temporarily | WAL + incremental writes keep things compact; VACUUM is almost never needed | At any scale |

## "Looks Done But Isn't" Checklist

- [ ] **sqlite-vec loading:** Extension loads on macOS ARM64 AND x86_64 AND Linux x64 -- test all target platforms
- [ ] **Vector search quality:** Semantic search outperforms FTS5 on >50% of natural-language queries in evaluation set -- if not, the feature isn't providing value
- [ ] **Embedding staleness:** After `kb index --force`, vectors match current entity content (content hash check) or are flagged as stale
- [ ] **Topology completeness:** Manual verification of 10 known service connections across 5 repos -- if <70% are found, extractors need work
- [ ] **CODEOWNERS accuracy:** Compare parser output against GitHub's actual PR review assignments for 5 PRs
- [ ] **Hybrid search ranking:** Exact name matches rank #1 even with hybrid search enabled
- [ ] **Graceful degradation:** When sqlite-vec is unavailable, all existing v1.2 functionality works identically -- remove extension, run full test suite
- [ ] **Migration safety:** Opening a v2.0 database with a v1.2 binary doesn't crash -- it should ignore unknown tables
- [ ] **Edge schema consistency:** New topology edge types documented and consistent with existing `calls_grpc`, `produces_event`, `consumes_event` types
- [ ] **Cost tracking:** If using API embedding model, `kb status` shows total tokens embedded and estimated cost
- [ ] **Dependency query updates:** `kb deps` returns new topology edge types, not just existing event/gRPC edges

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| sqlite-vec extension won't load | LOW | Fall back to FTS5-only search; no data loss; investigate platform binary |
| Vector data corrupted by sqlite-vec upgrade | LOW | Drop vec0 table; re-run `kb embed`; entity data unaffected |
| Embeddings are low quality | MEDIUM | Change preprocessing; change model; re-run `kb embed`; update model version in meta |
| Topology edges wrong/incomplete | LOW | Re-run `kb index --force`; topology edges regenerated on every index |
| CODEOWNERS parser wrong results | LOW | Fix parser; re-run `kb index --force`; ownership data regenerated |
| Database file too large from vectors | MEDIUM | Reduce dimensions; use quantization; or move vec0 to separate db file |
| Embedding costs too high | LOW | Switch to local model; re-embed; entity data unaffected |
| Schema migration fails on upgrade | HIGH | Backup database before upgrade; restore backup; fix migration code |
| Hybrid search ranking worse than FTS5 alone | LOW | Disable vector component via `--no-semantic`; FTS5 continues working |
| Embedding pipeline blocks indexing | LOW | Move embedding to separate `kb embed` command; `kb index` stays fast |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| sqlite-vec ARM64 loading (#1) | Phase 1 (Foundation) | Smoke test passes on macOS ARM64 with `vec_version()` |
| Dimension/size blowup (#2) | Phase 1 (Foundation) | 1K entity benchmark; extrapolate; database growth <200MB target |
| Embedding quality for code (#3) | Phase 1-2 (Embedding) | 20-query evaluation set; semantic outperforms FTS5 on >50% of NL queries |
| Schema migration + vec0 (#4) | Phase 1 (Foundation) | `openDatabase()` succeeds on both fresh and existing v1.2 databases |
| Topology regex accuracy (#5) | Phase 2-3 (Topology) | Manual check 10 known connections; >70% detection rate |
| CODEOWNERS glob semantics (#6) | Phase 2 (CODEOWNERS) | Real CODEOWNERS files test suite; matches GitHub behavior |
| Breaking edge semantics (#7) | Phase 2 (Topology) | `kb deps` returns new topology types; integration test |
| Embedding blocks indexing (#8) | Phase 2 (Embedding) | `kb index --force` completes in <10 min (same as v1.2) |
| Hybrid ranking confusion (#9) | Phase 3 (Search) | Exact matches always rank #1; RRF tested |
| sqlite-vec breaking changes (#10) | Phase 1 (Foundation) | Version stored in DB; mismatch detected; re-embed pathway works |
| API cost spiral (#11) | Phase 2 (Embedding) | Content-hash dedup; second `kb embed` on unchanged data takes <10s |
| vec0 in transaction (#12) | Phase 1 (Foundation) | `initializeVec()` follows `initializeFts()` pattern |
| Entity ID collision (#13) | Phase 1 (Foundation) | `entity_embeddings` mapping table with own auto-increment |
| Model download blocks UX (#14) | Phase 2 (Embedding) | Progress bar; timeout; graceful failure |

## Sources

- [sqlite-vec GitHub repository](https://github.com/asg017/sqlite-vec) - Pre-v1 status, brute-force only, breaking changes warning (HIGH confidence)
- [sqlite-vec v0.1.0 stable release blog](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html) - Performance benchmarks, binary quantization, dimension scaling (HIGH confidence)
- [sqlite-vec Node.js documentation](https://alexgarcia.xyz/sqlite-vec/js.html) - better-sqlite3 integration API, Float32Array usage (HIGH confidence)
- [sqlite-vec-darwin-arm64 npm](https://www.npmjs.com/package/sqlite-vec-darwin-arm64) - v0.1.7-alpha.2 prebuilt ARM64 binary (HIGH confidence)
- [sqlite-vec macOS ARM64 issue #189](https://github.com/asg017/sqlite-vec/issues/189) - dlopen errors, DYLD_LIBRARY_PATH workaround (HIGH confidence)
- [@dao-xyz/sqlite3-vec npm](https://www.npmjs.com/package/@dao-xyz/sqlite3-vec) - Alternative wrapper, auto-loads prebuilt extension (MEDIUM confidence)
- [6 Best Code Embedding Models Compared](https://modal.com/blog/6-best-code-embedding-models-compared) - VoyageCode3, CodeRankEmbed, Jina Code V2 comparison (MEDIUM confidence)
- [Nomic Embed Code on Hugging Face](https://huggingface.co/nomic-ai/nomic-embed-code) - 768 dimensions, code retrieval (MEDIUM confidence)
- [GitHub CODEOWNERS documentation](https://docs.github.com/articles/about-code-owners) - Pattern rules, last-match-wins, file locations (HIGH confidence)
- [Understanding GitHub CODEOWNERS (Graphite)](https://graphite.com/guides/in-depth-guide-github-codeowners) - Edge cases, differences from gitignore (MEDIUM confidence)
- [Incorrect nested match rules - codeowners #15](https://github.com/beaugunderson/codeowners/issues/15) - Parser bugs in npm library (HIGH confidence)
- [OpenAI Embedding API pricing](https://developers.openai.com/api/docs/pricing) - $0.02/1M tokens for text-embedding-3-small (HIGH confidence)
- [better-sqlite3 API docs](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) - loadExtension API (HIGH confidence)
- [Transformers.js v3 migration](https://huggingface.co/blog/transformersjs-v3) - Package rename from @xenova/transformers (MEDIUM confidence)
- Direct codebase analysis: `src/db/database.ts`, `src/db/schema.ts`, `src/db/migrations.ts`, `src/db/fts.ts`, `src/db/tokenizer.ts`, `src/indexer/pipeline.ts`, `src/indexer/writer.ts`, `src/indexer/elixir.ts`, `src/search/dependencies.ts`, `package.json` (HIGH confidence)

---
*Pitfalls research for: v2.0 Design-Time Intelligence (embedding search, service topology, CODEOWNERS)*
*Researched: 2026-03-08*
*Supersedes: v1.2 pitfalls from 2026-03-07 (those covered refactoring risks; this covers new feature integration risks)*
