---
phase: 30-field-search-shared-concepts
verified: 2026-03-10T14:32:00Z
status: passed
score: 9/9 must-haves verified
re_verification: false
---

# Phase 30: Field Search & Shared Concepts Verification Report

**Phase Goal:** Users can search for any field name across the entire indexed codebase and discover which field names are shared data contracts across multiple repos
**Verified:** 2026-03-10T14:32:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                              | Status     | Evidence                                                                                       |
|----|------------------------------------------------------------------------------------|------------|-----------------------------------------------------------------------------------------------|
| 1  | kb_search 'employee_id' returns field entities from FTS                            | VERIFIED   | `searchText("employee_id") returns results with entityType "field"` test passes               |
| 2  | kb_search 'employee' also returns employee_id fields (token matching)              | VERIFIED   | `searchText("employee") also returns employee_id field results` test passes                   |
| 3  | kb_search --type field filters to field entities only                              | VERIFIED   | `searchText with entityTypeFilter "field" returns only field results` test passes             |
| 4  | Re-indexing a repo does not duplicate field FTS entries                            | VERIFIED   | `re-indexing (persistRepoData twice) does not duplicate field FTS entries` test passes        |
| 5  | Surgical re-index cleans up stale field FTS entries                                | VERIFIED   | `clearRepoFiles removes field FTS entries before deleting field rows for changed files` passes|
| 6  | kb_entity 'employee_id' --type field shows all repos containing that field         | VERIFIED   | `findEntity("employee_id", { type: "field" })` case in getEntitiesByExactName; 7 tests pass  |
| 7  | Field entity card shows parent type, parent name, field type, and nullability      | VERIFIED   | Description format `${parent_type} ${parent_name}.${name}: ${field_type} (nullable/required)`|
| 8  | Field entity card includes shared concept flag when field appears in 2+ repos      | VERIFIED   | `[shared across N repos]` prefix applied when repoCount >= 2; test confirms                  |
| 9  | Field appearing in only 1 repo is NOT marked as shared concept                    | VERIFIED   | `field in only 1 repo does NOT include shared in description` test passes                    |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact                        | Expected                                              | Status     | Details                                                               |
|---------------------------------|-------------------------------------------------------|------------|-----------------------------------------------------------------------|
| `src/types/entities.ts`         | EntityType union with 'field'                         | VERIFIED   | Line 66: `'repo' \| 'file' \| 'module' \| 'service' \| 'event' \| 'learned_fact' \| 'field'` |
| `src/db/fts.ts`                 | COARSE_TYPES with 'field'                             | VERIFIED   | Line 15: `new Set([..., 'field'])` confirmed                         |
| `src/indexer/writer.ts`         | Field FTS indexing in both persist paths + cleanup    | VERIFIED   | Lines 396-403 (persistRepoData) and 537-544 (persistSurgicalData) call `indexEntity` with `type: 'field'`; clearRepoEntities line 132 and clearRepoFiles lines 195-198 handle FTS cleanup |
| `src/search/entity.ts`          | Field hydrator case + getEntitiesByExactName 'field'  | VERIFIED   | hydrator `case 'field'` at line 203; getEntitiesByExactName `case 'field'` at line 440; default types includes 'field' at line 94 |
| `src/search/types.ts`           | FieldOccurrence interface                             | VERIFIED   | Lines 54-62: `FieldOccurrence` interface defined                     |
| `tests/indexer/writer.test.ts`  | Field FTS indexing/cleanup/dedup tests                | VERIFIED   | 16 field-specific tests all pass (under `field persistence` describe) |
| `tests/search/text.test.ts`     | Field search integration tests                        | VERIFIED   | 5 tests under `field search` describe, all pass                      |
| `tests/search/entity.test.ts`   | Field entity card and shared concept tests            | VERIFIED   | 7 tests under `field entity cards` describe, all pass                |

### Key Link Verification

| From                       | To                   | Via                                                  | Status   | Details                                                                                    |
|----------------------------|----------------------|------------------------------------------------------|----------|-------------------------------------------------------------------------------------------|
| `src/indexer/writer.ts`    | `src/db/fts.ts`      | indexEntity() call after field INSERT                | WIRED    | `indexEntity(db, { type: 'field' as EntityType, id: fieldId, ... })` in both persist paths|
| `src/search/entity.ts`     | `fields` table       | Hydrator prepared statement joining fields + repos   | WIRED    | `FROM fields f JOIN repos r ON f.repo_id = r.id WHERE f.id = ?` in `stmts.field`          |
| `src/search/entity.ts`     | `fields` table       | getEntitiesByExactName field case joining fields + repos | WIRED | `SELECT ... FROM fields f JOIN repos r ON f.repo_id = r.id WHERE f.field_name = ?`       |
| `src/db/fts.ts`            | `knowledge_fts`      | resolveTypeFilter('field') returns field:% pattern   | WIRED    | COARSE_TYPES.has('field') → `{ sql: 'entity_type LIKE ?', param: 'field:%' }`            |
| `findExact` (entity.ts)    | shared concept logic | Post-query card decoration counting distinct repos   | WIRED    | Lines 116-124: enrich field cards when repoCount >= 2                                     |

### Requirements Coverage

| Requirement | Source Plan | Description                                                                                 | Status    | Evidence                                                                         |
|-------------|-------------|---------------------------------------------------------------------------------------------|-----------|----------------------------------------------------------------------------------|
| FSRCH-01    | 30-01       | kb_search "<field_name>" returns every schema/proto/GraphQL type containing that field      | SATISFIED | searchText returns `entityType: 'field'` results; 91/91 tests pass              |
| FSRCH-02    | 30-01       | Field names indexed as tokenized and literal (compound name + token matching)               | SATISFIED | `searchText("employee")` finds `employee_id` via FTS5 unicode61 tokenizer        |
| FSRCH-03    | 30-01       | kb_search --type field filters results to field entities only                               | SATISFIED | entityTypeFilter='field' → resolveTypeFilter → `entity_type LIKE 'field:%'`      |
| SHARED-01   | 30-02       | Post-indexing identifies field names in 2+ repos, stores cross-repo occurrence count        | SATISFIED | findExact enriches field cards with `[shared across N repos]` when repoCount >= 2|
| SHARED-02   | 30-02       | kb_entity "<field_name>" --type field shows all repos/schemas/protos with parent + nullable  | SATISFIED | getEntitiesByExactName 'field' case returns per-occurrence EntityCard[]          |

No orphaned requirements — all 5 IDs declared in plan frontmatter are accounted for and marked complete in REQUIREMENTS.md.

### Anti-Patterns Found

None. All modified files are free of TODO/FIXME/placeholder comments, empty implementations, and stub handlers.

### Human Verification Required

None required. All observable behaviors are covered by automated tests:
- FTS indexing verified via direct SQL queries on knowledge_fts table
- Token matching verified via searchText assertions
- Shared concept detection verified via description string assertions
- Type filtering verified via entityTypeFilter assertions

## Test Suite Status

- 3 target test files: 91/91 tests pass
- Full suite: 772/772 tests pass
- All 5 documented commits verified in git log: `daf9743`, `faa9703`, `90b20b3`, `128c8e8`, `5fca223`

---

_Verified: 2026-03-10T14:32:00Z_
_Verifier: Claude (gsd-verifier)_
