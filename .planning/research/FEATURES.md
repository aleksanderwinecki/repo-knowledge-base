# Feature Landscape: v1.1 Improved Reindexing & New Extractors

**Domain:** Codebase knowledge base / code intelligence for local microservice indexing
**Researched:** 2026-03-06
**Scope:** Incremental improvements to existing v1.0 tool (8,193 LOC, 236 tests)

## Table Stakes

Features that v1.1 should deliver to feel like a meaningful upgrade over v1.0.

| Feature | Why Expected | Complexity | Depends On |
|---------|--------------|------------|------------|
| **Branch-aware git tracking** | v1.0 indexes whatever branch is checked out -- if a dev is on a feature branch, the KB gets polluted with WIP code. Every CI-adjacent tool tracks main/master only. | LOW | Existing `git.ts` module |
| **Surgical file-level re-indexing** | v1.0 wipes and rewrites all entities for a repo on every index, even for incremental. The `clearRepoEntities` call in `persistRepoData` defeats the purpose of `getChangedFiles`. Users expect changed-file-only updates. | MEDIUM | Branch-aware tracking, existing `clearRepoFiles` |
| **Parallel repo indexing** | Indexing 50+ repos sequentially is slow. Users expect concurrency from a v1.1 that's about "improved reindexing". | LOW-MEDIUM | Surgical indexing (to avoid DB contention) |
| **Ecto schema extraction** | v1.0 already detects `schema "table_name"` in its Elixir parser but doesn't extract fields, associations, or store them as first-class entities. This is low-hanging fruit given the existing regex infrastructure. | MEDIUM | Existing `elixir.ts` extractor |

## Differentiators

Features that add new knowledge dimensions not available in v1.0.

| Feature | Value Proposition | Complexity | Depends On |
|---------|-------------------|------------|------------|
| **GraphQL schema extraction** | Index types, queries, mutations, subscriptions from `.graphql` SDL files and Absinthe `.ex` macros. Answers "what API surface does this service expose?" -- a question devs ask constantly. | MEDIUM | New extractor, schema migration |
| **gRPC service definition extraction** | v1.0 extracts proto messages but ignores `service` blocks and their RPCs. The proto parser already has `extractServices()` and `ProtoService`/`ProtoRpc` types -- they're just not persisted. Wire it up. | LOW | Existing `proto.ts` (services already parsed) |
| **Event Catalog integration** | Fresha has a `fresha-event-catalog` repo with curated JSON files: `events.json` (5,721 lines), `services.json` (1,001 lines), `rpcs.json` (6,520 lines). These contain domain ownership, event descriptions, consumer/producer mappings, and proto schemas that are richer than what the KB extracts from raw code. | MEDIUM | New data source, schema for catalog metadata |

## Anti-Features

Features to explicitly NOT build in v1.1.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Worker thread parallelism** | better-sqlite3 cannot share connections across threads. Worker threads would require each thread to open its own DB connection, and writes still serialize at the SQLite level. The bottleneck is I/O (filesystem scanning), not CPU. | Use `Promise.all` with `p-limit` for concurrent filesystem reads, serialize DB writes on main thread. |
| **Full AST parsing for Elixir** | Would require an Elixir parser in JS (doesn't exist) or shelling out to `mix`. The regex approach in `elixir.ts` handles the well-structured patterns at Fresha. | Extend regex patterns for Ecto fields/associations and Absinthe macros. |
| **GraphQL introspection from running services** | Would require services to be running, auth tokens, network access. Violates local-only constraint. | Parse `.graphql` SDL files and Absinthe source files statically. |
| **EventCatalog SDK integration** | The `@eventcatalog/sdk` requires the catalog to be built and provides an API for reading/writing catalog entities. Overkill -- the raw JSON source files are simpler and contain everything needed. | Read the JSON source files directly from the `fresha-event-catalog` repo. |
| **Real-time file watching for re-index** | Already out of scope per PROJECT.md. On-demand indexing is sufficient. | Keep existing on-demand `kb index` and MCP auto-sync patterns. |

## Detailed Feature Specifications

### 1. Branch-Aware Git Tracking (main/master only)

**What it does:** When indexing, always resolve to the main/master branch HEAD, regardless of what branch is currently checked out locally.

**Expected behavior:**
- Determine the default branch name for each repo (could be `main`, `master`, or custom)
- Use `git rev-parse origin/main` or `git rev-parse origin/master` to get the default branch HEAD
- Compare against stored `last_indexed_commit` using the default branch SHA, not the checked-out HEAD
- If the dev is on a feature branch, still index main/master content

**Implementation approach:**
1. Add `getDefaultBranch(repoPath)` to `git.ts`:
   - Try `git symbolic-ref refs/remotes/origin/HEAD` (unreliable, may not be set)
   - Fallback: try `git rev-parse --verify origin/main` then `origin/master`
   - Cache result per repo (branch name doesn't change often)
2. Add `getCommitForRef(repoPath, ref)` to resolve branch refs to SHAs
3. Modify `getCurrentCommit()` to accept an optional branch parameter
4. Update `indexSingleRepo` to use default branch SHA for comparison and content

**Complexity:** LOW -- 3-4 small functions in `git.ts`, minor pipeline changes.

**Edge cases:**
- Repo has no remote (local-only): fall back to HEAD
- `origin/HEAD` not set: use fallback chain main -> master -> HEAD
- Detached HEAD state: still works since we're resolving origin/main explicitly

**Confidence:** HIGH -- git commands are well-documented and deterministic.

### 2. Surgical File-Level Re-Indexing

**What it does:** When a repo has new commits, only re-extract entities from changed files instead of wiping everything and re-extracting all files.

**Current problem (v1.0):** The pipeline calls `getChangedFiles()` to detect deleted files, but then runs ALL extractors on ALL files and calls `clearRepoEntities()` which wipes everything before re-inserting. The incremental detection exists but isn't used for anything beyond delete cleanup.

**Expected behavior:**
1. Get changed files via `git diff --name-status <last_commit>..HEAD`
2. For deleted files: remove their entities (already implemented via `clearRepoFiles`)
3. For added/modified files: remove old entities for those files, run extractors only on those files
4. For unchanged files: do nothing -- their entities remain in the DB
5. For force re-index: wipe and rebuild everything (existing behavior)

**Implementation approach:**
1. Modify extractors to accept a file list filter (optional):
   - `extractElixirModules(repoPath, { files?: string[] })` -- if files provided, only process those
   - `extractProtoDefinitions(repoPath, { files?: string[] })` -- same
   - New extractors should follow this pattern from the start
2. Modify `persistRepoData` to support incremental mode:
   - Remove the `clearRepoEntities(db, repoId)` call for incremental updates
   - Only clear entities from changed files via existing `clearRepoFiles`
   - Upsert new entities from changed files
3. Update `indexSingleRepo` to orchestrate: detect changed files -> clear changed file entities -> extract from changed files only -> persist

**Complexity:** MEDIUM -- core refactor of the extraction/persistence pipeline. Touches `pipeline.ts`, `writer.ts`, `elixir.ts`, `proto.ts`, `events.ts`.

**Key risk:** Event relationship detection currently scans ALL `.ex` files for consumer patterns. Surgical indexing needs to handle cross-file dependencies: if file A defines a consumer and file B is modified, file A's consumer relationships should remain untouched. This requires clean file-level isolation of entities, which the current `clearRepoFiles` mostly supports via `source_file` tracking.

**Confidence:** HIGH -- the existing `clearRepoFiles` and `getChangedFiles` already provide the building blocks.

### 3. Parallel Repo Indexing

**What it does:** Index multiple repos concurrently instead of sequentially.

**Expected behavior:**
- Run extraction (filesystem reads, git commands) for multiple repos in parallel
- Control concurrency to avoid overwhelming the filesystem
- Serialize database writes (SQLite single-writer constraint)
- Maintain per-repo error isolation (existing requirement IDX-07)
- Show progress as repos complete

**Implementation approach:**
1. Use `p-limit` (or hand-rolled semaphore) for concurrency control
2. Split the pipeline into two phases per repo:
   - **Phase 1 (parallel):** Extract metadata, run file extractors, detect events -- pure filesystem I/O
   - **Phase 2 (serial):** Persist to database -- `persistRepoData` in main thread
3. Modify `indexAllRepos` to use `Promise.all` with limiter:
   ```typescript
   const limit = pLimit(4); // 4 repos at a time
   const extractions = repos.map(repo => limit(() => extractRepoData(repo)));
   const results = await Promise.all(extractions);
   for (const result of results) { persistRepoData(db, result); }
   ```
4. This requires making extractors async (they currently use sync `fs.readFileSync`)

**Complexity:** LOW-MEDIUM -- the architectural change is straightforward, but converting sync filesystem operations to async and restructuring the pipeline requires touching most indexer files.

**Trade-off decision:** Don't use worker_threads. The SQLite writer constraint means workers can't write in parallel anyway, and the overhead of serializing extraction results across thread boundaries isn't worth it for I/O-bound work. `Promise.all` + async filesystem operations + `p-limit` is the right call.

**Expected speedup:** 2-4x for full re-index (bottleneck shifts from sequential I/O to DB writes). Diminishing returns beyond 4-6 concurrent repos due to disk throughput limits.

**Confidence:** HIGH -- well-established Node.js concurrency pattern.

### 4. GraphQL Schema Extraction

**What it does:** Extract types, queries, mutations, and subscriptions from two sources:
1. `.graphql` SDL files (found in at least 10 repos: app-accounting-documents, app-packages, app-blocked-times, app-wallet-transfers, etc.)
2. Absinthe macro definitions in `.ex` files

**Expected behavior for `.graphql` files:**
- Parse SDL using the `graphql` npm package's `parse()` function
- Extract: object types (with fields), input types, enum types, query/mutation/subscription root fields
- Store as searchable entities with repo association

**Expected behavior for Absinthe `.ex` files:**
- Regex-extract Absinthe macros: `object :name do`, `field :name, :type`, `query do`, `mutation do`, `input_object :name do`, `enum :name do`
- Map to equivalent GraphQL type/field structures
- Link to source file

**Implementation approach:**
1. **New extractor: `graphql.ts`**
   - Find `.graphql` files recursively (like proto finder)
   - Use `graphql` package `parse()` to get AST
   - Walk `DocumentNode.definitions`, extract `ObjectTypeDefinition`, `InputObjectTypeDefinition`, `EnumTypeDefinition`, etc.
   - Special handling for `Query`, `Mutation`, `Subscription` root types
2. **Extend `elixir.ts`** for Absinthe patterns:
   - Detect Absinthe schemas: `use Absinthe.Schema` or `use Absinthe.Schema.Notation`
   - Regex patterns for `object :identifier do`, `field :name, :type`, `query do`, `mutation do`
   - Classify as module type "graphql_schema" or "graphql_type"
3. **Schema migration** (v3): Add `graphql_types` table or extend modules table with GraphQL-specific columns
4. **FTS integration:** Index GraphQL type names and field names for search

**New dependency:** `graphql` npm package (the reference implementation, ~200KB, no native deps, zero config). Used only for its parser -- not running a server.

**Complexity:** MEDIUM -- the `.graphql` parser is trivial with the `graphql` package. Absinthe macro extraction via regex is more brittle but follows the same pattern as existing Elixir extraction.

**Confidence:** HIGH for `.graphql` SDL parsing (official parser, well-documented AST). MEDIUM for Absinthe macro extraction (regex on macros is fragile but sufficient for common patterns).

### 5. gRPC Service Definition Extraction

**What it does:** Persist the service/RPC definitions that the proto parser already extracts but currently discards.

**Current state:** `proto.ts` already has `extractServices()` which returns `ProtoService[]` with `ProtoRpc[]`. The `indexSingleRepo` pipeline maps proto messages to events but completely ignores the service blocks. The `RelationshipType` already includes `'calls_grpc'`.

**Expected behavior:**
- Store gRPC services as entities (service name, package, source file)
- Store RPCs with their request/response types
- Create `calls_grpc` edges when one repo's code references another repo's gRPC service
- Make services searchable ("what gRPC endpoints does app-rewards expose?")

**Implementation approach:**
1. Map `ProtoService` data to a new entity type or reuse the existing `services` table
2. Store each RPC as a module-like entity with type "grpc_rpc"
3. Add edges: repo -> service (exposes_grpc), detect gRPC client calls in Elixir code (e.g., `Stub.method_name()` patterns)
4. Update `persistRepoData` to handle gRPC service persistence

**Complexity:** LOW -- the hard parsing work is done. This is plumbing existing data into the DB and FTS.

**Confidence:** HIGH -- direct extension of existing code, no new parsing needed.

### 6. Ecto Schema Extraction

**What it does:** Extract database structure from Ecto schema definitions: table names (already captured), field names/types, associations, and embedded schemas.

**Current state:** `elixir.ts` already detects `schema "table_name"` and classifies modules as type "schema". But it doesn't extract the fields or associations defined within the schema block.

**Ecto schema patterns to extract:**
```elixir
schema "table_name" do
  field :name, :string                    # field with type
  field :status, Ecto.Enum, values: [...]  # enum field
  belongs_to :user, User                   # association
  has_many :orders, Order                  # association
  has_one :profile, Profile                # association
  many_to_many :tags, Tag                  # association
  embeds_one :metadata, Metadata           # embedded schema
  embeds_many :items, Item                 # embedded schema
  timestamps()                             # auto-fields
end
```

**Expected behavior:**
- Extract all fields with their types from `field :name, :type` declarations
- Extract associations (belongs_to, has_many, has_one, many_to_many) with target schema
- Extract embedded schemas (embeds_one, embeds_many)
- Detect timestamps() calls
- Store as structured data associated with the module entity
- Enable queries like "which schemas have a `partner_id` field?" or "what tables does app-rewards use?"

**Implementation approach:**
1. Extend `parseElixirFile` to capture field and association data when inside a `schema` block
2. Add regex patterns:
   - `field\s+:(\w+),\s+([\w.:]+)` for fields
   - `(belongs_to|has_many|has_one|many_to_many)\s+:(\w+),\s+([\w.]+)` for associations
   - `(embeds_one|embeds_many)\s+:(\w+),\s+([\w.]+)` for embeds
   - `timestamps\(\)` for timestamp detection
3. Store in existing `modules` table via extended summary, or add a new `schema_fields` table
4. Create edges for associations (schema A -> schema B via `has_many`)

**Complexity:** MEDIUM -- regex extraction is straightforward for well-formatted Ecto schemas. The association-to-edge mapping adds cross-repo relationship data.

**Confidence:** HIGH for field/association regex extraction (Ecto has very consistent macro syntax). MEDIUM for cross-repo association resolution (target schema names may not match module names exactly).

### 7. Event Catalog Integration

**What it does:** Import curated domain knowledge from the `fresha-event-catalog` repo as a supplementary data source, enriching the KB with human-authored event descriptions, domain ownership, team assignments, and service metadata that code extraction alone cannot provide.

**Data available in the Event Catalog:**
- `sources/events/events.json`: ~200+ events with name, version, channels, producers, owners, domain, proto schema, description, protocol
- `sources/services/services.json`: ~50+ services with name, owners, repo URL, language, description, domains, sends/receives
- `sources/rpcs/rpcs.json`: ~100+ gRPC service definitions with methods, request/response schemas, domain, protocol

**Expected behavior:**
- Detect `fresha-event-catalog` repo in the repos directory (or allow configuring its path)
- Parse the JSON source files (not the generated MDX)
- Merge Event Catalog data with code-extracted data:
  - Enrich events with descriptions, domain assignments, owner teams
  - Enrich services with domain context, team ownership
  - Add RPC definitions not found in individual repo proto files
- Avoid duplicates: match by event name/service name between code-extracted and catalog data
- Track catalog version/commit separately from individual repo commits

**Implementation approach:**
1. New extractor: `event-catalog.ts`
   - Locate the catalog repo (scan repos directory or config)
   - Parse `events.json`, `services.json`, `rpcs.json`
   - Map to existing entity types (events, services, edges)
2. Merge strategy: catalog data supplements code-extracted data
   - If an event exists from code extraction AND catalog: catalog description wins, schema from code wins
   - If an event exists only in catalog: create entity with catalog data
   - Domain/owner metadata always comes from catalog (authoritative source)
3. Schema migration: Add columns for domain, owner_team to relevant tables
4. Indexing: treat catalog as a special "repo" that gets indexed alongside code repos

**Complexity:** MEDIUM -- JSON parsing is trivial, the complexity is in the merge/deduplication logic and schema evolution.

**Key risk:** Event names in the catalog may not match proto message names exactly. The catalog uses human-readable names ("Payment Failed") while proto uses message names ("PaymentFailed" or "payment_failed.v1.Payload"). Need a normalization/matching strategy.

**Confidence:** HIGH for parsing (it's just JSON). MEDIUM for merge logic (name matching heuristics needed).

## Feature Dependencies

```
Branch-Aware Git Tracking
    |
    +---> Surgical File-Level Re-Indexing
              |
              +---> Parallel Repo Indexing (benefits from surgical to reduce DB contention)

Existing proto.ts
    |
    +---> gRPC Service Definition Extraction (LOW effort, just wiring)

Existing elixir.ts
    |
    +---> Ecto Schema Extraction (extend regex patterns)

New graphql.ts + extended elixir.ts
    |
    +---> GraphQL Schema Extraction

fresha-event-catalog repo
    |
    +---> Event Catalog Integration (independent track)

Schema Migration (v3)
    |
    +---> All new extractors need DB storage
```

### Critical Path

1. Branch-aware tracking MUST come before surgical indexing (surgical relies on accurate commit tracking against the right branch)
2. Surgical indexing SHOULD come before parallelism (parallel extraction + serial persistence is cleaner with surgical updates)
3. gRPC wiring is completely independent and can be done anytime
4. GraphQL, Ecto, and Event Catalog extractors are independent of each other
5. All extractors need a schema migration, so that should be designed upfront

## Implementation Priority

| Feature | Value | Effort | Priority | Phase Recommendation |
|---------|-------|--------|----------|---------------------|
| gRPC service definition extraction | HIGH | LOW | P0 | First -- it's nearly free |
| Branch-aware git tracking | HIGH | LOW | P1 | Foundation for surgical indexing |
| Surgical file-level re-indexing | HIGH | MEDIUM | P1 | Core improvement, enables parallelism |
| Parallel repo indexing | MEDIUM | LOW-MED | P1 | Natural follow-on to surgical |
| Ecto schema extraction | MEDIUM | MEDIUM | P2 | Extends existing extractor |
| GraphQL schema extraction | MEDIUM | MEDIUM | P2 | New extractor with npm dep |
| Event Catalog integration | HIGH | MEDIUM | P2 | Independent track, rich data source |

**Rationale:** Start with what's nearly free (gRPC wiring), then fix the indexing pipeline foundation (branch + surgical + parallel), then add new extractors. Event Catalog integration is high value but independent, so it can be parallelized with extractor work.

## Sources

- Existing codebase analysis (`git.ts`, `pipeline.ts`, `writer.ts`, `elixir.ts`, `proto.ts`, `events.ts`) -- HIGH confidence
- `fresha-event-catalog` repo structure and JSON source files -- HIGH confidence (direct inspection)
- [GraphQL Tools schema loading](https://the-guild.dev/graphql/tools/docs/schema-loading) -- MEDIUM confidence
- [graphql-js parse function](https://snyk.io/advisor/npm-package/graphql/functions/graphql.parse) -- HIGH confidence
- [Absinthe Schema Notation docs](https://hexdocs.pm/absinthe/Absinthe.Schema.Notation.html) -- HIGH confidence
- [Ecto Schema docs](https://hexdocs.pm/ecto/Ecto.Schema.html) -- HIGH confidence
- [EventCatalog SDK](https://www.eventcatalog.dev/docs/sdk) -- MEDIUM confidence
- [p-limit concurrency control](https://www.npmjs.com/package/p-limit) -- HIGH confidence
- [better-sqlite3 worker thread safety](https://github.com/JoshuaWise/better-sqlite3/issues/237) -- HIGH confidence
- [git symbolic-ref for default branch detection](https://git-scm.com/docs/git-symbolic-ref) -- HIGH confidence

---
*Feature research for v1.1: Improved Reindexing & New Extractors*
*Researched: 2026-03-06*
