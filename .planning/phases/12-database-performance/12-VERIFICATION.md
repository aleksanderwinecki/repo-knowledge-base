---
phase: 12-database-performance
verified: 2026-03-07T17:50:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 12: Database Performance Verification Report

**Phase Goal:** Indexing and search are measurably faster through SQLite tuning, statement reuse, proper indexes, and FTS5 optimization
**Verified:** 2026-03-07T17:50:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SQLite connections open with tuned pragmas (cache_size, temp_store, mmap_size) | VERIFIED | `src/db/database.ts` lines 23-25: `cache_size = -64000`, `temp_store = MEMORY`, `mmap_size = 268435456` |
| 2 | Hot-loop SQL in fts.ts, writer.ts, entity.ts, dependencies.ts uses hoisted prepared statements (no db.prepare() inside loops) | VERIFIED | All 4 files hoist db.prepare() above loop bodies. `clearRepoEntities` (9 stmts at lines 86-94), `clearRepoFiles` (8 stmts at lines 137-144 before loop at 146), `clearRepoEdges` (5 stmts at lines 324-328), `findLinkedRepos` (6 stmts at lines 113-126 before BFS), entity.ts uses closure factories (`createEntityByIdLookup`, `createRelationshipLookup`). status.ts correctly skipped per research (no hot loops). |
| 3 | Entity lookups by name hit database indexes -- V5 migration adds indexes on modules, events, services | VERIFIED | `src/db/migrations.ts` lines 170-175: `idx_modules_name`, `idx_events_name`, `idx_services_name`, `idx_modules_repo_file`, `idx_events_repo_file` |
| 4 | FTS5 runs optimize after bulk indexing and WAL checkpoints after index completes | VERIFIED | `src/indexer/pipeline.ts` lines 403-413: `INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize')` + `db.pragma('wal_checkpoint(TRUNCATE)')`, both gated on `success > 0` |
| 5 | Indexing and search operations have perf_hooks instrumentation that reports wall-clock timing for benchmarking | VERIFIED | `src/cli/timing.ts` (47 lines): `withTiming`, `withTimingAsync`, `reportTimings` using `node:perf_hooks`. `--timing` flag on `index-cmd.ts` (line 24), `search.ts` (line 29), `deps.ts` (line 19). Output to stderr only. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/database.ts` | Pragma tuning at connection open | VERIFIED | Lines 23-25: all 3 performance pragmas present |
| `src/db/migrations.ts` | V5 migration with indexes and FTS rebuild | VERIFIED | 212 lines, `migrateToV5` at line 167 with 5 indexes + FTS5 rebuild with data preservation |
| `src/db/schema.ts` | Schema version bump to 5 | VERIFIED | Line 6: `SCHEMA_VERSION = 5` |
| `src/db/fts.ts` | FTS5 prefix config in initializeFts | VERIFIED | Line 30: `prefix = '2,3'` in CREATE VIRTUAL TABLE |
| `src/db/fts.ts` | Hoisted prepared statements in indexEntity and removeEntity | VERIFIED | indexEntity: 2 stmts at lines 61-65 before transaction; removeEntity: 1 stmt at line 88 |
| `src/indexer/writer.ts` | Hoisted statements in clearRepoEntities, clearRepoFiles, clearRepoEdges | VERIFIED | clearRepoEntities: 9 stmts (lines 86-94), clearRepoFiles: 8 stmts (lines 137-144), clearRepoEdges: 5 stmts (lines 324-328) |
| `src/search/entity.ts` | Hoisted statements via closure factories | VERIFIED | `createEntityByIdLookup` (4 stmts, line 119), `createRelationshipLookup` (7 stmts, line 178) |
| `src/search/dependencies.ts` | Hoisted statements in findLinkedRepos | VERIFIED | 6 stmts at lines 113-126, before all loop bodies |
| `src/indexer/pipeline.ts` | FTS optimize + WAL checkpoint after indexAllRepos | VERIFIED | Lines 403-413, gated on `success > 0`, FTS optimize in try/catch |
| `src/cli/timing.ts` | Shared timing utility | VERIFIED | 47 lines, uses `node:perf_hooks`, exports withTiming/withTimingAsync/reportTimings |
| `src/cli/commands/index-cmd.ts` | --timing flag | VERIFIED | Line 24: `.option('--timing', ...)`, wraps with `withTimingAsync`, conditional `reportTimings()` |
| `src/cli/commands/search.ts` | --timing flag | VERIFIED | Line 29: `.option('--timing', ...)`, wraps with `withTiming`, conditional `reportTimings()` |
| `src/cli/commands/deps.ts` | --timing flag | VERIFIED | Line 19: `.option('--timing', ...)`, wraps with `withTiming`, conditional `reportTimings()` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/db/schema.ts` | `src/db/migrations.ts` | `runMigrations(db, currentVersion, 5)` | WIRED | schema.ts imports `runMigrations` and calls with `SCHEMA_VERSION = 5`; migrations.ts has `if (fromVersion < 5 && toVersion >= 5) { migrateToV5(db); }` |
| `src/db/database.ts` | SQLite engine | `db.pragma()` calls | WIRED | Lines 23-25: `cache_size = -64000`, `temp_store = MEMORY`, `mmap_size = 268435456` |
| `src/indexer/writer.ts` | `src/db/fts.ts` | imports indexEntity, removeEntity | WIRED | Line 3: `import { indexEntity, removeEntity } from '../db/fts.js'` + inline `DELETE FROM knowledge_fts` in hot paths |
| `src/indexer/writer.ts clearRepoEntities` | FTS table | inline FTS DELETE | WIRED | Line 89: hoisted `deleteFts` stmt, used in loops at lines 99, 105, 111, 115 |
| `src/indexer/pipeline.ts` | knowledge_fts table | FTS optimize command | WIRED | Line 406: `INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize')` |
| `src/indexer/pipeline.ts` | WAL file | wal_checkpoint pragma | WIRED | Line 412: `db.pragma('wal_checkpoint(TRUNCATE)')` |
| `src/cli/commands/index-cmd.ts` | `src/cli/timing.ts` | import withTimingAsync, reportTimings | WIRED | Line 12: `import { withTimingAsync, reportTimings } from '../timing.js'` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PERF-01 | 12-01 | SQLite pragma tuning (cache_size, temp_store, mmap_size) applied at connection open | SATISFIED | `database.ts` lines 23-25 |
| PERF-02 | 12-02 | Prepared statements hoisted out of hot loops in fts.ts, writer.ts, entity.ts, dependencies.ts | SATISFIED | All 4 files verified -- no db.prepare() inside iteration loops |
| PERF-03 | 12-01 | Missing database indexes added via V5 migration | SATISFIED | `migrations.ts` lines 170-175: 5 B-tree indexes |
| PERF-04 | 12-03 | FTS5 optimize command runs after bulk indexing | SATISFIED | `pipeline.ts` line 406 |
| PERF-05 | 12-03 | WAL checkpoint after index completes | SATISFIED | `pipeline.ts` line 412 |
| PERF-06 | 12-01 | FTS5 prefix index configuration (prefix='2,3') | SATISFIED | `fts.ts` line 30 (initializeFts) + `migrations.ts` line 199 (migrateToV5) |
| PERF-07 | 12-03 | perf_hooks instrumentation for indexing and search benchmarking | SATISFIED | `timing.ts` + `--timing` flag on index/search/deps commands |

No orphaned requirements. All 7 PERF requirements mapped to plans and verified.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | - |

No TODOs, FIXMEs, placeholders, empty implementations, or stub patterns found in any modified file.

### Human Verification Required

### 1. Timing output goes to stderr only

**Test:** Run `kb search "test" --timing 2>/dev/null` and verify stdout is pure JSON. Then run `kb search "test" --timing` and verify `[timing]` lines appear on stderr.
**Expected:** Without `2>/dev/null`, timing lines like `[timing] search-text: 12.3ms` appear. With `2>/dev/null`, only JSON on stdout.
**Why human:** Requires running the CLI against a populated database to verify stderr/stdout separation.

### 2. Without --timing, output is identical to pre-change behavior

**Test:** Run `kb search "test"` and `kb deps some-repo` without `--timing`. Compare output to pre-phase behavior.
**Expected:** No timing output appears anywhere. JSON output unchanged.
**Why human:** Phase 11 snapshot tests cover this programmatically (all 437 tests pass), but human confirmation of no visual regression is worth a spot check.

### 3. FTS optimize actually speeds up queries

**Test:** Run `kb index --force --timing` on a real database with many repos. Note timing. Run `kb search` queries before and after.
**Expected:** FTS optimize compacts index segments. Subsequent searches should be at least as fast.
**Why human:** Performance improvement is measurable only on real data, not test fixtures.

### Gaps Summary

No gaps found. All 5 observable truths verified. All 13 artifacts exist, are substantive, and are wired. All 7 key links connected. All 7 requirements satisfied. 437 tests pass. No anti-patterns detected.

**Note on ROADMAP discrepancy:** Success criterion 2 mentions `status.ts` alongside the 4 target files. The RESEARCH phase (12-RESEARCH.md line 294) correctly identified that status.ts has no hot loops (CLI version: helper function called 7 times with fixed table names; MCP version: 8 db.prepare() calls each invoked once). This was a correct scope decision, not a gap.

---

_Verified: 2026-03-07T17:50:00Z_
_Verifier: Claude (gsd-verifier)_
