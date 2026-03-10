# Phase 30: Field Search & Shared Concepts - Research

**Researched:** 2026-03-10
**Domain:** FTS5 field indexing, search/entity integration, cross-repo aggregation
**Confidence:** HIGH

## Summary

Phase 30 bridges the gap between Phase 29's field extraction (fields are stored in the DB but invisible to search) and user-facing discovery. The fields table has rows with field_name, parent_type, parent_name, field_type, nullable, repo_id, module_id, and event_id -- but none of this data flows into the `knowledge_fts` FTS5 table, the `EntityType` union, or any search/entity query path.

The work decomposes into two clean layers: (1) FTS indexing of fields during persist so `kb_search` finds them, and (2) direct SQL queries on the `fields` table for entity cards and shared concept detection. The existing tokenizer already handles underscore-separated compound names correctly (`employee_id` -> `employee id`), so FSRCH-02's token matching requirement is satisfied for free once fields enter FTS.

**Primary recommendation:** Add `'field'` to EntityType, index fields into FTS during persist with composite type `field:{parentType}`, extend the entity hydrator and findEntity to query the fields table, and add a shared concepts SQL query (GROUP BY field_name HAVING COUNT(DISTINCT repo_id) >= 2).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FSRCH-01 | `kb_search "<field_name>"` returns every schema/proto/GraphQL type containing a field with that name | Fields must be indexed into knowledge_fts via `indexEntity()` during persistRepoData/persistSurgicalData. Entity hydrator needs `field` case. |
| FSRCH-02 | Field names indexed as both tokenized and literal (exact compound + individual tokens) | Already handled: `tokenizeForFts('employee_id')` produces `"employee id"`, which FTS5 matches on both "employee_id" (full) and "employee" (token). No additional work needed beyond indexing fields into FTS. |
| FSRCH-03 | `kb_search --type field` filters results to field entities only | Add `'field'` to `COARSE_TYPES` in fts.ts so `resolveTypeFilter('field')` produces `field:%` LIKE pattern. |
| SHARED-01 | Post-indexing pass identifies field names in 2+ repos with cross-repo occurrence counts | SQL aggregation query: `SELECT field_name, COUNT(DISTINCT repo_id) FROM fields GROUP BY field_name HAVING COUNT(DISTINCT repo_id) >= 2`. Can be computed at query time (no materialization needed). |
| SHARED-02 | `kb_entity "<field_name>" --type field` shows all repos/parents/types/nullability | Custom query joining fields + repos tables, grouped by field_name. Returns richer card than standard EntityCard with per-occurrence details. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | (existing) | SQLite access | Already the DB driver throughout |
| FTS5 | (SQLite built-in) | Full-text search | Already used via knowledge_fts table |
| vitest | (existing) | Testing | Already configured in vitest.config.ts |

### Supporting
No new libraries needed. All work uses existing infrastructure.

## Architecture Patterns

### Current Architecture (What Exists)

```
Extractors (elixir/proto/graphql)
  -> pipeline.ts maps to FieldData[]
  -> writer.ts persists to `fields` table
  -> (DEAD END: fields never enter FTS or search paths)
```

### Target Architecture (What Phase 30 Builds)

```
Extractors -> pipeline.ts -> writer.ts
  |-> persists to `fields` table (existing)
  |-> NEW: calls indexEntity() for each field -> knowledge_fts
                                                      |
  kb_search "employee_id" ----> FTS5 MATCH ------->--+
  kb_search --type field -----> FTS5 MATCH + field:% filter
  kb_entity "employee_id" --type field
    |-> findExact checks fields table directly
    |-> returns FieldEntityCard with per-repo occurrences
    |-> includes shared concept count (repos with this field)
```

### Pattern 1: FTS Field Indexing (in writer.ts)

**What:** After inserting each field row, call `indexEntity()` with type `'field'`, subType = parentType, name = fieldName, description = contextual string.

**When to use:** During persistRepoData and persistSurgicalData, after the field INSERT loop.

**Key design decisions:**

1. **FTS name column**: Store the raw `field_name` (not tokenized -- `indexEntity` already calls `tokenizeForFts`). This means `employee_id` becomes `employee id` in FTS, satisfying FSRCH-02.

2. **FTS description column**: Include parent context for richer search: `"{parentName} {fieldType} {nullable ? 'nullable' : 'required'}"`. This way searching for the parent module name also surfaces its fields.

3. **FTS entity_type**: Use `field:{parentType}` composite format (e.g., `field:ecto_schema`, `field:proto_message`, `field:graphql_type`). This enables both coarse `--type field` filtering and granular `--type ecto_schema` filtering on fields.

4. **FTS entity_id**: Use the `fields.id` (auto-increment PK from the INSERT).

### Pattern 2: Entity Hydrator Extension

**What:** Add a `'field'` case to `createEntityHydrator()` in entity.ts that queries the fields table joined with repos.

**Key:** The hydrator returns `EntityInfo` (id, name, repoName, repoPath, filePath, description). For fields, map: name = field_name, repoName from repos join, filePath = source_file, description = "{parentType} {parentName}.{fieldName}: {fieldType} ({nullable/required})".

### Pattern 3: Field Entity Card (for kb_entity --type field)

**What:** A specialized query path in `findEntity` for type=field that returns all occurrences of a field name across repos.

**Key difference from standard entity cards:** A field name like `employee_id` may appear in 10+ repos with different parent types and nullability. The entity card must aggregate these, not return a single entity.

**Query pattern:**
```sql
SELECT f.field_name, f.parent_type, f.parent_name, f.field_type, f.nullable,
       f.source_file, r.name as repo_name, r.path as repo_path
FROM fields f
JOIN repos r ON f.repo_id = r.id
WHERE f.field_name = ?
ORDER BY r.name, f.parent_type, f.parent_name
```

### Pattern 4: Shared Concept Detection (query-time, not materialized)

**What:** When showing a field entity card, include the cross-repo count. No need for a separate "shared_concepts" table -- the fields table already has all the data.

**Query:**
```sql
SELECT COUNT(DISTINCT repo_id) as repo_count FROM fields WHERE field_name = ?
```

If repo_count >= 2, mark as shared concept in the entity card output.

For listing all shared concepts:
```sql
SELECT field_name, COUNT(DISTINCT repo_id) as repo_count,
       GROUP_CONCAT(DISTINCT r.name) as repos
FROM fields f JOIN repos r ON f.repo_id = r.id
GROUP BY field_name
HAVING COUNT(DISTINCT repo_id) >= 2
ORDER BY repo_count DESC
```

### Anti-Patterns to Avoid

- **Creating a separate shared_concepts table:** Unnecessary materialization. The `fields` table with `GROUP BY field_name HAVING COUNT(DISTINCT repo_id) >= 2` gives shared concepts at query time. No sync issues.
- **Indexing field_name + parent_name as the FTS name:** Would break type filtering. The FTS name should be the field_name alone; parent context goes in description.
- **One FTS entry per unique field_name (deduped):** Won't work -- FTS entity_id must point to a specific fields.id row for hydration. Each field occurrence needs its own FTS entry.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Field FTS indexing | Custom FTS INSERT logic | Existing `indexEntity()` from fts.ts | Already handles tokenization, composite types, upsert semantics |
| Type filtering for fields | Custom WHERE clause | Existing `resolveTypeFilter()` + `COARSE_TYPES.add('field')` | Already handles coarse vs granular type resolution |
| FTS query execution | Raw SQL with error handling | Existing `executeFtsWithFallback()` | Already handles FTS syntax errors and phrase fallback |

## Common Pitfalls

### Pitfall 1: FTS Cleanup on Re-index
**What goes wrong:** Fields get duplicated in FTS on re-index because `clearRepoEntities` removes FTS entries by type+id but field FTS entries aren't cleaned.
**Why it happens:** `clearRepoEntities` has explicit loops for module, event, service FTS cleanup but no field loop.
**How to avoid:** Add field FTS cleanup to `clearRepoEntities`: select all field IDs for the repo, then delete FTS entries with `field:%` prefix pattern. Same pattern as existing module/event/service cleanup.
**Warning signs:** Running `kb index --force` on a repo doubles the field count in `kb_search`.

### Pitfall 2: Surgical Mode FTS Cleanup
**What goes wrong:** Surgical re-index doesn't clean up FTS entries for fields in changed files.
**Why it happens:** `clearRepoFiles` deletes field rows by (repo_id, source_file) but doesn't remove corresponding FTS entries first.
**How to avoid:** Before `deleteFieldsByFile.run()`, query field IDs for that file and delete their FTS entries. Follow the same pattern as modules/events cleanup in clearRepoFiles.
**Warning signs:** Surgical re-index leaves stale field FTS entries.

### Pitfall 3: EntityType Union Not Updated
**What goes wrong:** TypeScript compilation succeeds but runtime switch cases miss 'field', returning null.
**Why it happens:** `EntityType` is a string union, adding 'field' to it doesn't force exhaustive handling in switch statements.
**How to avoid:** Add `'field'` to the EntityType union AND add explicit `case 'field'` in every switch: createEntityHydrator, getEntitiesByExactName, name resolution stmts in createRelationshipLookup.
**Warning signs:** `kb_entity "employee_id" --type field` returns empty results even though search finds them.

### Pitfall 4: FTS Entry Per Field Row vs Per Unique Name
**What goes wrong:** If you try to deduplicate fields in FTS (one entry per unique field_name), the entity_id has no clear target and hydration breaks.
**Why it happens:** FTS entity_id must resolve to a single row for the hydrator to work.
**How to avoid:** One FTS entry per fields.id row. The search results will show multiple hits for popular field names -- that's correct and expected. Dedup, if wanted, happens at the display layer.

### Pitfall 5: Field FTS Description Too Long
**What goes wrong:** If description includes full schema definition, FTS bloats and searches return noisy results.
**Why it happens:** Stuffing too much context into the FTS description column.
**How to avoid:** Keep description concise: `"{parentName} {fieldType}"`. Don't include the field body, schema block, or other fields.

## Code Examples

### Adding 'field' to EntityType (src/types/entities.ts)
```typescript
// Before:
export type EntityType = 'repo' | 'file' | 'module' | 'service' | 'event' | 'learned_fact';

// After:
export type EntityType = 'repo' | 'file' | 'module' | 'service' | 'event' | 'learned_fact' | 'field';
```

### Adding 'field' to COARSE_TYPES (src/db/fts.ts)
```typescript
// Before:
export const COARSE_TYPES = new Set(['repo', 'file', 'module', 'service', 'event', 'learned_fact']);

// After:
export const COARSE_TYPES = new Set(['repo', 'file', 'module', 'service', 'event', 'learned_fact', 'field']);
```

### Indexing Fields into FTS (in writer.ts persistRepoData, after field INSERT)
```typescript
// After insertField.run(...), capture the lastInsertRowid:
const fieldInfo = insertField.run(
  repoId, field.parentType, field.parentName, field.fieldName,
  field.fieldType, field.nullable ? 1 : 0, field.sourceFile, moduleId, eventId,
);
const fieldId = Number(fieldInfo.lastInsertRowid);

indexEntity(db, {
  type: 'field' as EntityType,
  id: fieldId,
  name: field.fieldName,
  description: `${field.parentName} ${field.fieldType}`,
  subType: field.parentType,
});
```

### Field FTS Cleanup in clearRepoEntities (writer.ts)
```typescript
// Add alongside existing selectModules/selectEvents/selectServices:
const selectFields = db.prepare('SELECT id FROM fields WHERE repo_id = ?');

// Add alongside existing clearEntityFts calls:
clearEntityFts(selectFields, deleteFts, 'field:%', repoId);
```

### Field FTS Cleanup in clearRepoFiles (writer.ts)
```typescript
// Before deleteFieldsByFile.run(), add:
const selectFieldsByFile = db.prepare('SELECT id FROM fields WHERE repo_id = ? AND source_file = ?');

// In the loop, before deleteFieldsByFile:
const fieldIds = selectFieldsByFile.all(repoId, filePath) as { id: number }[];
for (const f of fieldIds) {
  deleteFts.run('field:%', f.id);
}
```

### Field Hydrator Case (entity.ts createEntityHydrator)
```typescript
case 'field': {
  const row = stmts.field.get(entityId) as {
    id: number; field_name: string; parent_type: string; parent_name: string;
    field_type: string; nullable: number; source_file: string | null;
    repo_name: string; repo_path: string;
  } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.field_name,
    repoName: row.repo_name,
    repoPath: row.repo_path,
    filePath: row.source_file,
    description: `${row.parent_name} ${row.field_type} ${row.nullable ? 'nullable' : 'required'}`,
  };
}
```

With prepared statement:
```typescript
field: db.prepare(
  `SELECT f.id, f.field_name, f.parent_type, f.parent_name, f.field_type,
          f.nullable, f.source_file, r.name as repo_name, r.path as repo_path
   FROM fields f JOIN repos r ON f.repo_id = r.id
   WHERE f.id = ?`
),
```

### Field Entity Card Query (for SHARED-02)
```typescript
function findFieldEntity(
  db: Database.Database,
  fieldName: string,
  repoFilter?: string,
): FieldEntityCard {
  let sql = `
    SELECT f.field_name, f.parent_type, f.parent_name, f.field_type,
           f.nullable, f.source_file, r.name as repo_name
    FROM fields f JOIN repos r ON f.repo_id = r.id
    WHERE f.field_name = ?
  `;
  const params: string[] = [fieldName];
  if (repoFilter) {
    sql += ' AND r.name = ?';
    params.push(repoFilter);
  }
  sql += ' ORDER BY r.name, f.parent_type, f.parent_name';

  const rows = db.prepare(sql).all(...params);

  const repoCount = db.prepare(
    'SELECT COUNT(DISTINCT repo_id) as cnt FROM fields WHERE field_name = ?'
  ).get(fieldName) as { cnt: number };

  return {
    fieldName,
    occurrences: rows,
    repoCount: repoCount.cnt,
    isSharedConcept: repoCount.cnt >= 2,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fields not searchable | Fields in DB but not in FTS | Phase 29 (just completed) | This phase adds the FTS bridge |
| No field entity type | EntityType = 6 types | Original v1.0 | Adding 7th type ('field') is the core change |
| No cross-repo field analysis | fields table has repo_id FK | Phase 29 V8 migration | Simple GROUP BY gives shared concepts |

## Open Questions

1. **Should field entity cards use the existing EntityCard interface or a new FieldEntityCard?**
   - What we know: EntityCard has {name, type, repoName, filePath, description, relationships}. A field card needs multiple occurrences per field name with per-occurrence parent/type/nullable info.
   - What's unclear: Whether to extend EntityCard with optional extra fields or create a separate interface.
   - Recommendation: Create a dedicated FieldEntityCard interface returned only when type=field. The standard EntityCard doesn't fit well -- a field named "employee_id" has N occurrences across repos, not one entity with relationships.

2. **Should shared concept data be included in the field entity card or exposed as a separate query?**
   - What we know: SHARED-02 says `kb_entity "employee_id" --type field` should show cross-repo data. SHARED-01 says shared concepts should be identified post-indexing.
   - What's unclear: Whether SHARED-01 requires a separate "shared concepts" API endpoint or just means the data is available.
   - Recommendation: Include shared concept count directly in the field entity card response. No separate endpoint needed -- the success criteria says "field names appearing in 2+ repos are identified as shared concepts with cross-repo occurrence counts", which can be a computed property on the card.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run --reporter=verbose` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FSRCH-01 | kb_search returns fields from all repos/parent types | integration | `npx vitest run tests/search/text.test.ts -x` | Needs field-specific tests |
| FSRCH-02 | Compound name + individual token matching | unit | `npx vitest run tests/db/fts.test.ts -x` | Needs field tokenization tests |
| FSRCH-03 | --type field filters to field entities only | integration | `npx vitest run tests/search/text.test.ts -x` | Needs field type filter tests |
| SHARED-01 | Shared concepts identified with cross-repo counts | unit | `npx vitest run tests/search/entity.test.ts -x` | Needs new tests |
| SHARED-02 | kb_entity shows all repos/parents/types/nullability for a field | integration | `npx vitest run tests/search/entity.test.ts -x` | Needs new tests |

### Sampling Rate
- **Per task commit:** `npx vitest run -x`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] Field-specific test cases in `tests/search/text.test.ts` -- field FTS search, type filtering
- [ ] Field-specific test cases in `tests/search/entity.test.ts` -- field entity cards, shared concepts
- [ ] Field FTS cleanup tests in `tests/indexer/writer.test.ts` -- clearRepoEntities/clearRepoFiles with field FTS

## Sources

### Primary (HIGH confidence)
- Direct code analysis of `src/db/fts.ts` -- FTS5 table schema, indexEntity(), COARSE_TYPES, resolveTypeFilter()
- Direct code analysis of `src/db/tokenizer.ts` -- tokenizeForFts() converts `employee_id` to `employee id`
- Direct code analysis of `src/indexer/writer.ts` -- persistRepoData field INSERT loop, clearRepoEntities, clearRepoFiles
- Direct code analysis of `src/search/entity.ts` -- createEntityHydrator switch, findExact, findByFts
- Direct code analysis of `src/search/text.ts` -- searchText pipeline, FTS query construction
- Direct code analysis of `src/types/entities.ts` -- EntityType union (6 types, no 'field')
- Direct code analysis of `src/mcp/tools/search.ts` and `src/mcp/tools/entity.ts` -- MCP tool registration
- Direct code analysis of `src/cli/commands/search.ts` -- CLI search with --type and --entity flags
- Direct code analysis of `src/db/migrations.ts` -- V8 migration fields table schema with indexes

### Secondary (MEDIUM confidence)
- Phase 29 summaries (29-01-SUMMARY.md, 29-02-SUMMARY.md) -- confirmed fields table schema, FieldData interface, persist wiring

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, all existing infrastructure
- Architecture: HIGH - direct code reading, patterns follow existing module/event/service precedent
- Pitfalls: HIGH - derived from reading actual cleanup code and identifying gaps

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable, internal project)
