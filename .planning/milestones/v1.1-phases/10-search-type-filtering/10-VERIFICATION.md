---
phase: 10-search-type-filtering
verified: 2026-03-07T13:36:00Z
status: passed
score: 11/11 must-haves verified
---

# Phase 10: Search Type Filtering Verification Report

**Phase Goal:** Expose granular entity sub-type filtering across CLI, MCP, and search internals. Users can filter search results by specific entity sub-types (e.g., schema, graphql_query, grpc) rather than only coarse types (module, event, service). Includes a type discovery mechanism (--list-types / kb_list_types).
**Verified:** 2026-03-07T13:36:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | FTS stores entity_type as parent:subtype format | VERIFIED | `src/db/fts.ts` L55-57: compositeType computed as `${entity.type}:${entity.subType}`, stored in INSERT. Tests in `tests/db/fts.test.ts` L167-227 confirm. |
| 2 | Coarse --type module returns all module sub-types | VERIFIED | `src/db/fts.ts` L93-95: `resolveTypeFilter('module')` returns `{sql: 'entity_type LIKE ?', param: 'module:%'}`. Used in `text.ts` L72 and `entity.ts` L127. Tests in `tests/search/text.test.ts` L196. |
| 3 | Granular --type schema returns only schema modules | VERIFIED | `src/db/fts.ts` L97: `resolveTypeFilter('schema')` returns `{sql: 'entity_type LIKE ?', param: '%:schema'}`. Tests in `tests/search/text.test.ts` L207-213 and `tests/search/entity.test.ts` L180+. |
| 4 | TextSearchResult includes subType field | VERIFIED | `src/search/types.ts` L6: `subType: string` in interface. All hydrate functions in `text.ts` (L137, L169, L201, L231, L254) pass subType. Tests confirm in `tests/search/text.test.ts` L233-239. |
| 5 | Entity search supports sub-type filtering in exact and FTS paths | VERIFIED | `src/search/entity.ts` L78-95 (findExact) maps sub-types via MODULE_SUB_TYPES/SERVICE_SUB_TYPES, adds column filter. L126-130 (findByFts) uses resolveTypeFilter. L163 parses composite type. |
| 6 | listAvailableTypes returns grouped type counts | VERIFIED | `src/db/fts.ts` L120-134: queries FTS table, groups by parseCompositeType. Tests in `tests/db/fts.test.ts` L297-324. |
| 7 | CLI --type flag accepts sub-types | VERIFIED | `src/cli/commands/search.ts` L19-20: description mentions sub-types, L52 passes `opts.type` as string (no EntityType cast). |
| 8 | CLI --list-types prints grouped type counts | VERIFIED | `src/cli/commands/search.ts` L27: `--list-types` option. L30-33: calls `listAvailableTypes(db)` and outputs result. Query argument made optional (L16: `[query]`). |
| 9 | MCP kb_search has type parameter that filters results | VERIFIED | `src/mcp/tools/search.ts` L21: `type: z.string().optional()`. L28: passed as `entityTypeFilter: type`. Tests in `tests/mcp/tools.test.ts` L277-289. |
| 10 | MCP kb_list_types tool returns grouped types | VERIFIED | `src/mcp/tools/list-types.ts` L10-29: full implementation calling `listAvailableTypes(db)`. Wired in `server.ts` L36. Tests in `tests/mcp/tools.test.ts` L306-325. |
| 11 | Skill docs and MCP descriptions updated for type filtering | VERIFIED | `skill/SKILL.md` L33-34: sub-type and --list-types documented. MCP entity tool description updated (`src/mcp/tools/entity.ts` L19). |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/fts.ts` | indexEntity with subType, UNINDEXED entity_type, resolveTypeFilter, parseCompositeType, listAvailableTypes, COARSE_TYPES | VERIFIED | 180 lines, all 6 exports present and substantive |
| `src/search/types.ts` | subType on TextSearchResult, string entityTypeFilter and type | VERIFIED | subType at L6, entityTypeFilter as string at L23, type as string at L47 |
| `src/search/text.ts` | resolveTypeFilter usage, composite parsing in hydrateResult | VERIFIED | imports at L5, resolveTypeFilter at L72, parseCompositeType at L110, all 5 hydrate functions pass subType |
| `src/search/entity.ts` | Sub-type mapping in findExact, resolveTypeFilter in findByFts | VERIFIED | MODULE_SUB_TYPES/SERVICE_SUB_TYPES sets, subTypeToParent helper, findExact column filters at L218/L245, findByFts resolveTypeFilter at L127 |
| `src/indexer/writer.ts` | All indexEntity calls pass subType | VERIFIED | 7 call sites (4 in persistRepoData, 3 in persistSurgicalData), all with subType |
| `src/search/index.ts` | Re-exports listAvailableTypes | VERIFIED | L4: `export { listAvailableTypes } from '../db/fts.js'` |
| `src/cli/commands/search.ts` | --type description, --list-types flag, optional query | VERIFIED | 57 lines, all features present |
| `src/mcp/tools/search.ts` | type Zod parameter | VERIFIED | L21: `type: z.string().optional()`, L28: passed to searchText |
| `src/mcp/tools/list-types.ts` | New kb_list_types tool | VERIFIED | 29 lines, registerListTypesTool exported and implemented |
| `src/mcp/server.ts` | registerListTypesTool wired | VERIFIED | L21: import, L36: registration call (8 tools total) |
| `src/mcp/tools/entity.ts` | Updated type description | VERIFIED | L19: description mentions sub-types |
| `skill/SKILL.md` | Sub-type filtering docs | VERIFIED | L33-34: --type schema/grpc/graphql_query and --list-types documented |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/indexer/writer.ts` | `src/db/fts.ts` | indexEntity with subType | WIRED | 7 call sites, all pass subType param |
| `src/search/text.ts` | `src/db/fts.ts` | resolveTypeFilter | WIRED | Import at L5, used at L72 in executeFtsQuery |
| `src/search/entity.ts` | `src/db/fts.ts` | resolveTypeFilter + parseCompositeType + COARSE_TYPES | WIRED | Import at L5, resolveTypeFilter at L127, parseCompositeType at L163, COARSE_TYPES at L79 |
| `src/cli/commands/search.ts` | `src/db/fts.ts` | listAvailableTypes | WIRED | Import at L9, called at L31 |
| `src/mcp/tools/search.ts` | `src/search/text.ts` | entityTypeFilter from type param | WIRED | L28: `entityTypeFilter: type` passed to searchText |
| `src/mcp/tools/list-types.ts` | `src/db/fts.ts` | listAvailableTypes | WIRED | Import at L8, called at L17 |
| `src/mcp/server.ts` | `src/mcp/tools/list-types.ts` | registerListTypesTool | WIRED | Import at L21, called at L36 |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TF-01 | 10-01 | FTS entity_type stores parent:subtype composite format with UNINDEXED | SATISFIED | `fts.ts` L27: `entity_type UNINDEXED`, L55-57: composite format. 12 tests. |
| TF-02 | 10-01 | resolveTypeFilter handles both coarse and granular type values | SATISFIED | `fts.ts` L93-98: COARSE_TYPES check, prefix vs suffix LIKE. Tests at `fts.test.ts` L245-269. |
| TF-03 | 10-01 | searchText supports both coarse and granular --type filtering | SATISFIED | `text.ts` L69-75: resolveTypeFilter in executeFtsQuery. Tests at `text.test.ts` L195-230. |
| TF-04 | 10-01 | TextSearchResult includes subType field populated on all results | SATISFIED | `types.ts` L6: subType field. All 5 hydrate functions populate it. Tests at `text.test.ts` L233-239. |
| TF-05 | 10-01 | findEntity supports sub-type filtering in both exact-match and FTS paths | SATISFIED | `entity.ts` L78-95 (exact), L126-130 (FTS). Tests at `entity.test.ts` L180+. |
| TF-06 | 10-01 | listAvailableTypes returns grouped sub-type counts from FTS table | SATISFIED | `fts.ts` L120-134. Tests at `fts.test.ts` L297-324. |
| TF-07 | 10-02 | CLI --type flag accepts sub-types, --list-types discovers available types | SATISFIED | `search.ts` L19-20 (--type), L27 (--list-types), L30-33 (handler). |
| TF-08 | 10-02 | MCP tools support type parameter and kb_list_types for discovery | SATISFIED | `search.ts` L21 (type param), `list-types.ts` (new tool), `server.ts` L36 (wired). Tests at `tools.test.ts` L277-351. |

No orphaned requirements found -- all 8 TF-* requirements mapped to Phase 10 are accounted for in the plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | No anti-patterns detected in any modified files |

### Human Verification Required

### 1. CLI --list-types Output Format

**Test:** Run `kb search --list-types` against a populated database
**Expected:** JSON output showing grouped types like `{ "module": [{ "subType": "schema", "count": N }, ...], "service": [...] }`
**Why human:** Requires a populated database with indexed repos; format and readability best assessed visually

### 2. CLI --type Granular Filtering End-to-End

**Test:** Run `kb search "some_term" --type schema` against a populated database
**Expected:** Only results with subType "schema" appear; running with `--type module` returns all module sub-types
**Why human:** End-to-end behavior against real indexed data not covered by unit tests

### 3. MCP Tool Discoverability

**Test:** Connect an MCP client and invoke `kb_list_types`, then invoke `kb_search` with `type: "grpc"`
**Expected:** `kb_list_types` returns grouped type counts; `kb_search` with type filters correctly
**Why human:** MCP transport behavior and client interaction can't be verified without a running server

### Gaps Summary

No gaps found. All 11 observable truths verified, all 12 artifacts substantive and wired, all 7 key links connected, all 8 requirements satisfied. 388 tests pass, TypeScript compiles cleanly. Four feature commits confirmed in git history (`b414b6d`, `04d893f`, `1281c5f`, `3c3d89c`).

---

_Verified: 2026-03-07T13:36:00Z_
_Verifier: Claude (gsd-verifier)_
