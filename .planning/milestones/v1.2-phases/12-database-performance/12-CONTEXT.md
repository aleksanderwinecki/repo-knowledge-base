# Phase 12: Database Performance - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Make indexing and search measurably faster through SQLite pragma tuning, prepared statement hoisting, database indexes, FTS5 optimization, and perf_hooks instrumentation. No new features — pure performance improvements on existing code paths.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

User delegated all implementation decisions to Claude. The following areas have been analyzed with recommended approaches:

**Benchmark reporting (PERF-07):**
- Use `perf_hooks.performance.mark()` / `measure()` for timing
- Report via stderr so it doesn't pollute JSON output
- Instrument: full index run, per-repo indexing, FTS search, entity search, dependency queries
- Consider a `--timing` flag on CLI commands to opt-in to timing output
- Output format: human-readable summary with operation name + wall-clock ms

**FTS5 prefix configuration (PERF-06):**
- FTS5 virtual tables cannot be ALTERed — prefix requires DROP+CREATE
- The "no table rebuilds" v1.2 constraint targets regular tables (SQLite ALTER TABLE limitations)
- FTS5 virtual tables are exempt since they can be cleanly recreated and repopulated
- V5 migration: DROP knowledge_fts, CREATE with `prefix='2,3'` tokenize config, repopulate from source tables
- This is safe because FTS is a derived index, not source-of-truth data

**Pragma tuning values (PERF-01):**
- `cache_size = -64000` (~64MB, generous for local-only tool)
- `temp_store = MEMORY` (temp tables in RAM)
- `mmap_size = 268435456` (256MB memory-mapped I/O)
- Applied in `openDatabase()` alongside existing WAL/foreign_keys/synchronous pragmas
- These are conservative-to-moderate values suitable for a local CLI tool

**Statement hoisting scope (PERF-02):**
- Strict scope to the 5 files named in requirements: fts.ts, writer.ts, entity.ts, dependencies.ts, status.ts
- Key hot spots identified:
  - `fts.ts:indexEntity()` — 2 prepare calls inside function called per-entity in writer loops
  - `fts.ts:removeEntity()` — 1 prepare call inside function called per-entity in clearRepoEntities loops
  - `writer.ts:clearRepoEntities()` — 3 prepare-in-loop patterns (modules, events, services SELECT id)
  - `writer.ts:clearRepoFiles()` — multiple prepare calls inside filePath loop
  - `entity.ts:getEntityById/getRelationships/resolveEntityName` — prepare per-call, used in result hydration loops
  - `dependencies.ts:findLinkedRepos()` — prepare inside BFS traversal loop
- Pattern: hoist to module-level lazy singletons or accept db param for prepare-once-per-connection

**Database indexes (PERF-03):**
- V5 migration adds indexes on:
  - `modules(name)` — exact name lookups in entity search
  - `events(name)` — exact name lookups in entity search
  - `services(name)` — exact name lookups in entity search
  - `modules(repo_id, file_id)` — surgical file cleanup joins
  - `events(repo_id, file_id)` — surgical file cleanup joins
- CREATE INDEX IF NOT EXISTS — safe, additive migration

**FTS5 optimize + WAL checkpoint (PERF-04, PERF-05):**
- Call `INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize')` after bulk indexing
- Call `db.pragma('wal_checkpoint(TRUNCATE)')` after index completes
- Both go in the pipeline orchestrator after all repos are indexed

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User delegated all decisions to Claude's judgment.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `openDatabase()` in `src/db/database.ts`: single place to add pragma tuning (lines 17-19)
- `initializeFts()` in `src/db/fts.ts`: FTS5 table creation — modify for prefix config
- `persistRepoData()` in `src/indexer/writer.ts`: already hoists some prepared statements (insertFile, insertModule, insertEvent, insertEdge) — extend pattern to remaining functions
- `runMigrations()` in `src/db/migrations.ts`: V4 is current version, V5 migration slot ready

### Established Patterns
- WAL mode already enabled — WAL checkpoint is natural extension
- Transaction wrapping via `db.transaction()` — used consistently in writer.ts
- Prepared statement hoisting already partially done in `persistRepoData()` (lines 195-201, 231-235, 257-264, 288-289) — extend to clearRepoEntities/clearRepoFiles/search modules
- Migration pattern: sequential version checks in `runMigrations()`, each version in its own function

### Integration Points
- `src/indexer/pipeline.ts` calls `persistRepoData()`/`persistSurgicalData()` — add FTS optimize + WAL checkpoint after batch
- `src/db/schema.ts` calls `runMigrations()` — V5 migration adds indexes + FTS prefix rebuild
- 72 `db.prepare()` calls across 11 files — PERF-02 targets the 5 hot-loop files specifically
- Phase 11 safety net tests (contract, golden, snapshot) will catch any regressions

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 12-database-performance*
*Context gathered: 2026-03-07*
