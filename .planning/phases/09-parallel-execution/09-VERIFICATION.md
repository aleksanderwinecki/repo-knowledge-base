---
phase: 09-parallel-execution
verified: 2026-03-07T10:59:15Z
status: passed
score: 11/11 must-haves verified
---

# Phase 9: Parallel Execution Verification Report

**Phase Goal:** Full and incremental re-indexing runs repos concurrently, reducing wall-clock time by 2-4x while maintaining data consistency
**Verified:** 2026-03-07T10:59:15Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

**Plan 01 Truths:**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | indexAllRepos is async and processes repo extractions concurrently via p-limit | VERIFIED | `pipeline.ts:300` `async function indexAllRepos(...)`, `pipeline.ts:352` `const limit = pLimit(concurrency)`, `pipeline.ts:354-355` maps work items through `limit()` |
| 2 | DB writes happen serially after all extractions complete | VERIFIED | `pipeline.ts:308` Phase 1 sequential prep, `pipeline.ts:350-358` Phase 2 parallel extraction, `pipeline.ts:360-382` Phase 3 serial `for` loop calling `persistExtractedData` |
| 3 | KB_CONCURRENCY env var controls concurrency with default of 4 | VERIFIED | `pipeline.ts:351` `parseInt(process.env.KB_CONCURRENCY ?? '4', 10) \|\| 4` |
| 4 | KB_CONCURRENCY=1 produces sequential behavior | VERIFIED | Test "works with KB_CONCURRENCY=1 (sequential fallback)" passes; p-limit(1) serializes all slots |
| 5 | A failed repo extraction does not cancel other repos (Promise.allSettled) | VERIFIED | `pipeline.ts:358` `Promise.allSettled(extractionPromises)`, test "isolates errors: failed repo does not prevent others from succeeding" passes |
| 6 | indexSingleRepo remains unchanged for backward compatibility (MCP sync) | VERIFIED | `pipeline.ts:448` still `export function indexSingleRepo(...)` (sync, no p-limit). `mcp/sync.ts:62` calls it directly. |
| 7 | CLI index command works with the async indexAllRepos | VERIFIED | `index-cmd.ts:23-27` uses `async (opts) => { const results = await withDbAsync(async (db) => indexAllRepos(...)); output(results); }` |

**Plan 02 Truths:**

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 8 | Parallel indexing produces identical DB state to sequential indexing | VERIFIED | Test "produces identical DB state for sequential (KB_CONCURRENCY=1) and parallel (KB_CONCURRENCY=3) runs" passes (compares module/event/repo counts) |
| 9 | KB_CONCURRENCY=1 runs sequentially without errors | VERIFIED | Test "works with KB_CONCURRENCY=1 (sequential fallback)" passes |
| 10 | A repo that fails extraction does not prevent other repos from succeeding | VERIFIED | Test "isolates errors: failed repo does not prevent others from succeeding" passes |
| 11 | Event Catalog enrichment runs after parallel phase when at least one repo succeeds | VERIFIED | `pipeline.ts:394` `if (success > 0) { enrichFromEventCatalog(db, options.rootDir); }` -- after all Phase 3 persistence completes |

**Score:** 11/11 truths verified

### Required Artifacts

**Plan 01:**

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/indexer/pipeline.ts` | extractRepoData, persistExtractedData, async indexAllRepos, indexSingleRepo exports | VERIFIED | All four present. `extractRepoData` (line 83), `persistExtractedData` (line 227), `indexAllRepos` (line 300, async), `indexSingleRepo` (line 448, sync). Build passes. |
| `src/cli/db.ts` | withDbAsync helper | VERIFIED | Line 38: `export async function withDbAsync<T>(...)` |
| `src/cli/commands/index-cmd.ts` | Async CLI action using withDbAsync | VERIFIED | Lines 23-27: async action with await withDbAsync |
| `package.json` | p-limit dependency | VERIFIED | `"p-limit": "^7.3.0"` in dependencies |

**Plan 02:**

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `tests/indexer/pipeline.test.ts` | Parallel indexing test suite | VERIFIED | `describe('parallel indexing')` at line 1267 with 5 tests covering consistency, error isolation, sequential fallback, default concurrency, async signature |

### Key Link Verification

**Plan 01:**

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/indexer/pipeline.ts` | p-limit | `import pLimit from 'p-limit'` | WIRED | Line 3 import, line 352 `pLimit(concurrency)` call |
| `src/indexer/pipeline.ts` | Promise.allSettled | parallel extraction results | WIRED | Line 358 `Promise.allSettled(extractionPromises)` |
| `src/cli/commands/index-cmd.ts` | `src/cli/db.ts` | withDbAsync import | WIRED | Line 9 import, line 24 `await withDbAsync(...)` |
| `src/cli/commands/index-cmd.ts` | `src/indexer/pipeline.ts` | await indexAllRepos | WIRED | Line 10 import, line 25 `indexAllRepos(db, ...)` inside async withDbAsync callback |

**Plan 02:**

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tests/indexer/pipeline.test.ts` | `src/indexer/pipeline.ts` | import indexAllRepos | WIRED | Line 7 `import { indexAllRepos, indexSingleRepo }`, used extensively in 5 parallel tests |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| IDX2-04 | 09-01, 09-02 | Repos indexed in parallel with configurable concurrency, DB writes serialized on main thread | SATISFIED | p-limit concurrency with KB_CONCURRENCY config (default 4), three-phase pipeline with serial Phase 3 persistence, 360 tests pass including 5 parallel-specific tests |

No orphaned requirements found for this phase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | -- | -- | -- | -- |

No TODOs, FIXMEs, placeholders, empty implementations, or console.log-only handlers found in any modified file.

### Human Verification Required

### 1. Wall-Clock Speedup

**Test:** Run `kb index --force` on a directory with 5+ real repos, timing sequential (KB_CONCURRENCY=1) vs parallel (KB_CONCURRENCY=4).
**Expected:** Parallel run completes 2-4x faster than sequential for I/O-bound repos.
**Why human:** Actual speedup depends on disk I/O, repo sizes, and machine load -- can't measure programmatically without real repos.

### 2. CLI End-to-End

**Test:** Run `kb index` from a terminal.
**Expected:** JSON output with repo results, no unhandled promise rejection warnings.
**Why human:** Full CLI lifecycle with real filesystem and DB.

### Gaps Summary

No gaps found. All 11 must-have truths verified against actual codebase. The implementation follows the three-phase pipeline design (sequential prep, parallel extraction, serial persistence) exactly as planned. All key links are wired. All 360 tests pass with zero regressions. The `indexSingleRepo` function remains synchronous for MCP backward compatibility. The `p-limit` dependency is installed and actively used. `KB_CONCURRENCY` is configurable with a sensible default of 4.

---

_Verified: 2026-03-07T10:59:15Z_
_Verifier: Claude (gsd-verifier)_
