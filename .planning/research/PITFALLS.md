# Domain Pitfalls: v1.1 Improved Reindexing and New Extractors

**Domain:** Incremental indexing, parallel execution, and new extractor pipelines for existing knowledge base
**Researched:** 2026-03-06
**Confidence:** HIGH (verified against codebase, official docs, and multiple sources)

---

## Critical Pitfalls

Mistakes that cause data corruption, silent wrongness, or require significant rework.

---

### Pitfall 1: Branch-Aware Tracking Breaks on Detached HEAD

**What goes wrong:**
You add branch-aware git tracking with `git symbolic-ref --short HEAD` to determine the current branch and compare against main/master. But ~50 repos on developer machines are frequently in detached HEAD state (after `git checkout <sha>`, during rebase, or from IDE operations). `git symbolic-ref` throws a fatal error on detached HEAD. If you don't catch this, the entire indexer crashes or silently skips every detached repo.

**Why it happens:**
The current codebase uses `git rev-parse HEAD` (in `src/indexer/git.ts:9`), which always returns a SHA regardless of HEAD state. Adding branch detection introduces a new failure mode that didn't exist before. Developers test with repos that are on branches, so the detached HEAD case never surfaces during development.

**Consequences:**
- Indexer crashes on any repo in detached HEAD state
- If swallowed silently, repos get skipped without explanation -- users see "skipped" repos they expect to be indexed
- MCP auto-sync (`src/mcp/sync.ts`) inherits the same bug, causing query-time failures

**Prevention:**
1. Use `git symbolic-ref --short HEAD 2>/dev/null` with error handling -- a non-zero exit means detached HEAD
2. For detached HEAD, fall back to checking if HEAD is reachable from `origin/main` or `origin/master` using `git merge-base --is-ancestor HEAD origin/main`
3. Decision: Should detached HEAD repos be indexed? The answer is almost certainly **yes** if HEAD is reachable from the main branch (developer just hasn't switched back yet). Only skip if HEAD is on a pure feature branch with no overlap.
4. Store `indexed_branch` alongside `last_indexed_commit` in the repos table so you can detect when someone switches branches

**Detection:**
- Test the indexer against a repo with `git checkout HEAD~1` (detached HEAD)
- Test against a repo mid-rebase
- Watch for "skipped" repos that should have been indexed

**Phase to address:** Phase 1 of v1.1 (branch-aware tracking). Must handle detached HEAD from day one.

---

### Pitfall 2: Surgical File Updates Create Orphaned FTS Entries

**What goes wrong:**
You switch from wipe-and-rewrite to surgical file-level updates. A file is modified, so you delete its old entities and insert new ones. But the FTS5 `knowledge_fts` table uses `entity_id` references to the `modules`, `events`, etc. tables. If you delete a module row (getting a new auto-increment ID on re-insert) but fail to clean up the corresponding FTS entry first, you get orphaned FTS entries pointing at IDs that no longer exist (or worse, point at *different* entities that reused the ID).

**Why it happens:**
The current `persistRepoData` in `src/indexer/writer.ts:144` does it safely: `clearRepoEntities` removes all FTS entries, deletes all rows, then re-inserts everything fresh. The IDs change, but it doesn't matter because everything is rebuilt atomically in a transaction. Surgical updates break this assumption -- you're now doing partial deletes and inserts, and FTS consistency becomes your responsibility for each individual file.

**Consequences:**
- Search returns phantom results: "Found module X in file Y" but the file no longer contains that module
- Search misses newly extracted entities because the old FTS entry for that `entity_id` was never cleaned up, and the delete-then-insert in `indexEntity` (`src/db/fts.ts:49`) only cleans by `(entity_type, entity_id)` -- if the ID is new, it won't find the old entry
- The database gradually accumulates garbage, degrading search quality over time

**Prevention:**
1. For each changed file, BEFORE deleting entity rows: collect all `(entity_type, entity_id)` pairs from that file and call `removeEntity` for each
2. The existing `clearRepoFiles` function (writer.ts:108) already does this partially, but only for deleted files. Extend it to handle modified files too -- "modified" means "delete old entities from this file, then re-extract and re-insert"
3. Wrap the entire per-file update in a transaction. Either all entities for a file are updated, or none are.
4. Add a consistency check: count FTS entries vs actual entity rows. If they diverge, force a full re-index of that repo.

**Detection:**
- Run `SELECT COUNT(*) FROM knowledge_fts` vs `SELECT (SELECT COUNT(*) FROM modules) + (SELECT COUNT(*) FROM events) + (SELECT COUNT(*) FROM repos)` -- they should roughly match
- Search for an entity you know was renamed -- if the old name still returns results, FTS is orphaned

**Phase to address:** Phase 2 of v1.1 (surgical file updates). This is THE critical pitfall of the incremental update work.

---

### Pitfall 3: Parallel Repo Indexing Hits SQLite Write Lock

**What goes wrong:**
You spawn worker threads or parallel async operations to index multiple repos simultaneously. Each worker tries to call `persistRepoData`, which runs a write transaction. SQLite allows only ONE writer at a time, even in WAL mode. The second writer gets `SQLITE_BUSY`, and better-sqlite3 throws immediately (or after the configured timeout). Your parallel indexing is no faster than serial -- or worse, it crashes with lock errors.

**Why it happens:**
WAL mode (already enabled in `src/db/database.ts:18`) allows concurrent reads with a single write. Many developers confuse this with concurrent writes. better-sqlite3 is synchronous, so a write transaction blocks the Node.js event loop for its duration. With worker threads, each thread has its own connection but they all compete for the same write lock.

**Consequences:**
- `SQLITE_BUSY` errors on 49 out of 50 repos if all try to write at once
- If you add a `busy_timeout`, threads queue up waiting -- negating the parallelism benefit
- In the worst case, long write transactions (the full `persistRepoData` transaction) hold the lock for seconds, causing cascading timeouts
- The MCP auto-sync (`src/mcp/sync.ts`) could also conflict if it triggers a sync while a parallel index is running

**Prevention:**
1. **Parallelize extraction, serialize writes.** The expensive part is file I/O and regex parsing (reading .ex files, .proto files, etc.), not the database writes. Run extractors in parallel (worker threads or Promise.all), collect results, then write to SQLite sequentially from the main thread.
2. Architecture: `[Worker 1: extract repo A] -> results` + `[Worker 2: extract repo B] -> results` ... then main thread writes all results to DB in sequence.
3. Do NOT open separate database connections in worker threads for writes. If you do, use `db.pragma('busy_timeout = 5000')` as a safety net, but this is a band-aid.
4. The `persistRepoData` transaction already wraps everything in `db.transaction()` -- keep this, but only call it from the main thread.
5. Consider using `worker_threads` with `MessagePort` to send extraction results back to main thread for DB writes.

**Detection:**
- Any `SQLITE_BUSY` error in logs during parallel indexing
- Parallel indexing is no faster than serial (sign that writes are serialized anyway but with overhead)
- Intermittent test failures in CI (timing-dependent lock contention)

**Phase to address:** Phase 3 of v1.1 (parallel execution). Get the architecture right before writing code.

---

### Pitfall 4: Incremental Indexing Breaks Cross-Repo Event Edges

**What goes wrong:**
You surgically re-index repo A (a producer) because a proto file changed. The `insertEventEdges` function in `pipeline.ts:208` looks up events by name across repos to connect producers and consumers. But repo B (a consumer) wasn't re-indexed, so its edge records still point to the OLD event IDs from repo A's previous index. After surgical re-indexing repo A, those edges are now dangling -- pointing at event IDs that were deleted and re-created with new IDs.

**Why it happens:**
The current wipe-and-rewrite model (`clearRepoEntities` + fresh insert) deletes edges where `source_type = 'repo' AND source_id = repoId`. But cross-repo references (repo B's edge pointing at repo A's event) have `source_type = 'repo', source_id = B_id, target_type = 'event', target_id = A_old_event_id`. When repo A's events get new IDs, repo B's edges become dangling.

The `edges` table (migrations.ts:96) uses polymorphic `source_id`/`target_id` without foreign keys -- so there's no CASCADE delete, no constraint violation, just silent wrongness.

**Consequences:**
- `kb deps` returns stale or broken dependency information
- Event flow queries ("who consumes X?") silently miss consumers that haven't been re-indexed
- The knowledge base gradually becomes less accurate as repos are incrementally updated at different times

**Prevention:**
1. When re-indexing a repo, also delete any edges in OTHER repos that point to entities in THIS repo. Add: `DELETE FROM edges WHERE target_type = 'event' AND target_id IN (SELECT id FROM events WHERE repo_id = ?)` BEFORE clearing entities.
2. Better: use stable entity identifiers instead of auto-increment IDs for cross-repo references. An event's identity is `(repo_name, event_name)`, not its row ID. Store edges using `(source_repo, source_name, target_repo, target_name)` or add a `canonical_name` column.
3. Alternatively: when re-indexing repo A, mark all repos that reference repo A's entities as "stale" and re-index them too. This is simpler but more expensive.
4. At minimum: add a `PRAGMA integrity_check` equivalent -- a query that finds edges pointing at non-existent entity IDs. Run it after every incremental index.

**Detection:**
- Run: `SELECT e.* FROM edges e LEFT JOIN events ev ON e.target_type = 'event' AND e.target_id = ev.id WHERE e.target_type = 'event' AND ev.id IS NULL` -- any rows = dangling edges
- `kb deps <repo>` returns fewer dependencies than expected after incremental re-index

**Phase to address:** Phase 2 of v1.1 (surgical updates). Must be solved alongside file-level updates, not deferred.

---

### Pitfall 5: EventCatalog SDK Is File-Based, Not HTTP

**What goes wrong:**
You plan to integrate with "Event Catalog HTTP API" and design an HTTP client, retry logic, authentication, etc. But EventCatalog's `@eventcatalog/sdk` is a **file-based SDK** that reads from a local catalog directory on the filesystem. There is no HTTP API. You either waste time building an HTTP integration that doesn't exist, or you realize late that you need filesystem access to wherever the EventCatalog repo is cloned.

**Why it happens:**
The milestone description says "Event Catalog HTTP API integration." EventCatalog is a static site generator (Astro-based) with a filesystem-backed SDK. The "API" is `const { getEvent } = utils(PATH_TO_CATALOG)` where `PATH_TO_CATALOG` is a local directory path. If the team hasn't used EventCatalog directly, the assumption of an HTTP API is natural.

**Consequences:**
- Wasted design/implementation time on HTTP client code
- Requires the EventCatalog repo to be cloned locally (or accessible via filesystem), which may not be the case
- The SDK is async (returns Promises) despite being filesystem-based, so the integration pattern differs from the current synchronous better-sqlite3 pipeline

**Prevention:**
1. Verify: EventCatalog SDK reads from a directory of markdown files with frontmatter. Usage: `npm install @eventcatalog/sdk`, then `const { getEvent, getService, getDomain } = utils('/path/to/catalog')`
2. The catalog path must be configured -- add a `KB_EVENTCATALOG_PATH` env var or config option pointing to the local clone of the EventCatalog repo
3. The SDK methods are async (`getEvent` returns a Promise). The current pipeline is synchronous. Either use `await` in the EventCatalog extractor or use the CLI: `npx @eventcatalog/sdk --dir ./catalog getEvent "EventName"`
4. Alternative: skip the SDK entirely and directly parse the catalog's markdown files (they're just markdown with YAML frontmatter). This avoids the async dependency and keeps the extraction pattern consistent with other extractors.

**Detection:**
- The milestone says "HTTP API" but no HTTP endpoint exists
- EventCatalog's docs show no REST/GraphQL API for reading catalog data programmatically over the network

**Phase to address:** Phase 4 of v1.1 (Event Catalog integration). Clarify the integration approach before writing any code.

---

## Moderate Pitfalls

---

### Pitfall 6: GraphQL Schema Regex Parsing Misses Multi-Line Descriptions and Directives

**What goes wrong:**
You write regex to extract GraphQL SDL types (`type Query { ... }`, `type Mutation { ... }`, `type Booking { ... }`). But GraphQL schemas have: (a) triple-quoted multi-line descriptions (`""" ... """`), (b) directives on types and fields (`@deprecated`, `@auth`, custom directives with arguments), (c) field arguments with complex types, (d) inline comments, and (e) schema extensions (`extend type Query`). A naive regex like `/type\s+(\w+)\s*\{/` chokes on descriptions before the type keyword, and `findMatchingBrace` (from proto.ts) won't handle descriptions containing `{` characters inside triple-quoted strings.

**Why it happens:**
The existing proto extractor works well because proto syntax is relatively simple. GraphQL SDL has more syntax features, and Absinthe (the Elixir GraphQL library) has its own macro-based schema DSL that looks nothing like standard SDL.

**Consequences:**
- Missing types when descriptions contain special characters
- Incorrect field extraction when directives or arguments are present
- Absinthe schemas (which use Elixir macros like `object :booking do ... end`) are completely missed by SDL regex

**Prevention:**
1. Decide early: extract from `.graphql` SDL files, or from Absinthe Elixir macros, or both?
2. For SDL files: handle triple-quoted strings by stripping them before brace-matching. Reuse the `findMatchingBrace` approach from proto.ts but pre-process to remove string literals.
3. For Absinthe: write Elixir-specific regex patterns: `object\s+:(\w+)\s+do`, `field\s+:(\w+),\s+:(\w+)`, `query\s+do` / `mutation\s+do`
4. Test against REAL schemas from your repos, not toy examples. Grab 5 actual `.graphql` or Absinthe schema files and ensure extraction works.
5. Accept that regex will miss edge cases. 85% coverage of types and fields is fine for architectural knowledge.

**Detection:**
- Run the extractor against a real repo, compare extracted types with `grep -c "type " schema.graphql` -- if counts diverge significantly, the regex is too simple
- Absinthe schemas returning zero results

**Phase to address:** Phase 4 of v1.1 (new extractors).

---

### Pitfall 7: Ecto Schema Extraction Duplicates Existing Elixir Module Data

**What goes wrong:**
You add an Ecto schema extractor that finds `schema "table_name" do ... end` blocks and extracts fields, associations, etc. But the existing Elixir extractor (`src/indexer/elixir.ts`) already extracts modules that contain schemas -- it detects `schema "table_name"` (line 213) and classifies them as `type: 'schema'` with the table name captured. The new Ecto extractor creates duplicate entities in the database, or worse, the two extractors produce conflicting data for the same module.

**Why it happens:**
The existing `extractSchemaTable` in elixir.ts captures the table name but not the fields, associations, or field types. A dedicated Ecto extractor would go deeper. But without coordinating between extractors, you get one `module` record from the Elixir extractor AND a new `ecto_schema` record from the Ecto extractor for the same defmodule.

**Consequences:**
- FTS returns duplicate results for Ecto schema searches
- The `modules` table and a new `schemas` table both contain overlapping data
- Entity counts inflate, search quality degrades
- Edge relationships may point to either the module or the schema entity, creating confusion

**Prevention:**
1. Don't create a separate entity type for Ecto schemas. Instead, ENRICH the existing module extraction. When a module has `schema "table_name" do ... end`, add the field/association details to the existing module's `summary` or a new `schema_details` column.
2. If a separate table IS needed (e.g., `schemas` for structured field data), link it back to the module via `module_id` and ensure FTS only indexes one version.
3. Run the Ecto extractor as a post-processing step on modules already classified as `type: 'schema'`, not as an independent file scanner.

**Detection:**
- Search for a known Ecto schema module name and get 2+ results
- Entity count grows disproportionately after adding the extractor

**Phase to address:** Phase 4 of v1.1 (new extractors). Design the enrichment approach before coding.

---

### Pitfall 8: gRPC Extraction From Proto Files Already Exists

**What goes wrong:**
You build a "gRPC service definition extractor" that parses `.proto` files for `service` blocks. But the existing `src/indexer/proto.ts` already extracts `ProtoService` definitions with RPCs (line 177-196). The new extractor either duplicates this work or conflicts with the existing proto extractor.

**Why it happens:**
The milestone says "gRPC service definition extraction" as a new feature. But looking at the code, `proto.ts` already extracts `services` with `name` and `rpcs` (including input/output types). What's actually missing is: (a) the extracted services aren't stored as `service` entities in the database (they're only in the return type but not persisted), and (b) there are no `calls_grpc` edges connecting repos to the gRPC services they call.

**Consequences:**
- Wasted effort re-implementing what exists
- If implemented independently, two extractors scanning the same `.proto` files

**Prevention:**
1. Audit what's already there: `extractProtoDefinitions` returns `ProtoService[]` with RPCs, but `indexSingleRepo` in pipeline.ts only uses `proto.messages` -- the `services` data is extracted but **never persisted**.
2. The actual work is: (a) persist proto services to the `services` table, (b) create `exposes_grpc` edges from repos to their proto services, (c) detect gRPC *client* calls in Elixir code and create `calls_grpc` edges.
3. For gRPC client detection: look for patterns like `GRPC.Stub.call` or generated client module usage in Elixir files.

**Detection:**
- Check `src/indexer/proto.ts` -- services are already parsed
- Check `pipeline.ts` -- `protoDefinitions.services` is never used in the persistence logic

**Phase to address:** Phase 4 of v1.1 (new extractors). Start by persisting what's already extracted before building new extractors.

---

### Pitfall 9: `getChangedFiles` Produces Wrong Diff When Branch Switches

**What goes wrong:**
The current `getChangedFiles(repoPath, sinceCommit)` runs `git diff --name-status ${sinceCommit}..HEAD`. This works when the repo has advanced linearly from the stored commit. But if the developer switched branches (e.g., from `main` to `feature-x` and back), the diff between the old commit and current HEAD may include changes from the feature branch that were never actually in the current state, or miss files that reverted.

With branch-aware tracking, this gets worse: you store `last_indexed_commit` as the main branch HEAD, but the developer's working copy might be on a different branch. The diff `stored_main_sha..HEAD` could span a merge, producing a massive diff that includes every file changed in the merged branch.

**Why it happens:**
`git diff A..B` shows differences between two commits. If B is reachable from A through multiple paths (merge commits), the diff is the total change, which may include files that were changed and then changed back. It also doesn't account for files that exist at A and B identically but were modified in between.

**Consequences:**
- Unnecessary re-extraction of unchanged files (performance hit but not correctness issue)
- Missing files that should be re-extracted (correctness issue: file was changed, then reverted, but intermediate changes affected extractor output... actually no, if file content is the same, extraction is the same)
- Massive diffs after merges causing unexpectedly long re-indexing

**Prevention:**
1. For branch-aware tracking: always diff against the main branch's HEAD, not the working copy. Use `git rev-parse origin/main` (or `origin/master`) to get the canonical reference.
2. For the diff itself: consider `git diff --name-status` against the stored commit only if the stored commit is an ancestor of current HEAD (already checked via `isCommitReachable`). If not an ancestor (branch switch or force push), fall back to full re-index of that repo.
3. Sanity check: if `getChangedFiles` returns more than N files (e.g., 200), fall back to full re-index. A surgical update of 200 files is likely slower than a full wipe-and-rewrite anyway.
4. Track which branch was last indexed. If the branch changed, force full re-index.

**Detection:**
- After a merge commit, incremental re-index processes way more files than expected
- `getChangedFiles` returns files that haven't actually changed in content (just touched by merge)

**Phase to address:** Phase 1-2 of v1.1 (branch tracking + surgical updates). These features are tightly coupled.

---

### Pitfall 10: New Extractors Don't Populate `source_file` Correctly for Incremental Deletion

**What goes wrong:**
You add GraphQL, gRPC, and Ecto extractors. The surgical deletion path (`clearRepoFiles` in writer.ts:108) deletes entities by matching `file_id` (for modules) or `source_file` (for events and edges). If new extractors don't correctly set `source_file` or link to `file_id`, the incremental deletion can't clean up their entities when files change. You end up with stale entities that survive file deletions.

**Why it happens:**
The current extractors carefully track file paths: `ElixirModule.filePath`, `ProtoDefinition.filePath`, `EventRelationship.sourceFile`. New extractors need to follow the same pattern. But it's easy to store a processed/normalized path instead of the raw relative path, or to use absolute paths when the cleanup code expects relative ones.

**Consequences:**
- `clearRepoFiles` silently fails to delete entities from new extractors (no match on file path)
- Deleted GraphQL/gRPC files leave phantom entities in the database
- Gradual data quality degradation that's hard to diagnose

**Prevention:**
1. Establish a convention: all `filePath` / `source_file` values MUST be relative to repo root (same as `path.relative(repoPath, filePath)` used in existing extractors)
2. Add a test for each new extractor: extract entities, delete the source file, run incremental re-index, verify entities are gone
3. Consider adding a `source_extractor` column to entities so you can clear by extractor type during debugging
4. All new entity types need a `source_file` or `file_id` column -- without it, surgical deletion is impossible for that entity type

**Detection:**
- After deleting a `.graphql` file and re-indexing, the GraphQL types still appear in search
- `clearRepoFiles` runs without errors but entity counts don't decrease

**Phase to address:** Phase 2 of v1.1 (surgical updates) and Phase 4 (new extractors). These must be designed together.

---

## Minor Pitfalls

---

### Pitfall 11: Parallel Extraction Saturates File I/O, Not CPU

**What goes wrong:**
You spawn N worker threads for parallel extraction, expecting N-fold speedup. But the extractors are I/O-bound (reading files from disk), not CPU-bound (regex is fast). On macOS with SSDs, file I/O is already fast, and N threads all reading from the filesystem actually compete for the same I/O bandwidth, yielding minimal speedup -- maybe 1.5-2x instead of the expected 4-8x.

**Prevention:**
- Benchmark before parallelizing. Time a single repo index: if 80% is file I/O and 20% is CPU, parallelism helps little.
- Use `Promise.all` with a concurrency limiter (e.g., p-limit) rather than worker threads. Simpler, no IPC overhead, and async I/O already overlaps reads.
- Worker threads are worth it only if extraction becomes CPU-heavy (e.g., future AST parsing or embedding generation).

**Phase to address:** Phase 3 of v1.1 (parallel execution). Profile first, optimize second.

---

### Pitfall 12: Schema Migration Breaks Existing v1.0 Databases

**What goes wrong:**
New extractors need new tables or columns (e.g., `graphql_types`, `ecto_schemas`, or new columns on `modules`). The migration system (`src/db/migrations.ts`) uses `SCHEMA_VERSION` and runs migrations sequentially. If a migration modifies an existing table incorrectly (ALTER TABLE in SQLite is limited -- no DROP COLUMN before 3.35, no ALTER COLUMN ever), existing users' databases break.

**Prevention:**
1. SQLite ALTER TABLE only supports `ADD COLUMN` reliably. For schema changes to existing tables, add new columns with defaults rather than modifying existing ones.
2. Test migrations against a real v1.0 database snapshot, not just a fresh database.
3. Keep the migration idempotent: `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN` wrapped in try/catch (SQLite throws if column already exists).
4. Never delete or rename columns in migrations.

**Phase to address:** Any phase that adds new entity types. Plan the schema changes upfront.

---

### Pitfall 13: MCP Auto-Sync Conflicts with Manual Indexing

**What goes wrong:**
The MCP auto-sync (`src/mcp/sync.ts`) re-indexes up to 3 stale repos per query. If a user is running `kb index` at the same time (or another MCP query triggers sync), two processes/threads try to write to the same SQLite database simultaneously. The CLI process and the MCP server process have separate database connections, leading to `SQLITE_BUSY` errors or data races.

**Prevention:**
1. Add a `indexing_lock` mechanism: a simple row in a `locks` table or a filesystem lock file. Before indexing, check the lock. If locked, MCP sync should skip (it's not urgent), and CLI should wait or warn.
2. Alternatively, use SQLite's built-in `busy_timeout` pragma (already not set explicitly -- better-sqlite3 defaults to 0ms, meaning immediate SQLITE_BUSY). Set `db.pragma('busy_timeout = 5000')` in `openDatabase`.
3. At minimum: wrap MCP sync writes in a try/catch that gracefully handles `SQLITE_BUSY` instead of crashing the MCP server.

**Phase to address:** Phase 3 of v1.1 (parallel execution). This is an existing latent bug that becomes more likely with parallelism.

---

### Pitfall 14: Absinthe Schema DSL Looks Nothing Like Standard GraphQL SDL

**What goes wrong:**
You build a GraphQL extractor that parses `.graphql` files. But Fresha's Elixir repos likely define GraphQL schemas using Absinthe macros in `.ex` files, not in separate `.graphql` SDL files. The Absinthe DSL uses Elixir syntax:

```elixir
object :booking do
  field :id, non_null(:id)
  field :customer, :customer, resolve: &Resolvers.customer/3
end

query do
  field :booking, :booking do
    arg :id, non_null(:id)
    resolve &Resolvers.get_booking/3
  end
end
```

This is completely different from SDL syntax and requires Elixir-specific regex patterns, not GraphQL parsers.

**Prevention:**
1. Check your actual repos: `grep -r "use Absinthe" ~/Documents/Repos/*/lib/` to see if Absinthe is used. `find ~/Documents/Repos/ -name "*.graphql"` to see if SDL files exist.
2. Write two extractor paths: one for `.graphql` SDL files, one for Absinthe macros in `.ex` files
3. For Absinthe: extract `object :name`, `field :name, :type`, `query do`, `mutation do`, `subscription do` patterns
4. The metadata extractor already detects `absinthe` in mix.exs deps (line 21) -- use this to conditionally run the Absinthe extractor only on repos that use it

**Phase to address:** Phase 4 of v1.1 (new extractors). Validate which format your repos actually use before building.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Severity | Mitigation |
|-------------|---------------|----------|------------|
| Branch-aware git tracking | Detached HEAD crashes indexer | CRITICAL | Error handling + fallback to rev-parse HEAD |
| Branch-aware git tracking | Wrong diff after branch switch | MODERATE | Fall back to full re-index when branch changed |
| Surgical file updates | Orphaned FTS entries | CRITICAL | Clean FTS before entity deletion, within transaction |
| Surgical file updates | Dangling cross-repo edges | CRITICAL | Delete edges referencing changed repo's entities |
| Surgical file updates | New extractors missing source_file | MODERATE | Convention + test for each extractor |
| Parallel execution | SQLite write lock contention | CRITICAL | Parallelize extraction only, serialize writes |
| Parallel execution | I/O-bound not CPU-bound | MINOR | Profile first, use p-limit not worker threads |
| Parallel execution | MCP sync conflicts with CLI | MODERATE | Add busy_timeout, lock mechanism |
| GraphQL extractor | Absinthe DSL != standard SDL | MODERATE | Check actual repos, build both paths |
| Ecto extractor | Duplicates existing module data | MODERATE | Enrich existing modules, don't create new entity type |
| gRPC extractor | Proto services already extracted | MODERATE | Persist what's already there, then add client detection |
| Event Catalog | No HTTP API -- SDK is filesystem-based | CRITICAL | Redesign as file-based integration, not HTTP |
| Schema migration | ALTER TABLE limitations in SQLite | MODERATE | ADD COLUMN only, test against real v1.0 databases |

## Integration Pitfalls Specific to v1.1

| Integration Point | What Can Go Wrong | Correct Approach |
|-------------------|-------------------|------------------|
| Branch tracking + incremental index | Stored commit is on a different branch than current HEAD | Store branch name alongside commit SHA |
| Surgical updates + FTS5 | FTS entries orphaned when entities get new IDs | Delete FTS entries BEFORE deleting entity rows |
| Surgical updates + edges | Cross-repo edge target IDs become dangling | Delete edges pointing to re-indexed repo's entities |
| Parallel extraction + DB writes | Multiple workers writing simultaneously | Extract in parallel, write from main thread only |
| New extractors + clearRepoFiles | New entity types not cleaned up on file deletion | All entities must have source_file for cleanup |
| EventCatalog + pipeline | Async SDK in synchronous pipeline | Parse catalog files directly, or await SDK calls |
| GraphQL + Elixir extractor | Absinthe schemas in .ex files, not .graphql | Detect Absinthe usage, use Elixir regex patterns |
| Ecto + Elixir extractor | Duplicate module entities for schemas | Enrich existing module records, don't duplicate |

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Orphaned FTS entries | LOW | Run `kb index --force` to do full wipe-and-rewrite |
| Dangling cross-repo edges | LOW | `DELETE FROM edges WHERE target_id NOT IN (SELECT id FROM events)` then re-index |
| SQLite write lock errors | NONE | Fix architecture (serialize writes), re-run |
| Wrong branch diff | LOW | `kb index --force` for affected repos |
| Duplicate entities from Ecto | MEDIUM | Schema migration to merge duplicates, fix extractor |
| EventCatalog HTTP assumption | MEDIUM | Redesign to file-based, ~2-4 hours rework |
| Absinthe not detected | LOW | Add Absinthe regex patterns, re-index repos with absinthe |

## "Looks Done But Isn't" Checklist for v1.1

- [ ] **Detached HEAD:** Test indexer against a repo in detached HEAD state -- does it index or skip gracefully?
- [ ] **FTS consistency:** After incremental re-index, count FTS entries vs entity rows -- do they match?
- [ ] **Cross-repo edges:** After re-indexing one producer repo, query its consumers -- are edges intact?
- [ ] **Parallel writes:** Run `kb index` with parallel enabled while MCP server is active -- any SQLITE_BUSY errors?
- [ ] **File path convention:** All new extractors use `path.relative(repoPath, filePath)` for source_file values?
- [ ] **Changed file threshold:** Does surgical update fall back to full re-index for massive diffs (e.g., after a merge)?
- [ ] **EventCatalog path:** Is the catalog path configurable, and does the integration work without an HTTP endpoint?
- [ ] **Absinthe detection:** Does the GraphQL extractor handle Absinthe macros, not just SDL files?
- [ ] **Proto services persisted:** Are proto services from the existing extractor now saved to the DB?
- [ ] **Migration tested:** Does the v1.1 schema migration work on an existing v1.0 database without data loss?

## Sources

- [better-sqlite3 worker threads documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md) - Official threading guidelines (HIGH confidence)
- [SQLite WAL mode documentation](https://sqlite.org/wal.html) - Concurrent write limitations (HIGH confidence)
- [SQLite concurrent writes and "database is locked" errors](https://tenthousandmeters.com/blog/sqlite-concurrent-writes-and-database-is-locked-errors/) - WAL write locking behavior (HIGH confidence)
- [SQLite FTS5 documentation](https://sqlite.org/fts5.html) - FTS external content consistency (HIGH confidence)
- [EventCatalog SDK documentation](https://www.eventcatalog.dev/docs/sdk) - File-based SDK, not HTTP (HIGH confidence)
- [@eventcatalog/sdk npm package](https://www.npmjs.com/package/@eventcatalog/sdk) - SDK usage patterns (HIGH confidence)
- [git-symbolic-ref documentation](https://git-scm.com/docs/git-symbolic-ref) - Detached HEAD behavior (HIGH confidence)
- [git-rev-parse documentation](https://git-scm.com/docs/git-rev-parse) - Branch detection patterns (HIGH confidence)
- [Scaling SQLite with Node worker threads](https://dev.to/lovestaco/scaling-sqlite-with-node-worker-threads-and-better-sqlite3-4189) - Worker thread patterns (MEDIUM confidence)
- Source code analysis: `src/indexer/pipeline.ts`, `src/indexer/writer.ts`, `src/indexer/git.ts`, `src/db/fts.ts`, `src/mcp/sync.ts` (HIGH confidence - direct code review)

---
*Pitfalls research for: v1.1 Improved Reindexing and New Extractors*
*Researched: 2026-03-06*
*Supersedes: v1.0 pitfalls from 2026-03-05 (those remain valid; this document covers v1.1-specific additions)*
