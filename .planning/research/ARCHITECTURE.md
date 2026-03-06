# Architecture: v1.1 Integration Analysis

**Domain:** Improved reindexing and new extractors for existing knowledge base CLI
**Researched:** 2026-03-06
**Overall confidence:** HIGH (based on direct codebase analysis + verified domain patterns)

## Executive Summary

The v1.1 features split into two categories: **pipeline infrastructure changes** (branch-aware tracking, surgical file-level indexing, parallel execution) and **new extractors** (GraphQL/Absinthe, gRPC, Ecto, Event Catalog). The good news: the existing architecture is well-layered enough that new extractors are pure additions. The bad news: surgical file-level indexing requires reworking the core pipeline's relationship between extractors and the writer, because today's extractors scan entire repos and the writer does full wipe-and-rewrite per repo.

## Current Architecture (What Exists)

```
Pipeline Flow (today):
  discoverRepos(rootDir)
      |
      v
  for each repo (sequential):
      |
      +-- checkSkip(db, repoPath)  -- compare commit SHA, skip if unchanged
      |
      +-- indexSingleRepo(db, repoPath, options):
            |
            +-- extractMetadata(repoPath)       -- scans README, mix.exs, etc.
            +-- detect isIncremental             -- checks if old commit reachable
            +-- clearRepoFiles(deleted files)    -- ONLY handles deleted files
            +-- extractElixirModules(repoPath)   -- scans ALL .ex files in lib/
            +-- extractProtoDefinitions(repoPath)-- scans ALL .proto files
            +-- detectEventRelationships(...)    -- scans ALL .ex files again
            +-- persistRepoData(db, data):
                  |
                  +-- upsertRepo(metadata)
                  +-- clearRepoEntities(repoId)  ** FULL WIPE **
                  +-- insert all modules, events, FTS entries
            +-- insertEventEdges(...)
```

### Critical Observation

Despite having `isIncremental` detection and `clearRepoFiles()` for surgical deletion, the pipeline **always does full extraction + full wipe-and-rewrite**. The incremental path only handles clearing data for deleted files before the full wipe happens anyway. `clearRepoFiles` exists but its effect is immediately erased by `clearRepoEntities` in `persistRepoData`.

This means surgical file-level indexing is not a tweak -- it is a pipeline mode change.

## Integration Analysis: Feature by Feature

### 1. Branch-Aware Tracking

**What changes:** `git.ts` + `pipeline.ts` (checkSkip)
**What's new:** Nothing new needed beyond modifying `getCurrentCommit`
**Complexity:** Low

Today, `getCurrentCommit` runs `git rev-parse HEAD`, which returns whatever branch is checked out -- including PR branches a developer might be reviewing. The fix is to resolve the main/master branch ref instead of HEAD.

**Implementation approach:**

```typescript
// git.ts -- new function
export function getDefaultBranchCommit(repoPath: string): string | null {
  // Try refs in order: main, master, then fall back to HEAD
  for (const branch of ['main', 'master']) {
    try {
      const sha = execSync(`git rev-parse refs/heads/${branch}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (sha) return sha;
    } catch {
      continue;
    }
  }
  // Fallback: use HEAD (detached HEAD, unusual branch names)
  return getCurrentCommit(repoPath);
}
```

**Changes to existing code:**
- `git.ts`: Add `getDefaultBranchCommit()` function
- `metadata.ts`: Change `extractMetadata` to call `getDefaultBranchCommit` instead of `getCurrentCommit`
- `pipeline.ts` (checkSkip): The comparison logic stays the same since it already compares stored commit vs current commit

**For `getChangedFiles`:** Must also diff against the default branch commit, not HEAD. Current signature `getChangedFiles(repoPath, sinceCommit)` already takes the old commit and diffs to HEAD. Change the diff target:

```typescript
// Instead of: git diff --name-status ${sinceCommit}..HEAD
// Use:        git diff --name-status ${sinceCommit}..${defaultBranch}
export function getChangedFiles(
  repoPath: string,
  sinceCommit: string,
  targetRef?: string, // default: resolved main/master branch
): { added: string[]; modified: string[]; deleted: string[] }
```

**Integration points:** 2 modified files (git.ts, metadata.ts), 0 new files
**Risk:** Low. A branch name resolution failure falls back to HEAD, maintaining current behavior.

---

### 2. Surgical File-Level Indexing

**What changes:** `pipeline.ts`, `writer.ts`, all extractors
**What's new:** Extractor interface refactoring, file-scoped persistence
**Complexity:** HIGH -- this is the biggest architectural change

**The core problem:** Today's extractors take a `repoPath` and internally find+read all relevant files. The pipeline has no way to tell an extractor "only process these specific files." And `persistRepoData` always calls `clearRepoEntities` (full wipe) before inserting.

**Required changes:**

#### A. Extractor Interface: Add File-Scoped Mode

Each extractor needs to accept an optional file filter. Two approaches:

**Option A (recommended): Filter at the file-discovery layer.**
Extractors already have internal `findExFiles` / `findProtoFiles` functions. Add a `fileFilter` parameter that, when provided, intersects with the discovered files.

```typescript
// Before (elixir.ts):
export function extractElixirModules(repoPath: string): ElixirModule[]

// After:
export function extractElixirModules(
  repoPath: string,
  changedFiles?: Set<string>,  // relative paths; if provided, only process these
): ElixirModule[]
```

Inside the extractor, when `changedFiles` is provided, skip files not in the set. This is minimally invasive -- each extractor needs ~3 lines of filtering added.

**Option B (rejected): Extractors accept file content directly.**
This would require the pipeline to read files and pass content to extractors. But extractors like Elixir/proto need to discover files by extension within directories, and the event detector needs to scan for consumer patterns across multiple files. Passing individual files breaks cross-file analysis.

#### B. Writer: Add File-Scoped Persistence Mode

`persistRepoData` needs a mode that clears+reinserts only entities from specific files, not the whole repo.

```typescript
// New function alongside existing persistRepoData:
export function persistFileData(
  db: Database.Database,
  repoId: number,
  changedFiles: string[],  // files being re-indexed
  data: Omit<RepoData, 'metadata'>,
): void {
  db.transaction(() => {
    // 1. Clear entities from changed files only
    clearRepoFiles(db, repoId, changedFiles);
    // 2. Insert new entities (same logic as persistRepoData but without repo upsert/wipe)
    insertModules(db, repoId, data.modules ?? []);
    insertEvents(db, repoId, data.events ?? []);
  })();
}
```

The existing `clearRepoFiles` already handles per-file entity removal with FTS cleanup. It just needs to be used in the right place.

#### C. Pipeline: Dual-Mode Orchestration

```typescript
export function indexSingleRepo(db, repoPath, options): IndexStats {
  const metadata = extractMetadata(repoPath);
  const repoName = metadata.name;

  // Determine mode
  const existingRow = getExistingRepo(db, repoName);
  const isIncremental = canDoIncremental(existingRow, metadata, options);

  if (isIncremental) {
    // SURGICAL PATH
    const changes = getChangedFiles(repoPath, existingRow.last_indexed_commit);
    const changedSet = new Set([...changes.added, ...changes.modified]);

    // Update repo metadata (commit SHA, description may have changed)
    upsertRepo(db, metadata);

    // Clear deleted files
    if (changes.deleted.length > 0) {
      clearRepoFiles(db, existingRow.id, changes.deleted);
    }

    // Run extractors with file filter
    const elixirModules = extractElixirModules(repoPath, changedSet);
    const protoDefinitions = extractProtoDefinitions(repoPath, changedSet);
    const eventRelationships = detectEventRelationships(repoPath, protoDefinitions, elixirModules);

    // Persist only changed file entities
    const changedFilePaths = [...changedSet];
    persistFileData(db, existingRow.id, changedFilePaths, { modules, events });
    insertEventEdges(db, existingRow.id, eventRelationships);

  } else {
    // FULL PATH (same as today)
    const stats = fullIndex(db, repoPath, metadata);
    return stats;
  }
}
```

**Integration points:**
- Modified: `pipeline.ts` (dual-mode logic), `writer.ts` (new `persistFileData`), `elixir.ts`, `proto.ts`, `events.ts` (file filter parameter)
- Existing `clearRepoFiles` is already correct for surgical deletion -- it just needs to be called at the right time

**Risk:** MEDIUM. The event detector (`events.ts`) scans for consumer patterns across ALL .ex files in lib/. If only the changed files are processed, a new consumer added in file A that references a proto from unchanged file B will still be detected (the consumer pattern is self-contained per file). But if a proto message name changes in an unchanged proto file, consumers referencing the old name in changed files will create orphaned event entities. This is an acceptable edge case -- `--force` full reindex resolves it.

---

### 3. Parallel Repo Execution

**What changes:** `pipeline.ts` (indexAllRepos)
**What's new:** Worker thread infrastructure OR simple child_process parallelism
**Complexity:** MEDIUM

**The constraint:** `better-sqlite3` connections cannot be shared across threads. Each worker needs its own connection. But all workers write to the same database file. SQLite in WAL mode allows concurrent readers and serializes writers, so parallel writes will work but serialize at the SQLite level.

**Recommended approach: Process-level parallelism with result aggregation.**

Don't use `worker_threads` with multiple DB connections. Instead, separate the CPU-bound work (file reading + regex extraction) from the I/O-bound work (DB writes):

```
Phase 1 (parallel): Extract data from repos (CPU-bound, no DB)
  - Each "worker" runs extractors for one repo
  - Returns structured data (modules, protos, events)
  - No DB access needed

Phase 2 (sequential): Persist results to DB (I/O-bound, single connection)
  - Main thread iterates over extraction results
  - Calls persistRepoData for each
  - Single DB connection, no threading issues
```

**Implementation:**

```typescript
import { cpus } from 'os';

export async function indexAllReposParallel(
  db: Database.Database,
  options: IndexOptions,
): Promise<IndexResult[]> {
  const repos = discoverRepos(options.rootDir);
  const toIndex = repos.filter(r => !shouldSkip(db, r, options));

  // Phase 1: Parallel extraction (no DB access)
  const concurrency = Math.min(cpus().length, 8);
  const extractionResults = await parallelMap(
    toIndex,
    (repoPath) => extractRepoData(repoPath, options), // pure extraction, no DB
    concurrency,
  );

  // Phase 2: Sequential persistence (single DB connection)
  const results: IndexResult[] = [];
  for (const { repoPath, data, error } of extractionResults) {
    if (error) {
      results.push({ repo: path.basename(repoPath), status: 'error', error });
      continue;
    }
    try {
      persistRepoData(db, data);
      results.push({ repo: path.basename(repoPath), status: 'success', stats: data.stats });
    } catch (e) {
      results.push({ repo: path.basename(repoPath), status: 'error', error: e.message });
    }
  }
  return results;
}

// Simple promise-pool for bounded concurrency
async function parallelMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = [];
  const executing = new Set<Promise<void>>();

  for (const item of items) {
    const p = fn(item).then(r => { results.push(r); });
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= concurrency) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
}
```

**Why not worker_threads:** The extraction work is file I/O + regex, which is already fast. The real bottleneck for ~50 repos is the sequential loop. `Promise.all` with bounded concurrency using async file reads gets 80% of the parallelism benefit with 10% of the complexity. Worker threads would only matter if extraction were truly CPU-bound (AST parsing, etc.), which regex-based extractors are not.

**The catch:** Current extractors use `fs.readFileSync`. To parallelize with async concurrency, extractors would need async variants OR we use worker_threads for true parallelism with sync code. A pragmatic middle ground: use `Promise.all` around the existing sync extractors. Node.js will interleave the sync work since each `extractRepoData` call returns a promise that wraps synchronous work. This won't achieve true parallelism but will be enough for the I/O-bound file discovery step.

**Better pragmatic approach: Just use a simple batching loop.**

```typescript
// Batch repos into groups of N, process each group synchronously
// This is dumb but effective for 50-100 repos with sync extractors
function indexAllReposBatched(db, options): IndexResult[] {
  const repos = discoverRepos(options.rootDir);
  // ... skip check ...
  // Process sequentially but with extraction separated from persistence
  // The real win is decoupling extraction from DB writes
}
```

Actually, let me revise: with sync `fs.readFileSync` and sync better-sqlite3, **true parallelism requires worker_threads**. The simplest correct approach:

```typescript
// worker.ts -- runs in worker thread
import { parentPort, workerData } from 'worker_threads';
// Each worker extracts one repo (CPU + file I/O, no DB)
const result = extractRepoData(workerData.repoPath);
parentPort.postMessage(result);
```

**Integration points:**
- Modified: `pipeline.ts` (new `indexAllReposParallel` or batched variant)
- New: `worker.ts` (if using worker_threads) or just a `parallelMap` utility
- Extractors: No changes needed (each worker calls them normally)
- Writer: No changes needed (main thread handles all DB writes sequentially)

**Risk:** LOW if extraction is separated from persistence. The tricky part is serializing the structured extraction results across the worker boundary (they must be serializable -- no DB handles, no file handles). Current extractor return types (`ElixirModule[]`, `ProtoDefinition[]`, `EventRelationship[]`) are already plain objects, so this works.

---

### 4. GraphQL/Absinthe Extractor

**What changes:** Nothing existing
**What's new:** `src/indexer/graphql.ts`, schema changes for new entity data
**Complexity:** MEDIUM

Based on analysis of real Absinthe schemas in the repos (e.g., `app-appointments-manager`), the patterns to extract:

**File discovery:** `.ex` files containing `use Absinthe.Schema` or `use Absinthe.Schema.Notation`

**Extraction targets:**
- **Types:** `object :name do` blocks with their fields
- **Queries:** `field :name` inside `query do` or in modules imported via `import_types`
- **Mutations:** `field :name` inside `mutation do` or imported mutation modules
- **Input objects:** `input_object :name do` blocks
- **Enums:** `enum :name do` blocks

**Regex patterns (validated against real code):**

```typescript
// Object types: object :appointment do
const objectRe = /object\s+:(\w+)\s+do\b/g;

// Fields within objects: field(:id, non_null(:id))  or  field :id, :id
const fieldRe = /field[:\s(]+:(\w+),\s*(?:non_null\()?:?(\w+)/g;

// Input objects: input_object :booking_input do
const inputRe = /input_object\s+:(\w+)\s+do\b/g;

// Enums: enum :appointment_system_status do
const enumRe = /enum\s+:(\w+)\s+do\b/g;

// Mutations: detected by module naming convention *Mutations.* or mutation do block
const mutationRe = /(?:mutation\s+do|field\s*[:(]\s*:(\w+).*resolve)/g;

// Query fields: detected in query do block or Queries.* modules
const queryFieldRe = /field\s*[:(]\s*:(\w+)/g;
```

**Data model:** GraphQL types map to the existing `modules` table with `type: 'graphql_type' | 'graphql_query' | 'graphql_mutation' | 'graphql_input' | 'graphql_enum'`. No schema migration needed -- the `modules` table already has `name`, `type`, `file_path`, and `summary` columns.

**Integration points:**
- New: `src/indexer/graphql.ts`
- Modified: `pipeline.ts` (add extractor call), `writer.ts` types (add GraphQL module types)
- FTS: Automatic -- `persistRepoData` already indexes modules into FTS

---

### 5. gRPC Service Extractor

**What changes:** Minimal -- existing proto extractor already parses gRPC services
**What's new:** `src/indexer/grpc.ts` for the Elixir-side gRPC server/client detection
**Complexity:** LOW

The existing `proto.ts` already extracts `ProtoService` with RPCs from `.proto` files. What's missing is detecting which **repos implement or consume** those gRPC services. In the Fresha codebase:

- **Server side:** Generated `.pb.ex` files in `lib/generated/` with `use GRPC.Server` or `use GRPC.Endpoint`
- **Client side:** Code that calls gRPC stubs, typically via generated client modules

**Extraction approach:** Scan `.ex` files for:
```typescript
// Server: use GRPC.Server, service: SomeService
const grpcServerRe = /use\s+GRPC\.(?:Server|Endpoint)\s*,\s*service:\s*([\w.]+)/g;

// Client calls: SomeService.Stub.some_rpc(channel, request)
const grpcClientRe = /([\w.]+)\.Stub\.(\w+)\s*\(/g;
```

**Data model:** gRPC service relationships become edges:
- `repo -> service (exposes_grpc)` when repo has a GRPC.Server for that service
- `repo -> service (calls_grpc)` when repo calls a gRPC stub

These relationship types already exist in `EntityType` and `RelationshipType`.

**Integration points:**
- New: `src/indexer/grpc.ts`
- Modified: `pipeline.ts` (add extractor call)
- The `services` table may need population with gRPC service names
- Edges table already supports `calls_grpc` and `exposes_graphql` relationship types

---

### 6. Ecto Schema Extractor

**What changes:** Existing `elixir.ts` already partially handles Ecto (it detects `schema "table_name"`)
**What's new:** Enhanced extraction in `src/indexer/ecto.ts` or extended `elixir.ts`
**Complexity:** LOW-MEDIUM

The current `elixir.ts` already:
- Detects `schema "table_name"` and sets `type: 'schema'` and `tableName`
- Extracts module name and public functions

What's missing:
- **Field definitions:** `field :name, :type` within schema blocks
- **Associations:** `belongs_to`, `has_many`, `has_one`, `many_to_many`
- **Database table relationships** derived from associations

**Recommended: Extend `elixir.ts` rather than create a new file.** Ecto schemas ARE Elixir modules. The existing `parseElixirFile` already finds module boundaries. Add field/association extraction within the schema detection block.

```typescript
// New in elixir.ts:
interface EctoField {
  name: string;
  type: string;
}

interface EctoAssociation {
  type: 'belongs_to' | 'has_many' | 'has_one' | 'many_to_many';
  name: string;
  targetModule: string;
}

// Enhanced ElixirModule interface:
interface ElixirModule {
  // ... existing fields ...
  ectoFields?: EctoField[];
  ectoAssociations?: EctoAssociation[];
}
```

**Regex patterns (validated against real Ecto schemas):**

```typescript
// Fields: field :name, :string  or  field(:name, :string)
const fieldRe = /field[:\s(]+:(\w+),\s*:(\w+)/g;

// Associations: belongs_to :appointment, Module.Name
const assocRe = /(belongs_to|has_many|has_one|many_to_many)\s+:(\w+),\s*([\w.]+)/g;
```

**Data model:** Ecto field/association data enhances the module summary in FTS. Associations create edges between modules (e.g., `Booking belongs_to Appointment`). This enriches the dependency graph significantly.

**Integration points:**
- Modified: `src/indexer/elixir.ts` (add field/association extraction)
- Modified: `writer.ts` types (extend `ModuleData` with Ecto-specific fields)
- New edges: module-to-module associations stored in `edges` table

---

### 7. Event Catalog Extractor

**What changes:** This is fundamentally different -- it's not a per-repo extractor
**What's new:** `src/indexer/eventcatalog.ts`, possibly a separate pipeline entry point
**Complexity:** MEDIUM

Event Catalog is a **single repo** (`fresha-event-catalog`) with a well-defined directory structure:

```
src/
  domains/     d:appointments/index.mdx    -- frontmatter: id, name, services, entities
  services/    s:appointments/index.mdx    -- frontmatter: id, name, repository.url
  events/      event:payment-failed/index.mdx -- frontmatter: id, name, channels, owners
  commands/    ...
  queries/     ...
  channels/    ...
  entities/    ...
  teams/       ...
```

Each `index.mdx` file has YAML frontmatter with structured data (id, name, version, summary, owners, badges, services, entities, sends, receives, channels, repository).

**This is a supplementary data source, not a code extractor.** It enriches existing repo/service/event data with:
- Domain ownership (which domain does a service belong to?)
- Event-to-channel mappings (which Kafka topics carry which events?)
- Team ownership
- Cross-service relationships (sends/receives)

**Integration approach:**

```typescript
// eventcatalog.ts
export interface EventCatalogDomain {
  id: string;
  name: string;
  services: string[];
  entities: string[];
}

export interface EventCatalogService {
  id: string;
  name: string;
  repositoryUrl: string | null;
  language: string | null;
}

export interface EventCatalogEvent {
  id: string;
  name: string;
  channels: string[];
  owners: string[];
}

export function extractEventCatalog(catalogPath: string): {
  domains: EventCatalogDomain[];
  services: EventCatalogService[];
  events: EventCatalogEvent[];
}
```

**YAML/frontmatter parsing:** Use a lightweight YAML parser. The frontmatter is between `---` delimiters, which is trivial to extract. For YAML parsing, `js-yaml` is the standard choice (or just parse the simple key-value frontmatter with regex since the structure is predictable).

**Data model considerations:**
- Event Catalog data enriches existing entities (adds domain context, team ownership)
- A new `domains` table might be warranted, or domains can be stored as modules with `type: 'domain'`
- Service-to-domain mapping stored as edges
- Event-to-channel mapping could use a new `channels` table or store as module `type: 'channel'`

**Integration points:**
- New: `src/indexer/eventcatalog.ts`
- Modified: `pipeline.ts` (special-case for event catalog repo or separate pipeline step)
- Possible schema migration: `domains` table, or repurpose existing tables
- New dependency: `js-yaml` (or lightweight frontmatter parser)

---

## Component Dependency Map

```
Branch-Aware Tracking (git.ts, metadata.ts)
    |
    |  (no deps on other features)
    v
Surgical File-Level Indexing (pipeline.ts, writer.ts, extractors)
    |
    |  (must exist before parallel makes sense --
    |   parallel full-wipe is wasteful)
    v
Parallel Execution (pipeline.ts + worker infrastructure)
    |
    |  (extractors must support file filtering first)
    |
    +--- GraphQL Extractor (new file, hooks into pipeline)
    +--- gRPC Extractor (new file, hooks into pipeline)
    +--- Ecto Extraction (extends elixir.ts)
    +--- Event Catalog Extractor (new file, somewhat independent)
```

## Suggested Build Order

### Phase 1: Branch-Aware Tracking
**Files:** `git.ts`, `metadata.ts`
**Rationale:** Smallest change, immediately valuable, no dependencies. Prevents dirty index data from PR branch checkouts.

### Phase 2: Surgical File-Level Indexing
**Files:** `pipeline.ts`, `writer.ts`, `elixir.ts`, `proto.ts`, `events.ts`
**Rationale:** The highest-impact infrastructure change. Makes incremental reindexing actually incremental instead of "skip or full wipe." Must come before parallelization because parallel full-wipe is pointless.

### Phase 3: New Extractors (can be done in any order, or in parallel)
**Files:** `graphql.ts`, `grpc.ts`, extended `elixir.ts` (Ecto), `eventcatalog.ts`
**Rationale:** Each extractor is independent. They hook into the pipeline at the same extension point. Can be shipped incrementally.

Suggested sub-ordering within Phase 3:
1. **Ecto enhancement** -- least work, extends existing extractor, high value (database structure knowledge)
2. **GraphQL extractor** -- medium work, the codebase is heavily Absinthe-based
3. **gRPC extractor** -- low work, proto services already parsed, just need Elixir-side detection
4. **Event Catalog** -- medium work, architecturally different (supplementary source, YAML parsing)

### Phase 4: Parallel Execution
**Files:** `pipeline.ts`, possibly `worker.ts`
**Rationale:** Last because it is an optimization. The surgical indexing from Phase 2 will already dramatically reduce reindex time. Parallelism is the cherry on top. Also, implementing it after extractors are finalized means less rework.

## What Changes vs What's Added

### Modified Files (existing code changes)

| File | Change | Scope |
|------|--------|-------|
| `src/indexer/git.ts` | Add `getDefaultBranchCommit()` | Small addition |
| `src/indexer/metadata.ts` | Use `getDefaultBranchCommit` instead of `getCurrentCommit` | 1-line change |
| `src/indexer/pipeline.ts` | Dual-mode (full vs surgical), parallel orchestration | Major rework |
| `src/indexer/writer.ts` | Add `persistFileData()` for surgical persistence | Medium addition |
| `src/indexer/elixir.ts` | Add `changedFiles` filter param, add Ecto field/assoc extraction | Medium changes |
| `src/indexer/proto.ts` | Add `changedFiles` filter param | Small change |
| `src/indexer/events.ts` | Add `changedFiles` filter param | Small change |

### New Files

| File | Purpose | Depends On |
|------|---------|------------|
| `src/indexer/graphql.ts` | Absinthe/GraphQL schema extraction | elixir.ts patterns |
| `src/indexer/grpc.ts` | gRPC server/client detection in Elixir code | proto.ts data |
| `src/indexer/eventcatalog.ts` | Event Catalog MDX/frontmatter parsing | js-yaml or custom parser |

### Schema Migrations (possibly needed)

| Migration | Reason | Verdict |
|-----------|--------|---------|
| `domains` table | Event Catalog domain data | **Maybe** -- could reuse modules table with `type: 'domain'` |
| Ecto fields column on modules | Store field definitions | **No** -- store in summary text, searchable via FTS |
| `repos.default_branch` column | Store detected default branch name | **Yes** -- useful for branch-aware tracking diagnostics |

## Data Flow: After v1.1

```
discoverRepos(rootDir)
    |
    v
for each repo (parallel via worker pool):
    |
    +-- resolveDefaultBranch(repoPath)  -- NEW: resolve main/master
    +-- checkSkip(db, repoPath)         -- compare against default branch commit
    |
    +-- MODE DECISION:
    |   |
    |   +-- FULL (new repo or --force):
    |   |     extractors scan all files
    |   |     clearRepoEntities + full insert
    |   |
    |   +-- SURGICAL (incremental):
    |         getChangedFiles(since, defaultBranch)
    |         extractors filter to changed files only
    |         clearRepoFiles(deleted + modified) + insert only new
    |
    +-- NEW EXTRACTORS:
          extractElixirModules(repoPath, changedFiles)  -- now includes Ecto
          extractProtoDefinitions(repoPath, changedFiles)
          extractGraphQLSchema(repoPath, changedFiles)   -- NEW
          detectGrpcRelationships(repoPath, ...)         -- NEW
          detectEventRelationships(repoPath, ...)
    |
    v
persistRepoData/persistFileData  -- mode-dependent
    |
    v
EVENT CATALOG (separate pass, if catalog repo changed):
    extractEventCatalog(catalogPath)
    enrichExistingEntities(db, catalogData)
```

## Key Architectural Decisions

| Decision | Rationale |
|----------|-----------|
| Extend `elixir.ts` for Ecto instead of separate extractor | Ecto schemas ARE Elixir modules. Same file discovery, same parsing context. Separate file would duplicate 80% of the code. |
| Separate extraction from persistence for parallelism | better-sqlite3 connections can't be shared across threads. Extracting in parallel + persisting sequentially avoids threading complexity entirely. |
| File filter as optional parameter, not new extractor interface | Minimal change to existing extractor signatures. `undefined` means "process all" (backward compatible). |
| Event Catalog as a separate pipeline step, not a per-repo extractor | It's one special repo, not a pattern across all repos. Treating it as a per-repo extractor would be architecturally dishonest. |
| Use `refs/heads/main` or `refs/heads/master` instead of `origin/HEAD` | `origin/HEAD` requires network access or may not be set. Local branch refs are always available and deterministic. |

## Sources

- Absinthe schema patterns: [Absinthe.Schema docs](https://hexdocs.pm/absinthe/Absinthe.Schema.html), [Absinthe.Schema.Notation](https://hexdocs.pm/absinthe/Absinthe.Schema.Notation.html) (HIGH confidence -- official hex docs)
- Ecto schema patterns: [Ecto.Schema docs](https://hexdocs.pm/ecto/Ecto.Schema.html) (HIGH confidence -- official hex docs)
- EventCatalog structure: [EventCatalog domain API](https://www.eventcatalog.dev/docs/api/domain-api), verified against local `fresha-event-catalog` repo (HIGH confidence -- direct observation)
- better-sqlite3 worker threads: [GitHub issue #237](https://github.com/JoshuaWise/better-sqlite3/issues/237), connections cannot be shared across threads (HIGH confidence -- library maintainer guidance)
- Git default branch resolution: [practical guide](https://dev.to/bowmanjd/get-github-default-branch-from-the-command-line-powershell-or-bash-zsh-37m9), `git rev-parse refs/heads/{main,master}` (HIGH confidence -- standard git)
- Real codebase patterns: Validated against `app-appointments-manager` (Absinthe), `app-appointments` (Ecto), `fresha-event-catalog` (EventCatalog) repos (HIGH confidence -- direct code inspection)

---
*Architecture research for: repo-knowledge-base v1.1*
*Researched: 2026-03-06*
