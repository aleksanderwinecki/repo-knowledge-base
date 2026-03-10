# Phase 29: Field Extraction & Schema - Research

**Researched:** 2026-03-10
**Domain:** SQLite schema migration, regex-based field extraction (Elixir/proto/GraphQL), nullability inference
**Confidence:** HIGH

## Summary

Phase 29 creates a new `fields` table and populates it during indexing by extracting individual field declarations from three source types: Ecto `schema` blocks, protobuf message definitions, and GraphQL SDL type definitions. The existing extractors already parse these files and return structured field data -- the gap is that fields are stored as JSON blobs (`modules.schema_fields`) or embedded in text (`events.schema_definition`) rather than as individual searchable rows.

The work divides cleanly into three layers: (1) schema migration to create the `fields` table, (2) enhancement of the three extractors to return nullability metadata alongside existing field data, (3) persistence changes in the writer and pipeline to insert field rows during indexing. No new regex parsing is needed for basic field extraction -- the existing `extractSchemaDetails`, `extractFields`, and `parseGraphqlFile` already produce structured field arrays. The new work is: adding nullability inference to Elixir and proto extractors, adding field parsing to the GraphQL extractor (which currently stores body text without parsing individual fields), and wiring field persistence into the writer.

**Primary recommendation:** Add V8 migration for the `fields` table, extend existing extractors with nullability metadata, add `FieldData[]` to `RepoData`/`ExtractedRepoData`, and persist fields in `persistRepoData`/`persistSurgicalData` alongside existing module/event persistence.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FLD-01 | Ecto schema `field/3` calls extracted as individual searchable field entities | Existing `extractSchemaDetails` already returns `{ name, type }[]` -- extend to yield `FieldData[]` with parent info |
| FLD-02 | Proto message fields extracted as individual searchable field entities | Existing `extractFields` already returns `ProtoField[]` -- map to `FieldData[]` in pipeline |
| FLD-03 | GraphQL type fields extracted as individual searchable field entities | New: parse `GraphqlType.body` string into `{ name, type }[]` (regex on `fieldName: FieldType` pattern) |
| FLD-04 | `fields` table created with required columns | V8 migration: parent_type, parent_name, field_name, field_type, nullable, source_file, repo_id, module_id, event_id |
| NULL-01 | Ecto `validate_required` fields marked nullable=false; other cast fields nullable=true | New: extract `validate_required(changeset, [:field1, :field2])` from module content |
| NULL-02 | Proto `optional` keyword marks nullable=true; plain fields nullable=false | Extend proto `extractFields` regex to capture `optional` prefix |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.0.0 | SQLite database (sync API) | Already used; all DB ops are sync |
| vitest | (dev) | Test framework | Already used; 711 tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none new) | - | - | All work uses existing deps |

**No new dependencies needed.** This phase extends existing extractors and the existing migration/writer pattern.

## Architecture Patterns

### Existing Pattern: Migration Chain
The codebase uses a linear migration chain in `src/db/migrations.ts`. Currently at V7 (SCHEMA_VERSION=7). Each migration is a function `migrateToVN` called conditionally based on version comparison. The `fields` table requires V8.

**Pattern to follow:**
```typescript
// In migrations.ts: add migrateToV8
if (fromVersion < 8 && toVersion >= 8) {
  migrateToV8(db);
}

function migrateToV8(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fields (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
      parent_type TEXT NOT NULL,
      parent_name TEXT NOT NULL,
      field_name TEXT NOT NULL,
      field_type TEXT NOT NULL,
      nullable INTEGER NOT NULL DEFAULT 1,
      source_file TEXT,
      module_id INTEGER REFERENCES modules(id) ON DELETE SET NULL,
      event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_fields_repo ON fields(repo_id);
    CREATE INDEX IF NOT EXISTS idx_fields_name ON fields(field_name);
    CREATE INDEX IF NOT EXISTS idx_fields_parent ON fields(parent_type, parent_name);
    CREATE INDEX IF NOT EXISTS idx_fields_module ON fields(module_id);
    CREATE INDEX IF NOT EXISTS idx_fields_event ON fields(event_id);
  `);
}
```

**Key design decisions for the fields table:**
- `parent_type` is an enum-like TEXT: `'ecto_schema'`, `'proto_message'`, `'graphql_type'`
- `nullable` is INTEGER (SQLite boolean: 0=not-null/required, 1=nullable) -- matches SQLite convention
- `module_id` links Ecto/GraphQL fields back to their parent module row
- `event_id` links proto fields back to their parent event (proto message) row
- Both FKs use SET NULL on delete so field cleanup is handled by repo_id cascade
- Increment SCHEMA_VERSION to 8 in `src/db/schema.ts`

### Existing Pattern: Extractor -> Pipeline -> Writer
Data flows: extractor produces typed data -> pipeline maps it to writer format -> writer persists in a transaction.

**Elixir flow:**
1. `extractElixirModules` -> `ElixirModule[]` (already has `schemaFields: { name, type }[]`)
2. Pipeline maps to `ModuleData[]` (stores `schemaFields` as JSON string)
3. Writer inserts into `modules` table

**Proto flow:**
1. `extractProtoDefinitions` -> `ProtoDefinition[]` (already has `messages[].fields: ProtoField[]`)
2. Pipeline maps to `EventData[]` (embeds fields in `schemaDefinition` string)
3. Writer inserts into `events` table

**GraphQL flow:**
1. `extractGraphqlDefinitions` -> `GraphqlDefinition[]` (has `types[].body: string`)
2. Pipeline maps to `ModuleData[]` (stores body as summary)
3. Writer inserts into `modules` table

**New field flow (all three):**
1. Extractors return field data with nullability (extend existing interfaces)
2. Pipeline maps to `FieldData[]` (new interface)
3. Writer inserts into `fields` table within same transaction

### Existing Pattern: RepoData Interface
The `RepoData` interface in `writer.ts` collects all data for a repo. Add `fields?: FieldData[]` to it:

```typescript
export interface FieldData {
  parentType: 'ecto_schema' | 'proto_message' | 'graphql_type';
  parentName: string;
  fieldName: string;
  fieldType: string;
  nullable: boolean;
  sourceFile: string;
  // Resolved at write time:
  moduleId?: number | null;
  eventId?: number | null;
}
```

### Existing Pattern: Surgical vs Full Persist
Both `persistRepoData` (full) and `persistSurgicalData` (surgical) need field handling:
- **Full:** Clear all fields for repo, insert new ones
- **Surgical:** Clear fields from changed files, insert new ones from changed files

The writer's `clearRepoEntities` already clears modules/events/services/edges/files -- add fields cleanup there. Similarly, `clearRepoFiles` needs to clear fields from specific files.

### Recommended Project Structure (new/modified files)

```
src/
  db/
    migrations.ts      # Add migrateToV8
    schema.ts          # Bump SCHEMA_VERSION to 8
  indexer/
    elixir.ts          # Add validate_required extraction, return RequiredFields
    proto.ts           # Capture optional prefix in ProtoField
    graphql.ts         # Add parseGraphqlFields(body) -> GraphqlField[]
    writer.ts          # Add FieldData interface, field persistence
    pipeline.ts        # Map extractor output to FieldData[], add to RepoData
  types/
    entities.ts        # (optional) Add 'field' to EntityType if needed for Phase 30
tests/
  db/
    schema.test.ts     # V8 migration tests
  indexer/
    elixir.test.ts     # validate_required tests
    proto.test.ts      # optional keyword tests
    graphql.test.ts    # field parsing tests
    writer.test.ts     # field persistence tests
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Elixir AST parsing | tree-sitter or full parser | Regex on `validate_required` | Same approach as existing extractors; regex is 95% accurate for Elixir macro patterns |
| GraphQL SDL parsing | graphql-js parser | Regex on `fieldName: TypeName` | Consistent with existing approach; no new dependencies |
| Proto parsing | protobufjs | Regex on field declarations | Already working in proto.ts; just extend the regex |

**Key insight:** The project explicitly chose regex over AST parsing (see Out of Scope in REQUIREMENTS.md). All three source languages use clean, predictable syntax for field declarations. Stick with regex.

## Common Pitfalls

### Pitfall 1: Module/Event ID Resolution Timing
**What goes wrong:** Field rows need `module_id` and `event_id` foreign keys, but these IDs are only available after the parent module/event is inserted into the DB.
**Why it happens:** The current pipeline extracts data in parallel (no DB access), then persists serially. Fields need to reference rows that were just inserted.
**How to avoid:** Insert fields AFTER modules/events in the same transaction. Use `lastInsertRowid` or a lookup query to resolve parent IDs. The writer already does this for FTS indexing (gets `modId` from `insertModuleStmt.run()`).
**Warning signs:** NULL module_id/event_id on field rows that should have them.

### Pitfall 2: Ecto validate_required Scope
**What goes wrong:** `validate_required` appears in changeset functions, not in schema blocks. A module might have multiple changesets with different required fields.
**Why it happens:** Elixir Ecto pattern: `schema "table" do ... end` defines fields, but `def changeset(struct, attrs)` defines validations.
**How to avoid:** Extract ALL `validate_required` calls from the entire module content (not just the schema block). Union all required field atoms across all changesets. Any field mentioned in ANY `validate_required` call is non-nullable.
**Warning signs:** Missing required fields because only one changeset was parsed.

**Typical Elixir patterns to handle:**
```elixir
# Pattern 1: Simple
|> validate_required([:name, :email, :status])

# Pattern 2: Multi-line
|> validate_required([
  :name,
  :email,
  :status
])

# Pattern 3: Variable (skip -- can't resolve at static analysis)
|> validate_required(@required_fields)

# Pattern 4: cast then validate
|> cast(attrs, [:name, :email, :status, :bio])
|> validate_required([:name, :email])
# Result: name=required, email=required, status=nullable, bio=nullable
```

### Pitfall 3: Proto optional vs required vs plain
**What goes wrong:** Conflating proto2 and proto3 semantics.
**Why it happens:** In proto3, all fields are "optional" by default (have default values, can be unset). The explicit `optional` keyword in proto3 means the field has presence tracking (you can distinguish "not set" from "set to default").
**How to avoid:** Follow the requirement literally: `optional` keyword = nullable=true, plain field = nullable=false. Don't overthink proto2 vs proto3 semantics -- the regex already handles this: `(?:repeated\s+|optional\s+|required\s+)?`.
**Warning signs:** All proto fields marked as nullable because "proto3 fields are optional by default."

### Pitfall 4: GraphQL Non-Null (!) Syntax
**What goes wrong:** Missing the `!` suffix that indicates a non-null field in GraphQL.
**Why it happens:** GraphQL uses trailing `!` for non-null: `name: String!` means required, `name: String` means nullable.
**How to avoid:** The GraphQL field regex should capture the full type including `!`, `[...]`, and `[...]!`. For nullability: type ends with `!` (after stripping list wrappers) = non-null. Note: the requirements (FLD-03) don't explicitly require GraphQL nullability -- only NULL-01 (Ecto) and NULL-02 (proto) are in scope. But capturing the `!` in `field_type` is trivial and sets up for future use.
**Warning signs:** GraphQL field types stored without their `!` suffix.

### Pitfall 5: Surgical Persist Field Cleanup
**What goes wrong:** Fields from changed files not cleaned up before re-insertion, causing duplicates.
**Why it happens:** `clearRepoFiles` doesn't know about the fields table yet.
**How to avoid:** Add field cleanup to both `clearRepoEntities` and `clearRepoFiles`. Fields can be cleaned by `source_file` for surgical mode, or by `repo_id` for full mode.
**Warning signs:** Duplicate field rows after re-indexing.

### Pitfall 6: GraphQL Enum/Union/Scalar "Fields"
**What goes wrong:** Trying to extract fields from enum values, union members, or scalars.
**Why it happens:** The GraphQL parser extracts all type kinds including enums and scalars.
**How to avoid:** Only extract fields from `type`, `input`, and `interface` kinds. Skip `enum` (values, not fields), `union` (member list, not fields), and `scalar` (no body).
**Warning signs:** Enum values like "PENDING", "CONFIRMED" stored as field names.

## Code Examples

### Ecto validate_required Extraction
```typescript
// New function in elixir.ts
function extractRequiredFields(moduleContent: string): Set<string> {
  const required = new Set<string>();
  // Match validate_required(changeset, [:field1, :field2, ...])
  // Handles both inline and multi-line atom lists
  const re = /validate_required\s*\([^,]+,\s*\[([\s\S]*?)\]/g;
  let match;
  while ((match = re.exec(moduleContent)) !== null) {
    const atomList = match[1]!;
    const atomRe = /:(\w+)/g;
    let atomMatch;
    while ((atomMatch = atomRe.exec(atomList)) !== null) {
      required.add(atomMatch[1]!);
    }
  }
  return required;
}
```

### Proto Optional Field Detection
```typescript
// Updated regex in proto.ts extractFields
function extractFields(body: string): ProtoField[] {
  const fields: ProtoField[] = [];
  const fieldRe =
    /^\s+(repeated\s+|optional\s+|required\s+)?(\w[\w.]*)\s+(\w+)\s*=\s*\d+/gm;

  let match;
  while ((match = fieldRe.exec(body)) !== null) {
    const qualifier = match[1]?.trim();
    const type = match[2]!;
    if (['message', 'enum', 'oneof', 'reserved', 'option', 'extend'].includes(type)) {
      continue;
    }
    fields.push({
      type,
      name: match[3]!,
      optional: qualifier === 'optional',
    });
  }
  return fields;
}
```

### GraphQL Field Parsing
```typescript
// New function in graphql.ts
export interface GraphqlField {
  name: string;
  type: string;  // Includes !, [], [!], etc.
}

export function parseGraphqlFields(body: string): GraphqlField[] {
  const fields: GraphqlField[] = [];
  // Match: fieldName: TypeExpression (possibly with args)
  // Skip lines that are comments or enum values
  const fieldRe = /^\s*(\w+)(?:\([^)]*\))?\s*:\s*(\[?\w+!?\]?!?)/gm;
  let match;
  while ((match = fieldRe.exec(body)) !== null) {
    fields.push({ name: match[1]!, type: match[2]! });
  }
  return fields;
}
```

### Field Persistence in Writer
```typescript
// In persistRepoData, after module and event insertion:
if (data.fields) {
  const insertField = db.prepare(`
    INSERT INTO fields (repo_id, parent_type, parent_name, field_name, field_type,
                        nullable, source_file, module_id, event_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const field of data.fields) {
    insertField.run(
      repoId,
      field.parentType,
      field.parentName,
      field.fieldName,
      field.fieldType,
      field.nullable ? 1 : 0,
      field.sourceFile,
      field.moduleId ?? null,
      field.eventId ?? null,
    );
  }
}
```

### Pipeline Field Mapping (Elixir Example)
```typescript
// In extractRepoData, after mapping elixirModuleData:
const ectoFields: FieldData[] = elixirModules
  .filter(mod => mod.tableName) // Only Ecto schemas
  .flatMap(mod => {
    const required = extractRequiredFields(/* module content needed */);
    return mod.schemaFields.map(f => ({
      parentType: 'ecto_schema' as const,
      parentName: mod.name,
      fieldName: f.name,
      fieldType: f.type,
      nullable: !required.has(f.name),
      sourceFile: mod.filePath,
    }));
  });
```

**Important pipeline consideration:** The `extractRequiredFields` function needs access to the full module content, but `ElixirModule` doesn't currently store the raw content. Two options:
1. Add a `requiredFields: string[]` to `ElixirModule` (extracted during parsing)
2. Store raw content temporarily (wasteful for 400+ repos)

Option 1 is clearly better -- extract required fields during `parseElixirFile` alongside `schemaFields`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Fields as JSON blob on modules.schema_fields | Individual field rows in fields table | Phase 29 (now) | Fields become searchable, joinable, graphable |
| Proto fields embedded in events.schema_definition text | Individual field rows in fields table | Phase 29 (now) | Proto fields become first-class entities |
| GraphQL fields not stored at all | Individual field rows in fields table | Phase 29 (now) | GraphQL types gain field-level granularity |

**No deprecation needed:** The `modules.schema_fields` JSON column and `events.schema_definition` text can remain for backward compatibility (they're still useful for display). The new `fields` table supplements them.

## Open Questions

1. **Should `modules.schema_fields` JSON column still be populated?**
   - What we know: Phase 30 (search) will query the `fields` table directly. The JSON blob is redundant.
   - What's unclear: Whether anything downstream reads `modules.schema_fields`.
   - Recommendation: Keep populating it for now (zero cost, backward compatible). Deprecation is a v4.1 concern.

2. **Should Ecto embedded_schema fields be extracted?**
   - What we know: `extractSchemaDetails` currently skips `embedded_schema` blocks. These are value objects, not database tables.
   - What's unclear: Whether embedded schemas are relevant for data contract tracing.
   - Recommendation: Skip for now (matches existing behavior). Can add later if needed.

3. **How to handle Absinthe (Elixir-defined) GraphQL types?**
   - What we know: Absinthe types are extracted as modules with type `absinthe_object`/`absinthe_input_object`. Their fields are Elixir `field :name, :type` macros inside `object` blocks.
   - What's unclear: Whether to extract Absinthe fields as GraphQL fields or Elixir fields.
   - Recommendation: Treat Absinthe type fields as `graphql_type` parent_type. This keeps them in the same category as SDL-defined GraphQL types. The Elixir `field` regex inside Absinthe blocks is identical to the existing schema `field` regex but occurs inside `object :name do...end` blocks instead of `schema "table" do...end`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/indexer/elixir.test.ts tests/indexer/proto.test.ts tests/indexer/graphql.test.ts tests/indexer/writer.test.ts tests/db/schema.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FLD-01 | Ecto fields extracted as individual rows | unit | `npx vitest run tests/indexer/elixir.test.ts -t "required"` | Needs new tests |
| FLD-02 | Proto fields extracted as individual rows | unit | `npx vitest run tests/indexer/proto.test.ts -t "optional"` | Needs new tests |
| FLD-03 | GraphQL fields extracted as individual rows | unit | `npx vitest run tests/indexer/graphql.test.ts -t "field"` | Needs new tests |
| FLD-04 | Fields table created via migration | unit | `npx vitest run tests/db/schema.test.ts -t "v8"` | Needs new tests |
| NULL-01 | Ecto validate_required -> nullable=false | unit | `npx vitest run tests/indexer/elixir.test.ts -t "required"` | Needs new tests |
| NULL-02 | Proto optional -> nullable=true | unit | `npx vitest run tests/indexer/proto.test.ts -t "optional"` | Needs new tests |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/indexer/elixir.test.ts tests/indexer/proto.test.ts tests/indexer/graphql.test.ts tests/indexer/writer.test.ts tests/db/schema.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. Tests need to be written but the framework and patterns are established.

## Sources

### Primary (HIGH confidence)
- Codebase: `src/db/migrations.ts` -- migration chain pattern, current V7
- Codebase: `src/db/schema.ts` -- SCHEMA_VERSION=7
- Codebase: `src/indexer/elixir.ts` -- `extractSchemaDetails` returns `{ name, type }[]`, field regex
- Codebase: `src/indexer/proto.ts` -- `extractFields` with `(?:repeated|optional|required)?` regex
- Codebase: `src/indexer/graphql.ts` -- `GraphqlType.body` stores raw field text
- Codebase: `src/indexer/writer.ts` -- `RepoData`, `persistRepoData`, `persistSurgicalData` patterns
- Codebase: `src/indexer/pipeline.ts` -- `ExtractedRepoData`, extraction-to-persistence flow
- Codebase: `tests/` -- vitest patterns with temp DB, migration tests

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` -- FLD-01..04, NULL-01..02 definitions
- `.planning/ROADMAP.md` -- Phase 29 success criteria
- Elixir Ecto documentation (training knowledge) -- `validate_required/3` accepts changeset + field list

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all patterns established in codebase
- Architecture: HIGH - direct extension of existing migration/extractor/writer/pipeline patterns
- Pitfalls: HIGH - based on thorough reading of all three extractors and the writer
- Nullability extraction: MEDIUM - `validate_required` regex patterns inferred from Ecto conventions, not verified against actual indexed Fresha repos

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable domain, codebase under our control)
