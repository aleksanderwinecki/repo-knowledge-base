---
phase: 22-fixes-metadata
verified: 2026-03-09T11:55:00Z
status: passed
score: 3/3 must-haves verified
re_verification:
  previous_status: gaps_found
  previous_score: 2/3
  gaps_closed:
    - "PROJECT.md test count updated from 503 to 506"
    - "CLAUDE.md test count updated from 503 to 506"
    - "FIX-01, FIX-02, META-01 marked [x] in PROJECT.md active requirements"
  gaps_remaining: []
  regressions: []
---

# Phase 22: Fixes & Metadata Verification Report

**Phase Goal:** Remaining UX papercuts are fixed and all project documentation accurately reflects the post-cleanup state of the codebase
**Verified:** 2026-03-09T11:55:00Z
**Status:** passed
**Re-verification:** Yes -- after gap closure

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `kb index --repo foo` skips staleness check and always reindexes | VERIFIED | `pipeline.ts:362`: `if (!options.force && !options.repos?.length)` bypasses `checkSkip`; test at line 368 confirms `force: false` + `repos: ['implicit-force']` returns status `success` not `skipped` |
| 2 | Scanner discovers repos that are symlinks under root directory | VERIFIED | `scanner.ts:30`: checks `isSymbolicLink()` alongside `isDirectory()`; lines 35-41 resolve symlinks via `statSync` with broken-link fallback; tests at lines 101-126 cover valid symlinks and dangling symlinks |
| 3 | PROJECT.md stats, constraints, tool counts, and tech stack reflect post-cleanup reality | VERIFIED | Test count 506 in PROJECT.md (line 63) and CLAUDE.md (line 58) matches actual `npm test` output. No sqlite-vec/transformers/kb_semantic/--semantic/--embed references. 9 MCP tools listed (correct). FIX-01/FIX-02/META-01 marked [x] in active requirements. |

**Score:** 3/3 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/indexer/pipeline.ts` | Implicit force when repos option is set | VERIFIED | Line 362: `!options.repos?.length` guard bypasses staleness check |
| `src/indexer/scanner.ts` | Symlink-aware directory scanning | VERIFIED | Lines 30, 35-41: `isSymbolicLink()` check + `statSync` resolution |
| `tests/indexer/pipeline.test.ts` | Test proving --repo skips staleness check | VERIFIED | Line 368: `--repo bypasses staleness check (implicit force)` test |
| `tests/indexer/scanner.test.ts` | Test proving symlinked repos are discovered | VERIFIED | Lines 101-126: `discovers symlinked repo directories` and `ignores broken symlinks` tests |
| `.planning/PROJECT.md` | Accurate project metadata | VERIFIED | Test count 506, embedding refs removed, MCP tool count 9, active requirements checked |
| `CLAUDE.md` | Accurate test count and CLI documentation | VERIFIED | Line 58: "506 tests", no stale embedding/semantic references |
| `src/cli/commands/docs.ts` | Updated --repo documentation | VERIFIED | Line 20: `# Reindex specific repos (always re-indexes)` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `pipeline.ts` | `checkSkip` | `options.repos implies force` | WIRED | Line 362: `if (!options.force && !options.repos?.length)` guards `checkSkip` call |
| `scanner.ts` | `fs.readdirSync` | `symlink resolution before .git check` | WIRED | Line 30: `isSymbolicLink()` check; lines 35-41: `statSync` resolves target before `.git` check at line 45 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FIX-01 | 22-01 | `kb index --repo` implies force | SATISFIED | `pipeline.ts:362` + test at line 368; REQUIREMENTS.md [x] + Complete |
| FIX-02 | 22-01 | Scanner follows symlinks | SATISFIED | `scanner.ts:30,35-41` + tests at lines 101-126; REQUIREMENTS.md [x] + Complete |
| META-01 | 22-02 | PROJECT.md reflects current reality | SATISFIED | Test count 506 matches actual, embedding refs clean, tool count correct; REQUIREMENTS.md [x] + Complete |

No orphaned requirements -- all three phase requirements (FIX-01, FIX-02, META-01) are claimed by plans and mapped in REQUIREMENTS.md traceability table.

### Anti-Patterns Found

No blocker or warning-level anti-patterns. All previously flagged issues (stale test count, unchecked requirements) are resolved.

### Human Verification Required

### 1. Targeted Reindex Integration Test

**Test:** Run `kb index --repo <known-repo>` where the repo has already been indexed and has no new commits.
**Expected:** Repo should show as "done" (re-indexed), NOT "skipped".
**Why human:** Requires a real indexed database with actual repos; unit test covers the logic but not the full CLI path.

### Re-verification: Gap Closure Summary

Both gaps from the initial verification are now closed:

1. **Test count stale (503 vs 506):** PROJECT.md line 63 and CLAUDE.md line 58 now both say "506 tests", matching the actual `npm test` output of 506 passing tests.
2. **Active requirements unchecked:** PROJECT.md lines 40-41 now show `[x]` for FIX-01/FIX-02 and META-01.

No regressions detected on previously passing truths (implicit force logic in pipeline.ts, symlink support in scanner.ts).

---

_Verified: 2026-03-09T11:55:00Z_
_Verifier: Claude (gsd-verifier)_
