---
phase: 29-field-extraction-schema
verified: 2026-03-10T14:05:00Z
status: passed
score: 11/11 must-haves verified
re_verification: false
gaps: []
human_verification: []
---

# Phase 29: Field Extraction Schema Verification Report

**Phase Goal:** Every Ecto schema field, proto message field, and GraphQL type field is individually extracted and stored with nullability metadata during indexing
**Verified:** 2026-03-10T14:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

#### Plan 01 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | V8 migration creates a fields table with all required columns and indexes | VERIFIED | `migrateToV8` in `src/db/migrations.ts` lines 261-283: 11-column CREATE TABLE + 5 named indexes (`idx_fields_repo`, `idx_fields_name`, `idx_fields_parent`, `idx_fields_module`, `idx_fields_event`) |
| 2 | Elixir extractor returns requiredFields extracted from validate_required calls | VERIFIED | `extractRequiredFields()` exported at line 280 of `src/indexer/elixir.ts`; called inside `parseElixirFile` at line 93; populates `requiredFields` on `ElixirModule` |
| 3 | Proto extractor captures the optional keyword and exposes it on ProtoField | VERIFIED | `ProtoField.optional: boolean` at line 7 of `src/indexer/proto.ts`; `extractFields` regex captures qualifier group at line 119, sets `optional: qualifier === 'optional'` at line 129 |
| 4 | GraphQL extractor can parse field declarations from type/input/interface bodies | VERIFIED | `parseGraphqlFields()` exported at line 102 of `src/indexer/graphql.ts`; `GraphqlField` interface exported at line 12 |

#### Plan 02 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 5 | Running kb index on a repo with Ecto schemas stores each field as a separate row in the fields table | VERIFIED | Pipeline maps `elixirModules.filter(mod => mod.tableName)` to `FieldData[]` at lines 182-193 of `pipeline.ts`; passed to `persistRepoData`; `INSERT INTO fields` executed in `writer.ts` lines 355-387 |
| 6 | Running kb index on a repo with proto files stores each proto field as a separate row in the fields table | VERIFIED | Pipeline maps `protoDefinitions.flatMap(proto => proto.messages.flatMap(msg => msg.fields.map(...)))` at lines 195-206 of `pipeline.ts`; writer persists with `parentType='proto_message'` |
| 7 | Running kb index on a repo with GraphQL types stores each GraphQL field as a separate row in the fields table | VERIFIED | Pipeline filters to `['type', 'input', 'interface']` kinds and calls `parseGraphqlFields(t.body)` at lines 208-221 of `pipeline.ts`; skips enum/union/scalar |
| 8 | Ecto fields in validate_required are stored with nullable=0; others with nullable=1 | VERIFIED | `nullable: !mod.requiredFields.includes(f.name)` at line 190 of `pipeline.ts`; writer converts to integer: `field.nullable ? 1 : 0` at line 381 |
| 9 | Proto fields with optional keyword are stored with nullable=1; plain fields with nullable=0 | VERIFIED | `nullable: f.optional` at line 203 of `pipeline.ts`; ProtoField.optional is true only for `optional` keyword |
| 10 | Re-indexing a repo does not create duplicate field rows | VERIFIED | `clearRepoEntities` calls `deleteFields.run(repoId)` at line 143 of `writer.ts` before re-insert; test "re-indexing (full persist twice) does not produce duplicate field rows" passes |
| 11 | Surgical re-indexing cleans up fields from changed files before re-inserting | VERIFIED | `clearRepoFiles` calls `deleteFieldsByFile.run(repoId, filePath)` at line 192 of `writer.ts`; `surgicalFields` filtered by `changedSet` at line 240 of `pipeline.ts` |

**Score:** 11/11 truths verified

---

### Required Artifacts

#### Plan 01 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/db/migrations.ts` | `migrateToV8` function creating fields table | VERIFIED | Function exists lines 261-283; called in `runMigrations` at line 49; full table schema with 11 columns and 5 indexes |
| `src/db/schema.ts` | `SCHEMA_VERSION = 8` | VERIFIED | Line 6: `export const SCHEMA_VERSION = 8;` |
| `src/indexer/writer.ts` | `FieldData` interface exported | VERIFIED | Lines 15-24: exported `FieldData` interface with correct union discriminant; `RepoData.fields?: FieldData[]` at line 33 |
| `src/indexer/elixir.ts` | `extractRequiredFields` exported; `requiredFields` on `ElixirModule` | VERIFIED | `requiredFields: string[]` on interface line 15; `export function extractRequiredFields` at line 280 |
| `src/indexer/proto.ts` | `optional: boolean` on `ProtoField` | VERIFIED | Line 7: `optional: boolean` in `ProtoField` interface |
| `src/indexer/graphql.ts` | `parseGraphqlFields` and `GraphqlField` exported | VERIFIED | `GraphqlField` interface lines 12-15; `parseGraphqlFields` function lines 102-109, both exported |
| `tests/indexer/fields.test.ts` | Unit tests for all three extractors | VERIFIED | 255-line file with 3 describe blocks: Elixir (7 tests), Proto optional (5 tests), GraphQL field parsing (9 tests) — 21 tests total |

#### Plan 02 Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/indexer/pipeline.ts` | Field mapping from all three extractors to `FieldData[]` | VERIFIED | Lines 181-223: `ectoFields`, `protoFields`, `graphqlFields` arrays built and combined; `fields: FieldData[]` on `ExtractedRepoData` interface line 71; `surgicalFields?: FieldData[]` line 76 |
| `src/indexer/writer.ts` | Field insert + cleanup in both persist paths | VERIFIED | `persistRepoData` inserts fields lines 354-387; `persistSurgicalData` inserts fields lines 487-519; `clearRepoEntities` deletes fields line 125,143; `clearRepoFiles` deletes by source file line 163,192 |

---

### Key Link Verification

#### Plan 01 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/indexer/elixir.ts` | `ElixirModule` | `requiredFields: string[]` property | VERIFIED | Line 15: `requiredFields: string[];` in `ElixirModule` interface; populated at line 93 |
| `src/indexer/proto.ts` | `ProtoField` | `optional: boolean` property | VERIFIED | Line 7: `optional: boolean;` in `ProtoField` interface; set at line 129 |

#### Plan 02 Key Links

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/indexer/pipeline.ts` | `src/indexer/writer.ts` | `FieldData[]` passed through `RepoData.fields` and `persistSurgicalData` | VERIFIED | `fields: extracted.fields` passed to `persistRepoData` at line 336; `fields: extracted.surgicalFields ?? []` passed to `persistSurgicalData` at line 307 |
| `src/indexer/writer.ts` | fields table | `INSERT INTO fields` in `persistRepoData` and `persistSurgicalData` | VERIFIED | `INSERT INTO fields` at lines 356-359 (full) and 489-492 (surgical) |
| `src/indexer/writer.ts` | fields table | `DELETE FROM fields` in `clearRepoEntities` and `clearRepoFiles` | VERIFIED | `DELETE FROM fields WHERE repo_id = ?` at line 125; `DELETE FROM fields WHERE repo_id = ? AND source_file = ?` at line 163 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FLD-01 | 29-01, 29-02 | Ecto schema `field/3` calls extracted as individual searchable field entities | SATISFIED | Ecto fields mapped from `ElixirModule.schemaFields` in pipeline; stored with `parentType='ecto_schema'` |
| FLD-02 | 29-01, 29-02 | Proto message field declarations extracted as individual searchable field entities | SATISFIED | Proto fields mapped from `ProtoDefinition.messages[].fields` in pipeline; stored with `parentType='proto_message'` |
| FLD-03 | 29-01, 29-02 | GraphQL type field definitions extracted as individual searchable field entities | SATISFIED | GraphQL fields mapped via `parseGraphqlFields(t.body)` for type/input/interface kinds; stored with `parentType='graphql_type'` |
| FLD-04 | 29-01 | `fields` table created via migration with required columns | SATISFIED | V8 migration creates table with all 11 columns: `parent_type`, `parent_name`, `field_name`, `field_type`, `nullable`, `source_file`, `repo_id`, `module_id`, `event_id`, `id`, `created_at` |
| NULL-01 | 29-01, 29-02 | Ecto `validate_required` fields nullable=false; other cast fields nullable=true | SATISFIED | `nullable: !mod.requiredFields.includes(f.name)` in pipeline; pipeline test "validate_required fields get nullable=false" passes |
| NULL-02 | 29-01, 29-02 | Proto `optional` keyword marks nullable=true; plain fields nullable=false | SATISFIED | `nullable: f.optional` in pipeline; proto test "marks optional keyword fields as optional: true" passes |

No orphaned requirements — all 6 IDs (FLD-01, FLD-02, FLD-03, FLD-04, NULL-01, NULL-02) claimed by both plans and verified.

---

### Anti-Patterns Found

None. Scanned `src/indexer/elixir.ts`, `src/indexer/proto.ts`, `src/indexer/graphql.ts`, `src/indexer/writer.ts`, `src/indexer/pipeline.ts`, `src/db/migrations.ts`, `src/db/schema.ts` for TODO/FIXME/placeholder/empty implementations. No issues found.

---

### Human Verification Required

None. All phase 29 behaviors are verifiable programmatically (schema creation, field extraction logic, persistence, test coverage).

---

### Test Results

Full test suite: **753 tests pass, 0 failures** across 44 test files.

Phase-specific tests:
- `tests/db/schema.test.ts` — includes 6 V8 migration tests (fresh DB columns, v7->v8 incremental, indexes, cascade, version assertion)
- `tests/indexer/fields.test.ts` — 21 unit tests covering all three extractor enhancements
- `tests/indexer/writer.test.ts` — 8 field persistence tests under "field persistence" describe block
- `tests/indexer/pipeline.test.ts` — 6 integration tests under "field extraction mapping" describe block

---

### Gaps Summary

No gaps. Phase goal is fully achieved: all three extractors (Elixir, proto, GraphQL) produce field-level data with nullability metadata, the V8 migration creates the backing fields table with correct schema, and the pipeline end-to-end wires extraction through to persistence for both full and surgical indexing modes.

---

_Verified: 2026-03-10T14:05:00Z_
_Verifier: Claude (gsd-verifier)_
