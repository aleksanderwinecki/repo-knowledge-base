---
phase: 21-embedding-removal
verified: 2026-03-09T11:26:00Z
status: passed
score: 6/6 must-haves verified
---

# Phase 21: Embedding Removal Verification Report

**Phase Goal:** All embedding infrastructure is gone -- the codebase has no sqlite-vec, no transformers.js, no vec0 table, no semantic search paths, and all tests pass
**Verified:** 2026-03-09T11:26:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                      | Status       | Evidence                                                                                     |
| --- | ------------------------------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------- |
| 1   | `src/embeddings/` directory does not exist and no source file imports from it               | VERIFIED     | Directory absent; grep for `embeddings` across src/*.ts returns zero matches                  |
| 2   | `npm ls sqlite-vec` and `npm ls @huggingface/transformers` both report "not installed"      | VERIFIED     | Both report `(empty)` -- not in dependency tree; package.json has no references               |
| 3   | `kb search "query"` uses FTS5 only -- no hybrid/vector code path exists                    | VERIFIED     | `src/cli/commands/search.ts` calls `searchText` (sync FTS5) for default; no hybrid/semantic imports |
| 4   | `kb search "payments"` (default search) returns FTS5 results only, no hybrid/RRF scoring   | VERIFIED     | `search/index.ts` barrel exports only `searchText`, `findEntity`, `queryDependencies`, `listAvailableTypes`; no hybrid/RRF code exists |
| 5   | `kb search --semantic` and `kb_semantic` MCP tool are gone                                 | VERIFIED     | No `--semantic` option in CLI search; `src/mcp/server.ts` registers 9 tools, no semantic; `src/mcp/tools/semantic.ts` deleted |
| 6   | All tests pass with no embedding-related test files remaining                              | VERIFIED     | 503 tests pass (32 files); `tests/embeddings/` dir gone; no embedding/semantic/hybrid/vec references in test files (only `embedded_schema` in Elixir domain tests) |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact                          | Expected                                          | Status     | Details                                                         |
| --------------------------------- | ------------------------------------------------- | ---------- | --------------------------------------------------------------- |
| `src/db/database.ts`              | No vec extension loading                          | VERIFIED   | No `loadVecExtension`, no `vec` import; calls `initializeSchema` only |
| `src/db/schema.ts`                | SCHEMA_VERSION = 7                                | VERIFIED   | Line 6: `export const SCHEMA_VERSION = 7;`                      |
| `src/db/migrations.ts`            | No V8 migration, no vec import                    | VERIFIED   | Migrations go V1-V7 only; no `migrateToV8`, no `isVecAvailable` |
| `src/indexer/pipeline.ts`         | No embed option, no embedding phase               | VERIFIED   | `IndexOptions` has no `embed`; `IndexStats` has no `embeddings`; no Phase 4 embedding block |
| `src/indexer/writer.ts`           | No clearRepoEmbeddings, no vec import             | VERIFIED   | No `clearRepoEmbeddings` function; no `vec` import              |
| `src/search/index.ts`             | Barrel with only searchText, findEntity, queryDependencies, listAvailableTypes | VERIFIED | 4 function exports + types; no semantic/hybrid exports          |
| `src/cli/commands/search.ts`      | Sync FTS5 searchText for default, no --semantic   | VERIFIED   | Default path calls `withDb` (sync) -> `searchText`; no `--semantic` option |
| `src/cli/commands/index-cmd.ts`   | No --embed flag                                   | VERIFIED   | Options: --root, --repo, --force, --refresh, --timing only      |
| `src/mcp/server.ts`               | No semantic tool registration                     | VERIFIED   | 9 tools registered; no `registerSemanticTool` import or call    |
| `src/mcp/sync.ts`                 | No withAutoSyncAsync                              | VERIFIED   | Only `checkAndSyncRepos` and `withAutoSync` exported            |
| `tests/mcp/tools.test.ts`         | No kb_semantic tests or mocks                     | VERIFIED   | No semantic/hybrid/embed references                             |
| `tests/mcp/server.test.ts`        | 9 tools expected, no kb_semantic                  | VERIFIED   | `toHaveLength(9)`; expected tool list has no kb_semantic        |
| `tests/cli/search.test.ts`        | FTS5 default tests, no --semantic                 | VERIFIED   | `describe('CLI search default (FTS5)')` with searchText assertions |
| `tests/db/schema.test.ts`         | SCHEMA_VERSION = 7, no V8 migration tests         | VERIFIED   | `expect(SCHEMA_VERSION).toBe(7)`; no V8/vec assertions          |
| `CLAUDE.md`                       | No semantic/embed references                      | VERIFIED   | Grep returns zero matches for semantic/embed/hybrid/vec         |
| `skill/SKILL.md`                  | No --semantic or embedding references             | VERIFIED   | Grep returns zero matches                                       |

### Key Link Verification

| From                           | To                          | Via                              | Status  | Details                                                    |
| ------------------------------ | --------------------------- | -------------------------------- | ------- | ---------------------------------------------------------- |
| `src/db/database.ts`           | `src/db/schema.ts`          | `initializeSchema` call          | WIRED   | Line 4 import, line 28 call                                |
| `src/indexer/pipeline.ts`      | `src/indexer/writer.ts`     | `persistRepoData, persistSurgicalData` | WIRED | Line 15 import, used in `persistExtractedData`             |
| `src/cli/commands/search.ts`   | `src/search/text.ts`        | `searchText` import              | WIRED   | Line 8 import via barrel, line 63 call in default action   |
| `src/mcp/server.ts`            | `src/mcp/tools/search.ts`   | `registerSearchTool`             | WIRED   | Line 13 import, line 29 call in `createServer`             |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                          | Status    | Evidence                                                     |
| ----------- | ---------- | ------------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------ |
| CLEAN-01    | 21-01      | Remove `src/embeddings/` directory (pipeline.ts, generate.ts, text.ts)               | SATISFIED | Directory does not exist                                     |
| CLEAN-02    | 21-01      | Remove sqlite-vec extension loading (src/db/vec.ts) and vec0 migration (V8)          | SATISFIED | `src/db/vec.ts` deleted; no V8 migration in migrations.ts    |
| CLEAN-03    | 21-01      | Remove `@huggingface/transformers` and `sqlite-vec` npm dependencies                 | SATISFIED | `npm ls` reports both not installed; not in package.json     |
| CLEAN-04    | 21-01      | Remove `searchSemantic`, `searchHybrid` -- default search uses FTS5 only             | SATISFIED | Files deleted; search barrel exports FTS5 functions only     |
| CLEAN-05    | 21-01      | Remove `--semantic` CLI flag, `--embed` CLI flag, and `kb_semantic` MCP tool          | SATISFIED | CLI has neither flag; MCP registers 9 tools, no semantic     |
| CLEAN-06    | 21-02      | Remove all embedding-related tests and update test counts in docs                    | SATISFIED | 6 test files deleted; remaining tests updated; 503 tests pass |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| None | -    | -       | -        | -      |

No TODOs, FIXMEs, placeholders, or empty implementations found related to embedding removal.

### Human Verification Required

None. All success criteria are programmatically verifiable and have been verified:
- File existence/absence: checked
- Package installation status: checked via npm ls
- Source code references: comprehensive grep returns zero matches
- Build compilation: `npm run build` succeeds
- Test suite: 503 tests pass across 32 files

### Gaps Summary

No gaps found. All 6 observable truths verified, all 16 artifacts pass all three levels (exists, substantive, wired), all 4 key links verified, all 6 requirements satisfied, and zero anti-patterns detected.

---

_Verified: 2026-03-09T11:26:00Z_
_Verifier: Claude (gsd-verifier)_
