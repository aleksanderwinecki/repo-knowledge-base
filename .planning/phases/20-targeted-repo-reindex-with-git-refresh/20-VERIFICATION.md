---
phase: 20-targeted-repo-reindex-with-git-refresh
verified: 2026-03-09T10:20:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
---

# Phase 20: Targeted Repo Reindex with Git Refresh Verification Report

**Phase Goal:** Users can reindex specific repos (instead of all ~400) with an automatic git refresh step that fetches the latest code from the remote before indexing
**Verified:** 2026-03-09T10:20:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `gitRefresh()` fetches from origin and resets local default branch to match remote | VERIFIED | `src/indexer/git.ts` lines 170-221: fetch origin + reset --hard origin/branch. 5 unit tests passing including bare+clone integration. |
| 2 | `gitRefresh()` returns `{ refreshed: false, error }` for no-remote, dirty tree, fetch failure | VERIFIED | try/catch at line 217 returns error msg. Dirty tree check at line 198. Tests at git.test.ts lines 335-385 cover all 3 error paths. |
| 3 | `kb index --repo foo` only indexes repo 'foo', not all ~400 repos | VERIFIED | `pipeline.ts` lines 328-339: Set-based filtering on `path.basename`. Integration test at pipeline.test.ts:1524 confirms only targeted repo in DB. |
| 4 | `kb index --repo foo --refresh` does git fetch+reset before indexing foo | VERIFIED | CLI passes `repos` and `refresh` at index-cmd.ts:35-36. Pipeline refresh step at lines 342-352 runs before Phase 1. Integration test at pipeline.test.ts:1572 exercises full path. |
| 5 | `kb index --refresh` refreshes all repos before full index | VERIFIED | Refresh block at pipeline.ts:342 is not gated on `options.repos`, so runs for all discovered repos when refresh=true. |
| 6 | Repos not found on filesystem produce a warning, not a crash | VERIFIED | `console.warn` at pipeline.ts:336 for missing repos. Test at pipeline.test.ts:1561 confirms 0 successes, no crash. |
| 7 | `kb_reindex` MCP tool accepts repo names and triggers targeted reindex with refresh | VERIFIED | `src/mcp/tools/reindex.ts` accepts `{ repos, refresh }`, calls `indexAllRepos`. Test at tools.test.ts:443 verifies mock call with correct options. |
| 8 | `kb_reindex` returns JSON with results per repo (success/error/skipped) | VERIFIED | reindex.ts lines 39-43 returns `{ summary, results, total }`. Test at tools.test.ts:489 verifies error count in summary. |
| 9 | `kb_reindex` with refresh=false skips git refresh step | VERIFIED | Handler passes `refresh` through to `indexAllRepos`. Test at tools.test.ts:476 confirms `refresh: false` in mock call args. |
| 10 | MCP server registers kb_reindex tool alongside existing 9 tools (10 total) | VERIFIED | server.ts line 39: `registerReindexTool(server, db)`. server.test.ts asserts 10 tools and lists kb_reindex by name. |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/indexer/git.ts` | gitRefresh() function | VERIFIED | 52-line function (lines 170-221), exported, proper error handling with try/catch |
| `src/indexer/pipeline.ts` | IndexOptions.repos and IndexOptions.refresh, filtering in indexAllRepos | VERIFIED | `repos?: string[]` and `refresh?: boolean` at lines 28-29. Filtering at 328-339. Refresh at 342-352. |
| `src/cli/commands/index-cmd.ts` | --repo and --refresh CLI options | VERIFIED | `--repo <names...>` at line 23, `--refresh` at line 25. Both passed to indexAllRepos at lines 35-36. |
| `src/mcp/tools/reindex.ts` | registerReindexTool function | VERIFIED | 46-line file. Exports `registerReindexTool`. Zod validation with `.min(1)`. Runtime empty-array guard. |
| `src/mcp/server.ts` | Server wiring for kb_reindex | VERIFIED | Import at line 22, registration at line 39. |
| `tests/indexer/git.test.ts` | gitRefresh test cases | VERIFIED | 5 tests in `describe('gitRefresh')` block (lines 308-386). All passing. |
| `tests/indexer/pipeline.test.ts` | Targeted indexing integration tests | VERIFIED | 3 tests in `describe('targeted repo indexing')` block (lines 1519-1610). All passing. |
| `tests/mcp/tools.test.ts` | kb_reindex MCP tool tests | VERIFIED | 5 tests in `describe('kb_reindex')` block (lines 433-501). All passing. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/cli/commands/index-cmd.ts` | `src/indexer/pipeline.ts` | passes repos and refresh options to indexAllRepos | WIRED | `repos: opts.repo, refresh: opts.refresh` at lines 35-36 |
| `src/indexer/pipeline.ts` | `src/indexer/git.ts` | calls gitRefresh() when options.refresh is true | WIRED | Import at line 7, call at line 346 inside `if (options.refresh)` block |
| `src/mcp/tools/reindex.ts` | `src/indexer/pipeline.ts` | calls indexAllRepos with repos and refresh options | WIRED | Import at line 11, call at line 29 with `{ force: true, rootDir, repos, refresh }` |
| `src/mcp/server.ts` | `src/mcp/tools/reindex.ts` | registerReindexTool(server, db) | WIRED | Import at line 22, call at line 39 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| RIDX-01 | 20-01 | `kb index --repo <name>` indexes only targeted repo(s) | SATISFIED | Set-based filter in pipeline.ts, integration test confirms single-repo indexing |
| RIDX-02 | 20-01 | `gitRefresh()` fetches from origin and resets local default branch | SATISFIED | Full implementation with fetch, branch check, checkout, reset --hard |
| RIDX-03 | 20-01 | `--refresh` CLI flag triggers git refresh before indexing | SATISFIED | CLI option wired to pipeline, refresh step executes before Phase 1 |
| RIDX-04 | 20-01 | Git refresh handles errors gracefully (no remote, dirty tree, timeout) | SATISFIED | try/catch wrapping, dirty-tree guard, 30s timeout on fetch, 5 test cases |
| RIDX-05 | 20-02 | `kb_reindex` MCP tool accepts repo names with optional git refresh | SATISFIED | Tool registered, zod-validated, runtime guards, 5 MCP test cases |

No orphaned requirements found -- all 5 RIDX requirements mapped to Phase 20 in REQUIREMENTS.md are claimed by plans 20-01 and 20-02.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | -- | -- | -- | No anti-patterns detected across all modified files |

### Human Verification Required

### 1. Real-world git refresh with network access

**Test:** Run `kb index --repo <real-repo-name> --refresh` against a real repo that has upstream changes
**Expected:** Git fetch succeeds, local branch resets to remote HEAD, indexer picks up new content
**Why human:** Requires network access and a real git remote with actual upstream changes

### 2. MCP tool invocation via real MCP client

**Test:** Start MCP server, connect a client, call `kb_reindex` with a real repo name
**Expected:** Tool returns JSON with reindex results, repo data in DB reflects latest remote state
**Why human:** End-to-end MCP transport behavior can't be verified without a running server and client

### Gaps Summary

No gaps found. All 10 observable truths verified. All 5 requirements satisfied. All artifacts exist, are substantive, and are fully wired. Clean TypeScript build. 100 tests passing across the 4 test files (git, pipeline, tools, server). No anti-patterns detected.

---

_Verified: 2026-03-09T10:20:00Z_
_Verifier: Claude (gsd-verifier)_
