---
phase: 14-core-layer-dedup
verified: 2026-03-07T19:15:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 14: Core Layer Dedup Verification Report

**Phase Goal:** Core indexing, search, and persistence code is deduplicated so that changes to extraction, FTS indexing, entity queries, or edge operations only need to happen in one place
**Verified:** 2026-03-07T19:15:00Z
**Status:** PASSED
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Pipeline extraction logic exists in one shared function -- indexSingleRepo and extractRepoData call the same extraction code | VERIFIED | indexSingleRepo (line 456-484, 29 lines) delegates to `await extractRepoData()` + `persistExtractedData()`. No inline extraction, module mapping, or edge insertion. Same path as indexAllRepos. |
| 2 | All FTS indexing (including knowledge facts) flows through db/fts.ts indexEntity -- knowledge/store.ts does not maintain its own FTS insertion logic | VERIFIED | store.ts imports `indexEntity`/`removeEntity` from `../db/fts.js` (line 8). Zero raw `INSERT INTO knowledge_fts` or `DELETE FROM knowledge_fts` in store.ts. |
| 3 | Entity hydration and entity query dispatch each live in one place -- search modules share a single hydration pattern and a single query router | VERIFIED | `createEntityHydrator` exported from entity.ts (line 123), imported and used by text.ts (line 5, 32). Zero `hydrate*` functions in text.ts. Single switch dispatch in the hydrator. |
| 4 | FTS query fallback logic is shared between text.ts and entity.ts | VERIFIED | `executeFtsWithFallback` exported from db/fts.ts (line 128). text.ts imports and calls it (line 4, 106). entity.ts imports and calls it (line 5, 300-301). Zero try/catch blocks in either search module. |
| 5 | Writer insert helpers, clearRepoEntities batch cleanup, and edge insertion operations are each consolidated into single implementations | VERIFIED | `insertModuleWithFts` (line 183), `insertEventWithFts` (line 216), `insertServiceWithFts` (line 242), `clearEntityFts` (line 84) in writer.ts. Both `persistRepoData` and `persistSurgicalData` call same helpers. Edge functions (`insertEventEdges`, `insertGrpcClientEdges`, `insertEctoAssociationEdges`) called only from `persistExtractedData` (lines 246-276). |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/fts.ts` | executeFtsWithFallback helper | VERIFIED | Lines 128-144, generic `<T>` with phrase-retry fallback. Exported. |
| `src/search/text.ts` | Uses shared FTS fallback and hydrator | VERIFIED | Imports `executeFtsWithFallback` (line 4) and `createEntityHydrator` (line 5). 108 lines total -- clean and concise. |
| `src/search/entity.ts` | Exports createEntityHydrator, uses executeFtsWithFallback | VERIFIED | `createEntityHydrator` exported (line 123). `executeFtsWithFallback` used in `findByFts` (line 300). `EntityInfo` exported (line 336) with `repoPath` field. |
| `src/indexer/pipeline.ts` | indexSingleRepo delegates to extractRepoData + persistExtractedData | VERIFIED | 29-line async function (lines 456-484). `await extractRepoData()` on line 482, `persistExtractedData()` on line 483. |
| `src/indexer/writer.ts` | Insert helpers and clearEntityFts | VERIFIED | 4 module-private helpers. Both `persistRepoData` (lines 299, 313, 329) and `persistSurgicalData` (lines 417, 426, 453) call same helpers. `clearRepoEntities` uses `clearEntityFts` for all 3 entity types (lines 113-115). |
| `src/mcp/sync.ts` | Async, awaits indexSingleRepo | VERIFIED | `checkAndSyncRepos` is async (line 27). `await indexSingleRepo` on line 62. `withAutoSync` is async (line 78). |
| `src/knowledge/store.ts` | Uses indexEntity/removeEntity from db/fts.ts | VERIFIED | Import on line 8. `indexEntity` called in `learnFact` (line 26). `removeEntity` called in `forgetFact` (line 79). No raw FTS SQL. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/search/text.ts | src/db/fts.ts | import executeFtsWithFallback | WIRED | Line 4 import, line 106 usage |
| src/search/entity.ts | src/db/fts.ts | import executeFtsWithFallback | WIRED | Line 5 import, line 300 usage |
| src/search/text.ts | src/search/entity.ts | import createEntityHydrator | WIRED | Line 5 import, line 32 usage |
| indexSingleRepo | extractRepoData | await call | WIRED | Line 482: `await extractRepoData(...)` |
| indexSingleRepo | persistExtractedData | function call | WIRED | Line 483: `return persistExtractedData(db, extracted)` |
| persistRepoData | insertModuleWithFts | function call in transaction | WIRED | Line 299 |
| persistSurgicalData | insertModuleWithFts | function call in transaction | WIRED | Line 417 |
| src/knowledge/store.ts | src/db/fts.ts | import indexEntity/removeEntity | WIRED | Line 8 import, lines 26 and 79 usage |
| src/mcp/sync.ts | indexSingleRepo | await call | WIRED | Line 62: `await indexSingleRepo(...)` |
| MCP tools | withAutoSync | await call | WIRED | search.ts:25, entity.ts:28, deps.ts:37 all `await withAutoSync(...)` |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CORE-01 | 14-03 | Pipeline extraction logic deduplicated | SATISFIED | indexSingleRepo is 29 lines delegating to extractRepoData + persistExtractedData |
| CORE-02 | 14-03 | FTS indexing paths unified | SATISFIED | store.ts uses db/fts.ts indexEntity/removeEntity. No raw FTS SQL in store.ts. |
| CORE-03 | 14-01 | Entity hydration pattern consolidated | SATISFIED | createEntityHydrator in entity.ts used by both text.ts and entity.ts |
| CORE-04 | 14-01 | Entity query switch deduplicated | SATISFIED | Single switch in createEntityHydrator. No hydrate* functions in text.ts. |
| CORE-05 | 14-01 | FTS query fallback logic shared | SATISFIED | executeFtsWithFallback in db/fts.ts used by both text.ts and entity.ts. Zero try/catch in either. |
| CORE-06 | 14-02 | clearRepoEntities batch cleanup optimized | SATISFIED | clearEntityFts helper called 3 times (lines 113-115) |
| CORE-07 | 14-02 | Writer insert helpers extracted | SATISFIED | insertModuleWithFts, insertEventWithFts, insertServiceWithFts used by both persist functions |
| CORE-08 | 14-03 | Edge operations consolidated | SATISFIED | insertEventEdges, insertGrpcClientEdges, insertEctoAssociationEdges called only from persistExtractedData (2 call sites: surgical path lines 246-250, full path lines 272-276). indexSingleRepo has zero edge logic. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No TODO/FIXME/HACK/PLACEHOLDER found in any modified file |

No stub patterns, no empty implementations, no console.log-only handlers detected across all Phase 14 files.

### Human Verification Required

None. All deduplication changes are structural refactoring verified by:
- 440 passing tests (confirmed by user)
- Static code analysis (imports, function call chains, line counts)
- No behavioral changes -- only internal consolidation

### Gaps Summary

No gaps. All 8 CORE requirements satisfied. All 5 success criteria from ROADMAP.md verified against actual codebase.

The deduplication is thorough:
- FTS fallback: 1 implementation in db/fts.ts, 2 callers
- Entity hydration: 1 factory in entity.ts, 2 consumers (text.ts by-ID, entity.ts by-FTS-then-ID)
- Writer insert+FTS: 3 helpers, each called from both persistRepoData and persistSurgicalData
- Pipeline: indexSingleRepo is a thin 29-line wrapper, same code path as indexAllRepos
- Edge operations: single call site through persistExtractedData
- Knowledge FTS: flows through db/fts.ts indexEntity, no separate path

---

_Verified: 2026-03-07T19:15:00Z_
_Verifier: Claude (gsd-verifier)_
