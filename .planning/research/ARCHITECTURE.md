# Architecture Review: v1.2 Hardening & Module Tightening

**Domain:** Existing Node.js/TypeScript knowledge base CLI — module architecture review
**Researched:** 2026-03-07
**Confidence:** HIGH (direct codebase analysis of all 46 source files + 25 test files)

## Executive Summary

The codebase is in good shape for a 5.7K LOC project built in ~20 hours. Layering is clean: CLI and MCP are thin wrappers over core modules. There are no circular dependencies. The dependency graph flows downward: interface layers (CLI, MCP) -> core modules (search, indexer, knowledge) -> DB layer -> types. The few issues are the kind you'd expect from rapid development: code duplication in pipeline.ts, inconsistent extractor interfaces, FTS entity indexing split across two code paths, and test setup boilerplate repeated in every file.

The biggest wins are in three areas:
1. **pipeline.ts** is 788 lines with massive duplication between `indexSingleRepo` and `extractRepoData`/`persistExtractedData` -- nearly identical extraction logic repeated twice
2. **FTS indexing** has two divergent code paths (indexEntity in fts.ts vs raw INSERT in knowledge/store.ts)
3. **Test setup** repeats the same temp-dir + openDatabase + cleanup pattern in all 25 test files

None of these require architectural restructuring. They're all tighten-in-place fixes.

## Current Module Architecture

```
Interface Layer (thin wrappers, no business logic)
  ┌─────────────────────┐    ┌─────────────────────────────┐
  │  cli/               │    │  mcp/                       │
  │  ├── index.ts       │    │  ├── server.ts (factory)    │
  │  ├── db.ts (withDb) │    │  ├── format.ts (4KB limit)  │
  │  ├── output.ts      │    │  ├── sync.ts (auto-reindex) │
  │  └── commands/      │    │  ├── hygiene.ts (cleanup)   │
  │      └── 8 files    │    │  └── tools/ (8 files)       │
  └──────────┬──────────┘    └──────────────┬──────────────┘
             │                              │
             ├──────────────────────────────┘
             v
Core Layer (business logic, DB-aware)
  ┌─────────────────┐  ┌────────────────┐  ┌──────────────┐
  │  search/         │  │  indexer/       │  │  knowledge/  │
  │  ├── text.ts     │  │  ├── pipeline  │  │  ├── store   │
  │  ├── entity.ts   │  │  ├── writer    │  │  └── types   │
  │  ├── deps.ts     │  │  ├── scanner   │  └──────────────┘
  │  └── types.ts    │  │  ├── metadata  │
  └────────┬─────────┘  │  ├── git       │
           │            │  ├── elixir    │
           │            │  ├── proto     │
           │            │  ├── graphql   │
           │            │  ├── events    │
           │            │  └── catalog   │
           │            └───────┬────────┘
           │                    │
           v                    v
DB Layer (pure data operations)
  ┌───────────────────────────────────────┐
  │  db/                                  │
  │  ├── database.ts (open/close/pragma)  │
  │  ├── schema.ts (version check)        │
  │  ├── migrations.ts (V1-V4)           │
  │  ├── fts.ts (FTS5 CRUD + type ops)   │
  │  └── tokenizer.ts (pure function)    │
  └───────────────────────────────────────┘
           │
  ┌────────┴──────────┐
  │  types/entities.ts │  (shared type definitions)
  └───────────────────┘
```

### Dependency Direction (verified, no cycles)

All imports flow downward through the layers:
- **CLI commands** import from `search/`, `knowledge/`, `db/fts.ts`, `cli/db.ts`, `cli/output.ts`
- **MCP tools** import from `search/`, `knowledge/`, `mcp/format.ts`, `mcp/sync.ts`
- **MCP sync/hygiene** import from `indexer/` -- this is the only cross-layer import within the core, and it's justified (sync needs to trigger re-indexing)
- **search/** imports from `db/fts.ts`, `db/tokenizer.ts`, `types/entities.ts`
- **indexer/writer** imports from `db/fts.ts` -- the one upward-adjacent dependency, necessary for FTS sync
- **knowledge/store** imports from `db/tokenizer.ts` -- but bypasses `db/fts.ts` (problem, see below)
- **db/** only imports from `types/`

No circular dependencies exist. Layer boundaries are respected.

## Findings by Area

### 1. Code Duplication: pipeline.ts (CRITICAL)

**The problem:** `pipeline.ts` is 788 lines -- the largest file by far -- because it contains two nearly identical extraction flows:

- `indexSingleRepo()` (lines 448-637): Used for single repo indexing and by `mcp/sync.ts`
- `extractRepoData()` + `persistExtractedData()` (lines 83-286): Used by `indexAllRepos()` for parallel batching

Both paths contain identical:
- Extractor invocations (extractElixirModules, extractProtoDefinitions, extractGraphqlDefinitions)
- Module mapping logic (elixirModuleData, graphqlModules, absintheModules, allModules)
- Service mapping from proto definitions
- Surgical vs full mode determination
- Event data assembly from proto messages

**How it happened:** `indexAllRepos` was refactored for parallel extraction (phase 2 = parallel, phase 3 = serial persist), so the extraction logic was duplicated into `extractRepoData`. `indexSingleRepo` was kept as-is for the sync path.

**Fix:** Extract a shared `extractRepoData()` function used by both paths. `indexSingleRepo` becomes: snapshot DB state -> `extractRepoData()` -> `persistExtractedData()`. The 3-phase pipeline in `indexAllRepos` uses the same functions.

**Impact:** ~200 LOC reduction, single source of truth for extraction logic.

### 2. FTS Indexing: Two Divergent Paths (HIGH)

**The problem:** There are two ways entities get indexed into FTS:

1. **Via `db/fts.ts` `indexEntity()`**: Used by `indexer/writer.ts` for repos, modules, events, services. Handles tokenization, composite type formatting, and delete-then-insert upsert.

2. **Via raw INSERT in `knowledge/store.ts` `learnFact()`**: Directly inserts into `knowledge_fts` with its own tokenization call. Uses `'learned_fact'` as entity_type (not composite format -- writes `'learned_fact'` instead of `'learned_fact:learned_fact'`).

This means:
- `learnFact` produces entity_type = `'learned_fact'` while `indexEntity` would produce `'learned_fact:learned_fact'`
- `forgetFact` deletes with `entity_type = 'learned_fact'` (exact match) while `removeEntity` uses `LIKE 'type:%'` pattern
- The composite type system is inconsistent for learned facts

The `text.ts` hydration handles this because `parseCompositeType` falls back for strings without colons (returns `{ entityType: 'learned_fact', subType: 'learned_fact' }`), but it's fragile.

**Fix:** Either:
- (a) Add `'learned_fact'` to `EntityType` and use `indexEntity()` / `removeEntity()` in `knowledge/store.ts`
- (b) Or create a dedicated `indexFact()` / `removeFact()` in `db/fts.ts` that explicitly uses the composite format

Option (a) is cleaner. The EntityType union just needs to include `'learned_fact'`.

### 3. Extractor Interface Inconsistency (MEDIUM)

**The problem:** The five extractors have three different interface patterns:

| Extractor | Input | Returns | Notes |
|-----------|-------|---------|-------|
| `extractElixirModules` | `(repoPath, branch)` | `ElixirModule[]` | Rich type with many fields |
| `extractProtoDefinitions` | `(repoPath, branch)` | `ProtoDefinition[]` | File-grouped with messages + services |
| `extractGraphqlDefinitions` | `(repoPath, branch)` | `GraphqlDefinition[]` | File-grouped with types |
| `detectEventRelationships` | `(repoPath, branch, protos, elixirModules)` | `EventRelationship[]` | Depends on other extractors' output |
| `enrichFromEventCatalog` | `(db, rootDir)` | `{matched, skipped}` | DB-aware, runs post-persist, filesystem-based |

The first three follow the same pattern (repo + branch -> parsed data), which is good. `detectEventRelationships` takes other extractors' output as input -- reasonable since it correlates across types. `enrichFromEventCatalog` is the outlier: it reads from filesystem (not git branch) and writes directly to DB.

Each extractor also internally calls `listBranchFiles` + `readBranchFile` independently, which means the same `git ls-tree` is called 3+ times per repo (once per extractor). This is cached by the OS but still redundant.

**Fix:**
- Share the `listBranchFiles` result across extractors by passing it as a parameter or computing once in the pipeline
- Consider a common `ExtractorContext` type: `{ repoPath: string; branch: string; allFiles: string[]; readFile: (path: string) => string | null }`
- Leave `enrichFromEventCatalog` as-is -- it's a post-processing enrichment step, not a per-repo extractor

### 4. DB Access Patterns (MEDIUM)

**What's good:**
- `better-sqlite3` is synchronous, so no connection pool management needed
- Transactions are used correctly in `persistRepoData`, `persistSurgicalData`, `forgetFact`
- `withDb` / `withDbAsync` in CLI ensures connections are always closed
- WAL mode + NORMAL sync is the right default for local-only tool

**What could be tighter:**

**4a. Statement preparation inside loops.** In `clearRepoEntities`, `clearRepoFiles`, and `insertEventEdges`, statements like `db.prepare(...)` are called inside loops. `better-sqlite3` does cache prepared statements internally, so this isn't a performance bug, but it's an inconsistent pattern -- some functions (like `persistSurgicalData`) prepare once outside the loop and reuse.

**4b. Missing transaction boundaries.** `clearRepoEntities()` is not wrapped in a transaction. It's a multi-step operation (delete FTS entries, delete modules, delete events, delete files, delete services) that could leave the DB in an inconsistent state if interrupted. The caller `persistRepoData` wraps it in a transaction, but `clearRepoEntities` is also called directly from `mcp/hygiene.ts` `pruneDeletedRepos` which wraps its own transaction -- so this works, but the function's API doesn't make this requirement explicit.

**4c. Edge clearing is scattered.** Edge deletion logic is spread across:
- `clearRepoEntities` (deletes edges by source_type='repo')
- `clearRepoEdges` (deletes edges by source_type='repo' AND by service source)
- `clearRepoFiles` (deletes edges by source_file)
- `insertEventEdges` / `insertGrpcClientEdges` / `insertEctoAssociationEdges` in pipeline.ts

This makes it hard to reason about edge lifecycle. All edge operations are correct today, but adding a new edge type would require touching multiple files.

**Fix:**
- Move edge operations into `writer.ts` (they're currently in `pipeline.ts`)
- Make `clearRepoEntities` explicitly document that it must run inside a transaction, or wrap itself in one (idempotent via `db.transaction` nesting)

### 5. Error Propagation Patterns (MEDIUM)

**What's good:**
- Extractors use try/catch with `continue` to skip bad files (error isolation)
- MCP tools wrap all handlers in try/catch and return `isError: true`
- Pipeline catches per-repo errors and continues to next repo

**What's inconsistent:**

**5a. Silent error swallowing.** Many catch blocks are empty: extractors catch and skip files without any logging. This is fine for the "skip unreadable files" case, but makes debugging hard when extractors silently produce no output for a repo.

**5b. `console.warn` vs `console.error` vs silent.** Error reporting is inconsistent:
- `pipeline.ts`: `console.error` for repo failures, `console.warn` for catalog enrichment
- `mcp/server.ts`: `console.error` for fatal errors
- CLI: `outputError()` for user-facing errors
- Extractors: silent skip

There's no structured logging. Not a problem at current scale, but would help debugging.

**5c. The `resolveDefaultBranch` function swallows `gh` CLI failures.** It calls `gh repo view` with a 5-second timeout, and if `gh` is not installed or network is unavailable, it silently falls back to main/master probing. This is correct behavior but the timeout can delay indexing by 5 seconds per repo if `gh` is installed but the network is slow.

### 6. Shared State / Globals (LOW)

The codebase has almost no shared mutable state. Key observations:
- DB connection is passed explicitly via function parameters (no singleton)
- CLI uses `withDb` for lifecycle management
- MCP creates one connection in `main()` and passes it to `createServer` -> all tools
- `SCHEMA_VERSION` and `COARSE_TYPES` are module-level constants (immutable)
- `registerShutdownHandlers` installs process listeners -- these are global side effects but only run in the CLI/MCP entry points, not in tests
- `p-limit` in pipeline.ts is created per `indexAllRepos` call (not shared)

No fixes needed here. This is clean.

### 7. Testing Architecture (MEDIUM)

**What's good:**
- 388 tests across 25 files, solid coverage
- Tests mirror src/ structure (tests/db/, tests/indexer/, tests/search/, etc.)
- Pure parse functions (parseElixirFile, parseProtoFile, parseGraphqlFile) are tested without DB
- MCP tools are tested via direct handler invocation (smart -- avoids stdio transport)
- Pipeline tests create real git repos with `git init` + `git commit`

**What's repetitive:**

**7a. DB setup boilerplate.** Every test file that needs a database repeats this:

```typescript
let db: Database.Database;
let dbPath: string;

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-UNIQUE-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  const dir = path.dirname(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
});
```

This pattern appears in 18+ test files. A shared test helper would eliminate ~100 lines of boilerplate.

**7b. Test data factory duplication.** Multiple test files create similar RepoMetadata objects, module data, etc. The `writer.test.ts` has `makeMetadata()`, and `text.test.ts` has inline `persistRepoData` calls with similar data. These could share fixture factories.

**7c. MCP tool testing uses internal `_registeredTools` access.** The `callTool` helper in `tools.test.ts` accesses `(server as unknown as { _registeredTools: ... })._registeredTools[toolName]`, which is brittle -- internal API of McpServer that could break on SDK upgrades.

**Fix:**
- Create `tests/helpers/db.ts` with `createTestDb()` returning `{ db, cleanup }` and maybe a vitest fixture
- Create `tests/helpers/fixtures.ts` with factory functions for common test data
- For MCP tool testing, consider using the SDK's in-memory transport if available, or accept the internal access as a pragmatic choice and document it

## Module Coupling Analysis

### Import Graph (most-imported modules)

| Module | Imported By | Role |
|--------|-------------|------|
| `db/fts.ts` | writer, search/text, search/entity, search/index, cli/search, mcp/list-types | FTS operations hub |
| `db/tokenizer.ts` | fts, search/text, search/entity, knowledge/store | Pure tokenization |
| `types/entities.ts` | fts, writer, search/text, search/entity, search/types | Type definitions |
| `indexer/git.ts` | elixir, proto, graphql, events, metadata, pipeline, mcp/sync, mcp/status | Git operations |
| `knowledge/store.ts` | cli/learn, cli/learned, cli/forget, mcp/learn, mcp/forget | CRUD for facts |
| `mcp/format.ts` | All MCP tools except status | Response sizing |
| `mcp/sync.ts` | MCP tools: search, entity, deps | Auto-reindex |

**Observations:**
- `db/fts.ts` is the most coupled module -- it's imported by 6 files across 3 layers. This is acceptable because it's the central FTS abstraction, but the `search/index.ts` barrel re-exporting `listAvailableTypes` from `../db/fts.js` creates a layer violation: search module's public API includes a raw DB function.
- `indexer/git.ts` is imported by 8 files but only within the indexer layer + MCP (where sync/status need git operations). Clean.
- `mcp/sync.ts` importing from `indexer/pipeline.ts` is the one cross-core-module dependency. Justified.

### Layer Boundary Violations

| Violation | Where | Severity | Notes |
|-----------|-------|----------|-------|
| search/index.ts re-exports from db/fts.ts | `export { listAvailableTypes } from '../db/fts.js'` | LOW | Should be wrapped in a search-layer function |
| search/text.ts imports from db/fts.ts | `resolveTypeFilter`, `parseCompositeType` | LOW | FTS query construction belongs in search, but the FTS filter utilities live in db |
| search/entity.ts imports from db/fts.ts | `COARSE_TYPES`, `resolveTypeFilter`, `parseCompositeType` | LOW | Same as above |
| mcp/tools/list-types.ts imports from db/fts.ts | `listAvailableTypes` | LOW | Bypasses search layer |
| mcp/tools/status.ts imports from indexer/git.ts | `getCurrentCommit` | LOW | Could go through a status query in search layer |
| knowledge/store.ts bypasses db/fts.ts | Raw FTS INSERT instead of indexEntity | MEDIUM | See Finding #2 |

These are all LOW severity individually. The search -> db/fts imports are defensible because `db/fts.ts` is an FTS utility layer that both search and indexer need. But if this bothers you, the type filter utilities (`resolveTypeFilter`, `parseCompositeType`, `COARSE_TYPES`, `listAvailableTypes`) could move into `search/types.ts` or a new `search/fts-helpers.ts`.

## What NOT to Refactor (Leave Alone)

These are well-designed and should be preserved as-is:

| Module | Why It's Good |
|--------|---------------|
| `db/database.ts` | Minimal, correct. WAL + FK + NORMAL pragma. Clean open/close/shutdown. |
| `db/tokenizer.ts` | Pure function, well-tested, zero dependencies. |
| `db/migrations.ts` | Simple sequential migrations, transaction-wrapped. |
| `cli/db.ts` | `withDb`/`withDbAsync` is exactly the right pattern for CLI lifecycle. |
| `cli/output.ts` | Minimal JSON output. Nothing to improve. |
| `mcp/format.ts` | Recursive halving for 4KB limit is elegant and well-tested. |
| `mcp/server.ts` | Clean factory pattern. Good DI of DB connection. |
| `indexer/scanner.ts` | Simple, correct. No changes needed. |
| `indexer/git.ts` | Comprehensive git plumbing. Each function is independent and well-named. |
| `search/dependencies.ts` | BFS with cycle detection, clean separation. |
| `knowledge/` | Two files, clear CRUD. Only fix is the FTS path (Finding #2). |
| All pure parser functions | `parseElixirFile`, `parseProtoFile`, `parseGraphqlFile`, `parseFrontmatter` -- pure, testable. |

## Suggested Review Order

Based on coupling (review high-coupling modules first, so fixes propagate cleanly):

| Order | Module(s) | Focus Area | Estimated Impact |
|-------|-----------|------------|------------------|
| 1 | `indexer/pipeline.ts` | Dedup extraction logic, extract shared function | HIGH -- 200+ LOC reduction |
| 2 | `db/fts.ts` + `knowledge/store.ts` | Unify FTS indexing path, add learned_fact to EntityType | HIGH -- consistency fix |
| 3 | `indexer/writer.ts` + edge operations in pipeline.ts | Consolidate edge CRUD into writer | MEDIUM -- maintainability |
| 4 | Test helpers | Extract DB setup, fixture factories | MEDIUM -- reduce boilerplate |
| 5 | Extractor interface | Share file listing, optional ExtractorContext | LOW-MEDIUM -- performance + consistency |
| 6 | `search/text.ts` + `search/entity.ts` | Statement preparation, type filter extraction | LOW -- minor cleanup |
| 7 | Error handling consistency | Add structured logging for silent catch blocks | LOW -- debugging aid |

## Data Flow

### Indexing Flow (current)

```
CLI: kb index --root ~/Repos
  |
  v
withDbAsync -> openDatabase -> initializeSchema (migrations)
  |
  v
indexAllRepos(db, options)
  |
  +-- Phase 1 (sequential): discoverRepos -> resolveDefaultBranch -> checkSkip -> snapshot DB
  |
  +-- Phase 2 (parallel, p-limit): extractRepoData(repoPath, options, branch, dbSnapshot)
  |     |
  |     +-- extractMetadata (git show README, mix.exs, etc.)
  |     +-- extractElixirModules (git ls-tree -> git show per .ex file -> parseElixirFile)
  |     +-- extractProtoDefinitions (git ls-tree -> git show per .proto -> parseProtoFile)
  |     +-- extractGraphqlDefinitions (git ls-tree -> git show per .graphql -> parseGraphqlFile)
  |     +-- detectEventRelationships (from proto + elixir data + scan .ex for consumers)
  |     +-- determine surgical vs full mode
  |     +-- return ExtractedRepoData (no DB access in this phase)
  |
  +-- Phase 3 (sequential): persistExtractedData(db, extracted)
        |
        +-- persistRepoData or persistSurgicalData (transaction-wrapped)
        |     +-- upsertRepo
        |     +-- clearRepoEntities or clearRepoFiles
        |     +-- insert modules + FTS index
        |     +-- insert events + FTS index
        |     +-- insert services + FTS index
        |
        +-- insertEventEdges (outside transaction)
        +-- insertGrpcClientEdges (outside transaction)
        +-- insertEctoAssociationEdges (outside transaction)
  |
  +-- enrichFromEventCatalog (post-persist, filesystem-based)
```

### Search Flow (current)

```
MCP: kb_search(query, options)
  |
  v
searchText(db, query, options)
  |
  +-- tokenizeForFts(query)
  +-- build SQL with optional type filter (resolveTypeFilter)
  +-- FTS5 MATCH query (try raw, fallback to phrase)
  +-- for each FTS match: hydrateResult(db, match)
  |     +-- parseCompositeType(entity_type)
  |     +-- switch on entityType -> JOIN with source table (repos/modules/events/services/learned_facts)
  |     +-- return TextSearchResult with repo context
  +-- apply repoFilter post-hydration
  |
  v
checkAndSyncRepos(db, resultRepoNames)
  +-- for each repo: compare HEAD vs stored commit
  +-- re-index up to 3 stale repos
  +-- if any synced: re-run searchText
  |
  v
formatResponse(results, summaryFn)
  +-- slice to maxItems, build McpResponse
  +-- if > 4KB: recursive halving
  +-- return JSON string
```

## Anti-Patterns Found

### Anti-Pattern 1: Copy-Paste Pipeline Logic

**What happened:** Two complete extraction pipelines exist in pipeline.ts
**Why it happened:** Parallel indexing needed separation of extraction (CPU-bound) from persistence (DB-bound), but the existing `indexSingleRepo` was kept for the sync path
**What breaks:** Any extractor change or new extractor must be applied in two places
**Fix:** Single extraction function, two callers

### Anti-Pattern 2: Raw SQL Outside DB Layer

**What happened:** `knowledge/store.ts` writes raw FTS INSERT instead of using `db/fts.ts`
**Why it happened:** `EntityType` didn't include `'learned_fact'`, so `indexEntity()` couldn't be used
**What breaks:** Inconsistent composite type format in FTS table
**Fix:** Extend EntityType, use indexEntity/removeEntity

### Anti-Pattern 3: Edge Operations in Pipeline

**What happened:** `insertEventEdges`, `insertGrpcClientEdges`, `insertEctoAssociationEdges` live in pipeline.ts (380+ LOC), not in writer.ts
**Why it happened:** Edge insertion requires entity lookups that cross extractors (find event by name, find module by name), which felt pipeline-level
**What breaks:** Edge lifecycle management is split across two files. Adding a new edge type means modifying pipeline.ts (which is already too large)
**Fix:** Move to writer.ts or a new `indexer/edges.ts`

## Integration Points

| Boundary | How They Connect | Health |
|----------|------------------|--------|
| CLI -> core | `withDb(fn)` passes DB to core functions | Clean |
| MCP -> core | `createServer(db)` passes DB to all tools via closure | Clean |
| search -> db/fts | Direct import of type filter utilities | Minor layer leak, functional |
| indexer/writer -> db/fts | `indexEntity` / `removeEntity` for FTS sync | Clean |
| knowledge -> db | Bypasses fts.ts, uses raw SQL | Needs fix |
| mcp/sync -> indexer | Calls `indexSingleRepo` for auto-reindex | Clean, justified |
| mcp/hygiene -> indexer/writer | Calls `clearRepoEntities` for cleanup | Clean |
| pipeline -> extractors | Direct function calls, no common interface | Works, could be tighter |
| pipeline -> writer | Calls `persistRepoData` / `persistSurgicalData` | Clean |
| All -> types/entities.ts | Shared EntityType union | Clean, needs learned_fact |

## Sources

- Direct codebase analysis of all 46 source files and 25 test files
- Import graph traced manually across all modules
- Test pattern analysis across all beforeEach/afterEach blocks
- better-sqlite3 documentation (statement caching behavior)

---
*Architecture review for: repo-knowledge-base v1.2 Hardening*
*Researched: 2026-03-07*
