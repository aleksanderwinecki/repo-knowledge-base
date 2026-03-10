---
phase: 33-filesystem-reads
verified: 2026-03-10T19:00:00Z
status: passed
score: 12/12 must-haves verified
re_verification: false
---

# Phase 33: Filesystem Reads Verification Report

**Phase Goal:** Extractors read from the working tree filesystem instead of spawning git child processes
**Verified:** 2026-03-10T19:00:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `listWorkingTreeFiles` returns all files under repo path, skipping .git/node_modules/etc | VERIFIED | src/indexer/git.ts lines 253-285: stack-based walk with SKIP_DIRS set |
| 2 | `readWorkingTreeFile` returns file content via fs.readFileSync, null on missing/oversize | VERIFIED | src/indexer/git.ts lines 291-300: statSync size check + readFileSync + try/catch |
| 3 | No extractor function signature contains a `branch` parameter | VERIFIED | All 9 extractor signatures confirmed branch-free (grep + manual check) |
| 4 | No extractor imports `listBranchFiles` or `readBranchFile` | VERIFIED | `grep -rn "listBranchFiles\|readBranchFile" src/` returns zero results |
| 5 | Pipeline uses repo path directly — no branch in extraction path | VERIFIED | pipeline.ts extractRepoData(repoPath, options, dbSnapshot) — no branch param; all extractor calls are branch-free |
| 6 | Pipeline still resolves default branch for --refresh and skip check | VERIFIED | pipeline.ts: resolveDefaultBranch called in both refresh loop and Phase 1; checkSkip still uses getBranchCommit |
| 7 | `kb index --repo foo --refresh` fetches and resets to remote default branch | VERIFIED | gitRefresh(repoPath, branch) called in refresh loop (pipeline.ts:399-404); function does fetch + checkout + reset --hard |
| 8 | Incremental indexing skips unchanged repos via HEAD vs last indexed commit | VERIFIED | checkSkip uses getBranchCommit for skip detection; extractRepoData uses getChangedFilesSinceBranch with 'HEAD' as target ref |
| 9 | All tests pass after refactor | VERIFIED | 779/779 tests pass (npm test output). 1 unhandled rejection is pre-existing MCP server.test.ts process.exit issue, not a refactor regression |
| 10 | No `execSync('git show')` or `execSync('git ls-tree')` anywhere in codebase | VERIFIED | `grep -rn "git show\|git ls-tree" src/` returns zero results |
| 11 | Branch-aware code paths in metadata.ts removed | VERIFIED | metadata.ts has no `*FromBranch` functions, no branch parameter; defaultBranch always returns null |
| 12 | TypeScript compiles clean, build succeeds | VERIFIED | `npx tsc --noEmit` exits clean; `npm run build` exits clean |

**Score:** 12/12 truths verified

---

### Required Artifacts

#### Plan 33-01

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/indexer/git.ts` | `listWorkingTreeFiles` and `readWorkingTreeFile` fs functions | VERIFIED | Both functions present at lines 253-300; implementation is substantive (stack walk, 500KB cap, SKIP_DIRS) |
| `src/indexer/elixir.ts` | `extractElixirModules(repoPath)` without branch | VERIFIED | Signature confirmed; imports `listWorkingTreeFiles, readWorkingTreeFile` from `./git.js` |
| `src/indexer/proto.ts` | `extractProtoDefinitions(repoPath)` without branch | VERIFIED | Signature confirmed; imports `listWorkingTreeFiles, readWorkingTreeFile` from `./git.js` |
| `src/indexer/graphql.ts` | `extractGraphqlDefinitions(repoPath)` without branch | VERIFIED | Signature confirmed; imports `listWorkingTreeFiles, readWorkingTreeFile` from `./git.js` |
| `src/indexer/events.ts` | `detectEventRelationships(repoPath, ...)` without branch | VERIFIED | Signature confirmed; imports `listWorkingTreeFiles, readWorkingTreeFile` from `./git.js` |
| `src/indexer/topology/index.ts` | `extractTopologyEdges(repoPath, elixirModules)` without branch | VERIFIED | Signature confirmed at line 14; delegates to sub-extractors without branch arg |

#### Plan 33-02

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/indexer/pipeline.ts` | Wired to fs-based extractors; no branch in extraction | VERIFIED | WorkItem has no branch field; extractRepoData has no branch param; all 6 extractor calls are branch-free |
| `src/indexer/git.ts` | `listBranchFiles`/`readBranchFile` removed | VERIFIED | Neither function exists in file; no `git show` or `git ls-tree` execSync calls remain |

---

### Key Link Verification

#### Plan 33-01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/indexer/elixir.ts` | `src/indexer/git.ts` | `import { listWorkingTreeFiles, readWorkingTreeFile }` | VERIFIED | Line 1 of elixir.ts confirms import; functions called in body |
| `src/indexer/proto.ts` | `src/indexer/git.ts` | `import { listWorkingTreeFiles, readWorkingTreeFile }` | VERIFIED | Line 1 of proto.ts confirms import |
| `src/indexer/topology/grpc-clients.ts` | `src/indexer/git.ts` | `import { listWorkingTreeFiles, readWorkingTreeFile }` | VERIFIED | Line 1 of grpc-clients.ts confirms import from `../git.js` |
| `src/indexer/topology/http-clients.ts` | `src/indexer/git.ts` | `import { listWorkingTreeFiles, readWorkingTreeFile }` | VERIFIED | Confirmed; `listWorkingTreeFiles(repoPath)` called in body |
| `src/indexer/topology/gateway.ts` | `src/indexer/git.ts` | `import { listWorkingTreeFiles, readWorkingTreeFile }` | VERIFIED | Confirmed import from `../git.js` |
| `src/indexer/topology/kafka.ts` | `src/indexer/git.ts` | `import { listWorkingTreeFiles, readWorkingTreeFile }` | VERIFIED | Confirmed import from `../git.js` |

#### Plan 33-02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/indexer/pipeline.ts` | Extractors | Function calls without branch arg | VERIFIED | Lines 127-177: all 6 extractor calls use only repoPath (+ non-branch args); confirmed in source |
| `src/indexer/pipeline.ts` | `src/indexer/git.ts` | `resolveDefaultBranch`, `getBranchCommit`, `getCurrentCommit` | VERIFIED | Import line 7; used in refresh loop, checkSkip, and incremental detection |
| `tests/indexer/pipeline.test.ts` | `src/indexer/pipeline.ts` | Integration tests | VERIFIED | Test suite passes: 779/779 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FS-01 | 33-01 | Extractors read file contents via `fs.readFileSync()` instead of `execSync('git show ...')` | SATISFIED | `readWorkingTreeFile` uses `fs.readFileSync`; all extractors import and use it; zero `git show` calls in src/ |
| FS-02 | 33-01 | File listing uses filesystem traversal instead of `execSync('git ls-tree ...')` | SATISFIED | `listWorkingTreeFiles` does stack-based `fs.readdirSync` walk; zero `git ls-tree` calls in src/ |
| FS-03 | 33-01 | Branch parameter removed from all extractor function signatures | SATISFIED | All 9 extractor public signatures confirmed branch-free |
| FS-04 | 33-02 | Pipeline uses repo working tree path directly — no branch resolution needed for extraction | SATISFIED | `extractRepoData` and `WorkItem` have no branch field; extraction calls are branch-free |
| COR-01 | 33-02 | `--refresh` still fetches and resets to remote default branch before indexing | SATISFIED | Refresh loop resolves branch then calls `gitRefresh(repoPath, branch)` which does fetch + reset --hard origin/branch |
| COR-02 | 33-02 | Incremental indexing (commit comparison) still works — compares HEAD vs last indexed commit | SATISFIED | `checkSkip` uses `getBranchCommit` for skip detection; incremental diff uses `getChangedFilesSinceBranch(repoPath, lastCommit, 'HEAD')` |
| COR-03 | 33-02 | All existing tests pass after refactor | SATISFIED | 779/779 tests pass |

**Orphaned requirements check:** REQUIREMENTS.md maps FS-01, FS-02, FS-03, FS-04, COR-01, COR-02, COR-03 to Phase 33. All 7 are claimed by plans 33-01 and 33-02. No orphans.

**Note:** REQUIREMENTS.md still marks FS-04, COR-01, COR-02, COR-03 as `[ ]` (pending) even though the code is implemented. The traceability table says "Pending" for these. This is a documentation inconsistency in REQUIREMENTS.md — the implementation is complete and verified. The requirement file was not updated after plan 33-02 execution.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | — | — | — | — |

No TODOs, FIXMEs, stubs, placeholder returns, or empty handlers found in modified files.

---

### Human Verification Required

None. All goal truths are programmatically verifiable for this refactor.

---

## Gaps Summary

No gaps. The phase goal is fully achieved.

All extractors read from the filesystem via `listWorkingTreeFiles`/`readWorkingTreeFile`. The dead git file-reading functions (`listBranchFiles`, `readBranchFile`) are removed. The pipeline is wired to branch-free extractors. Git is retained only for legitimate operations: branch resolution for refresh/skip-check, and commit comparison for incremental indexing. The test suite passes at 779/779 with clean TypeScript compilation and a successful build.

The only housekeeping item is that REQUIREMENTS.md's checkbox states for FS-04, COR-01, COR-02, COR-03 still show `[ ]` — these should be marked `[x]` to reflect completion, but this does not affect goal achievement.

---

_Verified: 2026-03-10T19:00:00Z_
_Verifier: Claude (gsd-verifier)_
