---
phase: 06-branch-aware-tracking-schema-migration
verified: 2026-03-06T14:22:00Z
status: passed
score: 14/14 must-haves verified
---

# Phase 6: Branch-Aware Tracking & Schema Migration Verification Report

**Phase Goal:** Repos are always indexed from main/master branch regardless of local checkout state, and the database schema supports all v1.1 extractors
**Verified:** 2026-03-06T14:22:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths (Plan 01)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Opening a v2 database auto-migrates to v3 with all new columns | VERIFIED | `migrateToV3` in `migrations.ts:136-144` adds 6 ALTER TABLE statements; `schema.ts:6` has `SCHEMA_VERSION = 3`; `runMigrations` gates `fromVersion < 3 && toVersion >= 3` at line 33; 13 schema tests pass |
| 2 | Fresh database gets v3 schema with all columns from the start | VERIFIED | `initializeSchema` calls `runMigrations(db, 0, SCHEMA_VERSION)` which runs migrateToV1 + migrateToV2 + migrateToV3 in sequence; test coverage confirms |
| 3 | Existing v2 data (repos, modules, services, events) is preserved after migration | VERIFIED | ALTER TABLE ADD COLUMN is non-destructive in SQLite; test "migrates v2 database to v3 preserving data" validates this |
| 4 | resolveDefaultBranch returns 'main' for repos with main branch | VERIFIED | `git.ts:98-108` tries `git rev-parse --verify refs/heads/main` first; 23 git tests pass |
| 5 | resolveDefaultBranch returns 'master' for repos with only master branch | VERIFIED | `git.ts:110-119` falls back to master if main fails |
| 6 | resolveDefaultBranch returns null for repos with non-standard branch names | VERIFIED | Both try/catch blocks return null on failure at line 118 |
| 7 | readBranchFile reads committed content from branch, not working tree | VERIFIED | `git.ts:174` uses `git show "${branch}:${filePath}"` -- a plumbing command that reads from the object store, never the working directory |
| 8 | listBranchFiles lists files from branch tree, not working directory | VERIFIED | `git.ts:151` uses `git ls-tree -r --name-only ${branch}` -- reads from the branch tree object |

### Observable Truths (Plan 02)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 9 | Running kb index while checked out on a feature branch indexes content from main/master, not the feature branch | VERIFIED | `pipeline.ts:55` calls `resolveDefaultBranch(repoPath)` before indexing; `pipeline.ts:175-182` passes `branch` to all extractors; pipeline test "indexes from main branch content, not feature branch" exists |
| 10 | Running kb index on a repo in detached HEAD state resolves the default branch and indexes normally | VERIFIED | `resolveDefaultBranch` uses `refs/heads/main` not HEAD; `indexSingleRepo:137-142` auto-resolves branch when not provided; pipeline test "handles detached HEAD state" exists |
| 11 | A repo with no main or master branch is skipped with a warning, not crashed | VERIFIED | `pipeline.ts:56-59` checks `if (!branch)` and pushes `status: 'skipped', skipReason: 'no main or master branch'`; test confirms |
| 12 | The default_branch column is populated in the repos table after indexing | VERIFIED | `writer.ts:44` includes `default_branch` in INSERT; `writer.ts:59` maps `metadata.defaultBranch`; `metadata.ts:78` sets `defaultBranch: branch` |
| 13 | Metadata (description, tech stack, key files) is read from the default branch, not working tree | VERIFIED | `metadata.ts:71-78` branch-aware path uses `readBranchFile` and `listBranchFiles` exclusively; no `fs.readFileSync`/`fs.existsSync` in branch path |
| 14 | Existing incremental indexing still works using branch commit instead of HEAD | VERIFIED | `pipeline.ts:112` calls `getBranchCommit(repoPath, branch)` not `getCurrentCommit`; `pipeline.ts:164` calls `getChangedFilesSinceBranch` not `getChangedFiles` |

**Score:** 14/14 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/schema.ts` | SCHEMA_VERSION = 3 | VERIFIED | Line 6: `export const SCHEMA_VERSION = 3` |
| `src/db/migrations.ts` | v2->v3 migration with ALTER TABLE ADD COLUMN | VERIFIED | `migrateToV3` at line 136; 6 ALTER TABLE statements; gated in `runMigrations` at line 33 |
| `src/indexer/git.ts` | 5 new branch-aware exported functions | VERIFIED | 8 total exports (3 existing + 5 new): resolveDefaultBranch, getBranchCommit, listBranchFiles, readBranchFile, getChangedFilesSinceBranch |
| `src/indexer/pipeline.ts` | Branch-aware indexing orchestration | VERIFIED | Imports `resolveDefaultBranch`; resolves branch at line 55; passes to all extractors at lines 145, 175-182 |
| `src/indexer/metadata.ts` | Branch-aware metadata extraction with defaultBranch field | VERIFIED | `RepoMetadata.defaultBranch` at line 13; branch-aware variants at lines 253-342; `readBranchFile`/`listBranchFiles` used throughout |
| `src/indexer/writer.ts` | default_branch persistence in upsertRepo | VERIFIED | SQL includes `default_branch` at line 44; maps `metadata.defaultBranch` at line 59 |
| `src/indexer/elixir.ts` | Branch-aware extractor using git plumbing | VERIFIED | Uses `listBranchFiles` + `readBranchFile`; no `fs` import; accepts `(repoPath, branch)` |
| `src/indexer/proto.ts` | Branch-aware extractor using git plumbing | VERIFIED | Same pattern as elixir; no `fs` import; accepts `(repoPath, branch)` |
| `src/indexer/events.ts` | Branch-aware consumer detection | VERIFIED | Uses `listBranchFiles` + `readBranchFile`; no `fs` import; accepts `(repoPath, branch, protos, modules)` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `schema.ts` | `migrations.ts` | `runMigrations` call | WIRED | Line 16: `runMigrations(db, currentVersion, SCHEMA_VERSION)` |
| `migrations.ts` | database | ALTER TABLE ADD COLUMN in transaction | WIRED | Lines 138-143: 6 ALTER TABLE statements inside `db.transaction()` |
| `pipeline.ts` | `git.ts` | resolveDefaultBranch + getBranchCommit + getChangedFilesSinceBranch | WIRED | Line 6: imports all 4 functions; lines 55, 112, 164: all called with correct args |
| `pipeline.ts` | `elixir.ts` | extractElixirModules(repoPath, branch) | WIRED | Line 175: `extractElixirModules(repoPath, branch)` |
| `pipeline.ts` | `proto.ts` | extractProtoDefinitions(repoPath, branch) | WIRED | Line 176: `extractProtoDefinitions(repoPath, branch)` |
| `pipeline.ts` | `metadata.ts` | extractMetadata(repoPath, branch) | WIRED | Line 145: `extractMetadata(repoPath, branch)` |
| `writer.ts` | database repos table | upsertRepo persists default_branch | WIRED | Lines 44, 50, 59: SQL + parameter mapping confirmed |
| `pipeline.ts` | `writer.ts` | metadata.defaultBranch flows through | WIRED | `metadata` returned from `extractMetadata` includes `defaultBranch`; passed to `persistRepoData` which calls `upsertRepo(db, data.metadata)` which reads `metadata.defaultBranch` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| IDX2-01 | 06-01, 06-02 | Indexer tracks only main/master branch commit SHA, ignoring checked-out PR branches | SATISFIED | `resolveDefaultBranch` implements main->master->null; pipeline uses `getBranchCommit` not `getCurrentCommit`; all extractors use `listBranchFiles`/`readBranchFile` |
| IDX2-05 | 06-01, 06-02 | Schema migration (v3) adds columns/tables needed for new extractors | SATISFIED | 6 new columns added: repos.default_branch, modules.table_name, modules.schema_fields, services.service_type, events.domain, events.owner_team |

No orphaned requirements found. REQUIREMENTS.md maps only IDX2-01 and IDX2-05 to Phase 6, both claimed by plans and both satisfied.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | -- | -- | -- | -- |

Zero TODO/FIXME/PLACEHOLDER/HACK markers found across all 9 modified source files. No empty implementations, no stub returns, no console.log-only handlers.

### Human Verification Required

### 1. Feature branch isolation end-to-end

**Test:** Check out a feature branch in a real repo with local modifications. Run `kb index --force`. Verify indexed content matches main branch, not the feature branch.
**Expected:** `kb search` results reflect main branch content only. Feature-branch-only files/modules do not appear.
**Why human:** Requires a real multi-branch repo with divergent content. Unit tests use synthetic repos.

### 2. Detached HEAD state in real scenario

**Test:** `cd` into a repo, `git checkout HEAD~3`, run `kb index --force`.
**Expected:** Indexing succeeds with main branch content. No errors or warnings about HEAD state.
**Why human:** Detached HEAD is a git state that's easy to simulate in tests but may behave differently with real repo complexity.

### Gaps Summary

No gaps found. All 14 observable truths verified against the actual codebase. All 9 artifacts exist, are substantive (no stubs), and are fully wired. All 8 key links confirmed. Both requirements (IDX2-01, IDX2-05) satisfied. Full test suite passes (263/263 tests). Zero anti-patterns detected.

---

_Verified: 2026-03-06T14:22:00Z_
_Verifier: Claude (gsd-verifier)_
