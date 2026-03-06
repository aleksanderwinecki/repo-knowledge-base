---
phase: 07-surgical-file-level-indexing
verified: 2026-03-06T15:58:00Z
status: passed
score: 12/12 must-haves verified
---

# Phase 7: Surgical File-Level Indexing Verification Report

**Phase Goal:** Incremental re-indexing processes only files that changed since last indexed commit, dramatically reducing re-index time for repos with small changes
**Verified:** 2026-03-06T15:58:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

#### Plan 01 Truths (Schema + Writer)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Events table has file_id FK column after v4 migration | VERIFIED | `migrateToV4` in migrations.ts adds `ALTER TABLE events ADD COLUMN file_id INTEGER REFERENCES files(id) ON DELETE SET NULL`; test `v4 migration adds file_id column to events table` passes |
| 2 | clearRepoFiles removes events via file_id join, not source_file text | VERIFIED | writer.ts:127 uses `SELECT id FROM events WHERE repo_id = ? AND file_id IN (SELECT id FROM files WHERE ...)` as primary path; source_file fallback at line 136 only for `file_id IS NULL`; test `removes events via file_id FK` passes |
| 3 | persistSurgicalData clears only changed files and inserts only their entities | VERIFIED | writer.ts:295 calls `clearRepoFiles(db, data.repoId, data.changedFiles)` then inserts only provided modules/events; test `clears only specified changed files, other files survive` passes |
| 4 | clearRepoEdges removes all repo edges and consumer-created events | VERIFIED | writer.ts:257-271 deletes repo-sourced edges, service-sourced edges, and `schema_definition LIKE 'consumed:%'` events; 4 tests covering edge/consumer cleanup all pass |
| 5 | Existing v3 databases auto-migrate to v4 preserving all data | VERIFIED | Test `v3 databases auto-migrate to v4 preserving existing event data` inserts v3 data, reopens via openDatabase, confirms v4 with data intact |

#### Plan 02 Truths (Pipeline Integration)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | When a single file changes, kb index only re-extracts entities from that file | VERIFIED | pipeline.ts:191-228 surgical branch filters modules/events to `changedSet` before persisting; test `uses surgical mode when a single file is modified` confirms Beta survives, Alpha renamed |
| 7 | When a file is deleted, kb index removes all entities and FTS entries from that file | VERIFIED | Test `uses surgical mode when a file is deleted` -- Remove module gone, Keep module survives |
| 8 | kb index --force always does full wipe-and-rewrite | VERIFIED | pipeline.ts:164 `!options.force` prevents surgical mode; test `force flag always uses full mode` passes |
| 9 | After surgical re-indexing, search results are identical to full --force re-index | VERIFIED | Test `produces identical results to full re-index (equivalence)` compares module/event lists from surgical vs full, asserts equal |
| 10 | Unreachable commit silently falls back to full re-index | VERIFIED | pipeline.ts:169 `isCommitReachable` check; test `falls back to full mode for unreachable commit` stores fake SHA, confirms mode='full' |
| 11 | Large diff silently falls back to full re-index | VERIFIED | pipeline.ts:184 checks `totalChanged <= 200 && changeRatio <= 0.5`; test `falls back to full mode for large diff` modifies 6/10 files, confirms mode='full' |
| 12 | IndexResult includes mode field (full/surgical/skipped) | VERIFIED | IndexResult interface at pipeline.ts:33 has `mode?: 'full' | 'surgical' | 'skipped'`; tests for skipped repos, full mode, and surgical mode all verify mode field |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/migrations.ts` | migrateToV4 adding file_id to events | VERIFIED | Function at line 154, gated at line 37, adds file_id INTEGER REFERENCES files(id) |
| `src/db/schema.ts` | SCHEMA_VERSION = 4 | VERIFIED | Line 6: `export const SCHEMA_VERSION = 4` |
| `src/indexer/writer.ts` | persistSurgicalData, clearRepoEdges, updated clearRepoFiles | VERIFIED | All three exported (lines 110, 255, 280); substantive implementations with SQL, FTS sync, transactions |
| `src/indexer/pipeline.ts` | Surgical vs full branching, mode reporting | VERIFIED | Surgical branch at line 191, full branch at line 231, mode field on return types and IndexResult |
| `tests/db/schema.test.ts` | v4 migration tests | VERIFIED | 4 tests in `describe('v4 migration')` block covering file_id add, data preservation, version, fresh DB |
| `tests/indexer/writer.test.ts` | Surgical persist + file_id cleanup tests | VERIFIED | `persistSurgicalData` describe (5 tests), `clearRepoEdges` describe (4 tests), `clearRepoFiles with file_id` describe (3 tests) |
| `tests/indexer/pipeline.test.ts` | Surgical mode integration tests | VERIFIED | `surgical indexing` describe block with 11 tests covering modify/add/delete, equivalence, fallbacks, mode reporting |

### Key Link Verification

#### Plan 01 Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| writer.ts:clearRepoFiles | events.file_id | `SELECT id FROM events WHERE file_id IN (SELECT id FROM files WHERE ...)` | WIRED | Line 127 uses file_id FK join; line 136 provides source_file fallback for NULL file_id |
| writer.ts:persistSurgicalData | clearRepoFiles | Calls clearRepoFiles for changed files inside transaction | WIRED | Line 295: `clearRepoFiles(db, data.repoId, data.changedFiles)` inside `db.transaction()` |
| writer.ts:clearRepoEdges | edges + consumer events | DELETE from edges + delete consumer-created events | WIRED | Lines 257-271: deletes repo edges, service edges, and `consumed:` events with FTS cleanup |

#### Plan 02 Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| pipeline.ts:indexSingleRepo | writer.ts:persistSurgicalData | Surgical mode calls persistSurgicalData | WIRED | Line 13 imports it; line 209 calls it in surgical branch |
| pipeline.ts:indexSingleRepo | writer.ts:clearRepoEdges/insertEventEdges | Edge recalculation after surgical persist | WIRED | clearRepoEdges called inside persistSurgicalData (line 335 of writer.ts); insertEventEdges called at pipeline.ts:220 |
| pipeline.ts:indexSingleRepo | git.ts:getChangedFilesSinceBranch | Determines changed files for surgical filtering | WIRED | Imported at line 6; called at line 176 |
| pipeline.ts:indexSingleRepo | git.ts:isCommitReachable | Fallback detection for unreachable commits | WIRED | Imported at line 6; called at line 169 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| IDX2-02 | 07-01, 07-02 | Re-indexing surgically processes only files changed since last indexed commit | SATISFIED | persistSurgicalData clears only changed files; pipeline.ts filters entities to changed set; equivalence test proves correctness |
| IDX2-03 | 07-01, 07-02 | Deleted files detected via git diff and their entities/FTS entries cleaned up | SATISFIED | getChangedFilesSinceBranch returns deleted files; clearRepoFiles handles file removal including FTS cleanup; test `uses surgical mode when a file is deleted` passes |

No orphaned requirements for this phase. REQUIREMENTS.md traceability table maps IDX2-02 and IDX2-03 to Phase 7, both marked Complete.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No TODOs, FIXMEs, placeholders, stubs, or console.log-only implementations found in any modified file |

### Human Verification Required

### 1. Surgical Mode Performance

**Test:** Index a real repo with `kb index`, modify one file, commit, run `kb index` again. Observe timing vs `kb index --force`.
**Expected:** Surgical re-index should be noticeably faster (less I/O) than forced full re-index for large repos.
**Why human:** Performance difference depends on real repo size and filesystem; can't verify programmatically in unit tests.

### 2. End-to-End Search Consistency

**Test:** After surgical re-index, run `kb search` for an entity from a modified file and an unmodified file.
**Expected:** Both return correct, up-to-date results -- no stale or missing FTS entries.
**Why human:** FTS5 interaction with surgical updates is tested in unit tests but real-world search quality needs human judgment.

### Gaps Summary

No gaps found. All 12 observable truths verified. All 7 artifacts exist, are substantive, and are properly wired. All key links confirmed. Both requirements (IDX2-02, IDX2-03) satisfied. Full test suite passes (290 tests, 0 failures). No anti-patterns detected.

---

_Verified: 2026-03-06T15:58:00Z_
_Verifier: Claude (gsd-verifier)_
