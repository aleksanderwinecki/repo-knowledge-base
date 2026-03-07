---
phase: 08-new-extractors
verified: 2026-03-06T17:00:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 8: New Extractors Verification Report

**Phase Goal:** The knowledge base captures GraphQL schemas, gRPC service definitions, Ecto database structures, and Event Catalog domain metadata from indexed repos
**Verified:** 2026-03-06T17:00:00Z
**Status:** passed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

Based on ROADMAP.md Success Criteria and Plan must_haves:

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `kb search "MyService"` returns gRPC service definitions from `.proto` files, including RPC methods and client call edges | VERIFIED | `ServiceData` persisted in `persistRepoData` with `service_type='grpc'`, FTS-indexed with RPC method descriptions. `insertGrpcClientEdges()` creates `calls_grpc` edges. E2e test at pipeline.test.ts:1259-1263 confirms FTS searchability. |
| 2 | `kb search "users"` returns Ecto schema fields, associations, and table names from `.ex` files | VERIFIED | `ElixirModule.schemaFields` and `associations` extracted by `extractSchemaDetails()`. `ModuleData.tableName`/`schemaFields` persisted in writer with FTS description including `table:tableName`. E2e test at pipeline.test.ts:1253-1257 confirms table name FTS search. |
| 3 | `kb search "CreateBooking"` returns GraphQL mutations/queries/types from both `.graphql` SDL and Absinthe macros in `.ex` | VERIFIED | `parseGraphqlFile()` extracts type/input/enum/interface/union/scalar from SDL. `extractAbsintheTypes()` extracts object/input_object/query/mutation. Both mapped to modules with `graphql_*` and `absinthe_*` type prefixes. E2e test at pipeline.test.ts:1231-1245 verifies both. |
| 4 | `kb search "BookingCreated"` returns Event Catalog metadata merged with existing event data | VERIFIED | `enrichFromEventCatalog()` in catalog.ts performs multi-strategy matching (exact CamelCase, LIKE suffix, path-based Payload) and UPDATEs `events.domain` and `events.owner_team`. Called after `indexAllRepos` loop at pipeline.ts:102. Integration tests in catalog.test.ts:187-278 cover all matching strategies. |
| 5 | All new extractor data survives surgical re-indexing | VERIFIED | Pipeline.ts surgical mode: modules filtered by `changedSet`, services use wipe-and-reinsert (persistSurgicalData), edges re-derived repo-wide. Tests at pipeline.test.ts "surgical mode includes services", "handles GraphQL modules", "handles Ecto fields" all pass. |
| 6 | gRPC client call edges (calls_grpc) connect repos to services they call | VERIFIED | `insertGrpcClientEdges()` at pipeline.ts:405-443 matches stub names to services via DB lookup and inserts `calls_grpc` edges. Deduplicated by service ID. Called in both full and surgical modes. |
| 7 | Event Catalog enrichment populates domain and owner_team on matching events | VERIFIED | `enrichFromEventCatalog()` traverses domain->service->event chain, matches catalog IDs to KB events, wraps UPDATEs in transaction. catalog.test.ts confirms domain ("Payments") and owner_team ("team-xd") set correctly, idempotent, graceful when catalog missing. |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/indexer/elixir.ts` | Extended ElixirModule with schemaFields, associations, absintheTypes, grpcStubs | VERIFIED | 290 lines. Interface has all 4 new properties. Functions: `extractSchemaDetails`, `extractAbsintheTypes`, `extractGrpcStubs` all substantive. Imported and used by pipeline.ts. |
| `src/indexer/graphql.ts` | GraphQL SDL extraction (parseGraphqlFile, extractGraphqlDefinitions) | VERIFIED | 106 lines. Exports `GraphqlType`, `GraphqlDefinition`, `parseGraphqlFile`, `extractGraphqlDefinitions`. Handles type/input/enum/interface/union/scalar + extend. Imported by pipeline.ts:11. |
| `src/indexer/catalog.ts` | Event Catalog enrichment (parseFrontmatter, catalogIdToMatchers, enrichFromEventCatalog) | VERIFIED | 348 lines. All 3 functions exported. Multi-phase enrichment: domain parsing, service parsing, event matching, DB updates. Imported by pipeline.ts:16. |
| `src/indexer/pipeline.ts` | Pipeline wiring for all new extractors | VERIFIED | 494 lines. Calls `extractGraphqlDefinitions` (line 205), maps gRPC services (208-214), GraphQL modules (217-224), Ecto fields (227-234), Absinthe modules (237-244). Inserts edges for gRPC clients and Ecto associations. Calls `enrichFromEventCatalog` after repo loop (line 102). |
| `src/indexer/writer.ts` | ServiceData interface and service persistence | VERIFIED | 444 lines. `ServiceData` interface exported (lines 7-11). `RepoData` includes `services?` (line 19). `persistRepoData` inserts services with ON CONFLICT upsert + FTS (lines 253-279). `persistSurgicalData` does service wipe-and-reinsert (lines 401-437). `clearRepoEntities` cleans service FTS (lines 101-107). |
| `tests/indexer/elixir.test.ts` | Tests for Ecto, Absinthe, gRPC extraction | VERIFIED | 487 lines. Describes: "ecto schema extraction" (7 tests), "absinthe macro extraction" (4 tests), "grpc stub detection" (4 tests). |
| `tests/indexer/graphql.test.ts` | Tests for GraphQL SDL parsing | VERIFIED | 250 lines. 17 tests covering all definition kinds + branch extraction. |
| `tests/indexer/catalog.test.ts` | Tests for Event Catalog enrichment | VERIFIED | 282 lines. Tests: parseFrontmatter (5), catalogIdToMatchers (4), enrichFromEventCatalog integration (6). |
| `tests/indexer/pipeline.test.ts` | Integration tests for new extractor wiring | VERIFIED | Tests: "new extractor wiring" (9 tests), "end-to-end search integration" (1 test). All pass. |
| `tests/indexer/writer.test.ts` | Service persistence tests | VERIFIED | "service persistence" describe block with tests for insert, FTS, upsert, surgical mode. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| pipeline.ts | graphql.ts | `extractGraphqlDefinitions` call | WIRED | Import at line 11, called at line 205. Results mapped to modules at lines 217-224. |
| pipeline.ts | writer.ts | `ServiceData` in `RepoData.services` | WIRED | Import at line 15, services built at lines 208-214, passed to `persistRepoData` at line 322 and `persistSurgicalData` at line 277. |
| pipeline.ts | catalog.ts | `enrichFromEventCatalog` call | WIRED | Import at line 16, called at line 102 after repo loop with try/catch. |
| catalog.ts | events table | UPDATE events SET domain, owner_team | WIRED | SQL at line 124-125. Multi-strategy SELECT at lines 135-151. UPDATE in transaction at line 155. |
| elixir.ts | pipeline.ts | `ElixirModule` interface consumed | WIRED | Import at line 8, `extractElixirModules` called at line 203. New properties (schemaFields, associations, absintheTypes, grpcStubs) consumed at lines 227-244, 286-287, 330-333. |
| writer.ts | FTS | `indexEntity` for services | WIRED | Service FTS indexing at line 274 (full mode), line 431 (surgical mode). Removal at lines 101-107 (`clearRepoEntities`). |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| EXT-01 | 02, 03 | gRPC service definitions from `.proto` files persisted to services table | SATISFIED | Proto services mapped to `ServiceData[]` at pipeline.ts:208-214. Persisted via writer with FTS. E2e test confirms. |
| EXT-02 | 01, 03 | Ecto schema fields, associations, table names extracted from `.ex` files | SATISFIED | `extractSchemaDetails()` in elixir.ts. `tableName`/`schemaFields` in ModuleData. Association edges via `insertEctoAssociationEdges()`. E2e test confirms table_name, schema_fields JSON, and belongs_to/has_many edges. |
| EXT-03 | 02, 03 | GraphQL types, queries, mutations from `.graphql` SDL files | SATISFIED | `parseGraphqlFile()` in graphql.ts. Mapped to modules with `graphql_*` type prefix in pipeline.ts:217-224. E2e test at pipeline.test.ts:1231-1238. |
| EXT-04 | 01, 03 | Absinthe macro definitions extracted from `.ex` files | SATISFIED | `extractAbsintheTypes()` in elixir.ts. Mapped to modules with `absinthe_*` type prefix in pipeline.ts:237-244. E2e test at pipeline.test.ts:1240-1245. |
| EXT-05 | 03 | Event Catalog data integrated from local catalog repo | SATISFIED | `enrichFromEventCatalog()` in catalog.ts. Called at pipeline.ts:102. Updates domain and owner_team. Integration tests in catalog.test.ts cover all matching strategies. |
| EXT-06 | 01, 03 | gRPC client call patterns create `calls_grpc` edges | SATISFIED | `extractGrpcStubs()` in elixir.ts. `insertGrpcClientEdges()` in pipeline.ts:405-443. Deduplicated by service ID. Called in both modes. |

No orphaned requirements -- all 6 EXT requirements are accounted for.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | - | - | - | - |

No TODOs, FIXMEs, placeholders, empty implementations, or stub patterns found in any Phase 8 artifact.

### Human Verification Required

### 1. Real-world gRPC service searchability

**Test:** Run `kb index --force` then `kb search "RPCService"` on a real codebase with .proto files containing gRPC service definitions.
**Expected:** Service entities appear in results with RPC method descriptions.
**Why human:** FTS ranking and real proto file content may differ from test fixtures.

### 2. Event Catalog matching accuracy

**Test:** Run `kb index` on real repos with `fresha-event-catalog` present, then check `SELECT domain, owner_team FROM events WHERE domain IS NOT NULL` for accuracy.
**Expected:** Events are correctly matched to their catalog counterparts with correct domain/owner.
**Why human:** Multi-strategy matching heuristics (CamelCase, LIKE, path) may produce false positives or miss edge cases in production data.

### 3. Ecto schema field completeness

**Test:** Run `kb search "bookings" --entity` on a real Elixir repo with Ecto schemas.
**Expected:** Schema fields and associations appear in entity card.
**Why human:** Real Ecto schemas may have unusual formatting, macros, or nested structures not covered by regex patterns.

### Gaps Summary

No gaps found. All 7 observable truths verified, all 10 artifacts pass existence + substantive + wiring checks, all 6 key links wired, all 6 requirements satisfied. 355/355 tests pass, TypeScript compiles cleanly, no anti-patterns detected.

---

_Verified: 2026-03-06T17:00:00Z_
_Verifier: Claude (gsd-verifier)_
