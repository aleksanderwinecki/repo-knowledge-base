# Architecture Research

**Domain:** Search quality improvements for a SQLite/FTS5 knowledge base
**Researched:** 2026-03-11
**Confidence:** HIGH (all findings from direct codebase inspection)

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Interface Layer                              │
│  ┌──────────────────────┐     ┌──────────────────────────────┐  │
│  │  CLI (commander.js)  │     │  MCP Server (13 tools)       │  │
│  └──────────┬───────────┘     └──────────────┬───────────────┘  │
├─────────────┴────────────────────────────────┴──────────────────┤
│                      Search Layer                                │
│  ┌────────────┐  ┌─────────────┐  ┌────────────────────────┐   │
│  │  text.ts   │  │ entity.ts   │  │  field-impact.ts       │   │
│  │ (kb_search)│  │(kb_entity)  │  │  (kb_field_impact)     │   │
│  └────────────┘  └─────────────┘  └────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                    Database Layer (db/)                          │
│  ┌──────────┐  ┌──────────────────┐  ┌─────────────────────┐   │
│  │  fts.ts  │  │  tokenizer.ts    │  │  database.ts        │   │
│  │ (indexing │  │ (CamelCase/snake │  │  (pragmas, schema)  │   │
│  │  + query) │  │  split, lower)  │  │                     │   │
│  └──────────┘  └──────────────────┘  └─────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                    Indexing Layer (indexer/)                     │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐   │
│  │elixir.ts │  │ proto.ts │  │graphql.ts│  │  pipeline.ts │   │
│  │(extractor│  │(extractor│  │(extractor│  │  (3-phase    │   │
│  │+ fields) │  │+ fields) │  │+ fields) │  │  orchestrate)│   │
│  └──────────┘  └──────────┘  └──────────┘  └──────┬───────┘   │
│                                                      │           │
│  ┌───────────────────────────────────────────────────▼──────┐   │
│  │  writer.ts: persistRepoData / persistSurgicalData         │   │
│  │  indexEntity() called per entity with (name, description) │   │
│  └───────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│                     Storage Layer                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  SQLite: repos, modules, events, services, fields, edges  │   │
│  │  FTS5: knowledge_fts (name, description, UNINDEXED type)  │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Notes |
|-----------|---------------|-------|
| `src/db/tokenizer.ts` | Text preprocessing for FTS indexing and query time | Shared by both index write path and search query path |
| `src/db/fts.ts` | FTS5 table DDL, `indexEntity()`, `executeFtsWithFallback()` | Central chokepoint for all FTS operations |
| `src/search/text.ts` | `searchText()` orchestration: query → FTS → hydrate | Only search entry point for kb_search / CLI search |
| `src/indexer/writer.ts` | Calls `indexEntity()` with `(name, description)` per entity | FTS description is constructed here, per entity type |
| `src/indexer/elixir.ts` | Ecto field extraction including `extractRequiredFields()` | Drives nullability and constraint data |
| `src/indexer/proto.ts` | Proto message field extraction | No event-association metadata surfaced to FTS |
| `src/indexer/pipeline.ts` | 3-phase extraction orchestrator | Drives all extractors, maps to `FieldData[]` and `ModuleData[]` |

## Recommended Project Structure

No new files or folders are needed for v4.2. All changes are surgical modifications to existing files.

```
src/
├── db/
│   ├── fts.ts          # MODIFY: add OR-default query builder, progressive relaxation
│   └── tokenizer.ts    # unchanged
├── search/
│   ├── text.ts         # MODIFY: wire progressive relaxation from fts.ts
│   └── field-impact.ts # unchanged
└── indexer/
    ├── elixir.ts       # MODIFY: deeper Ecto extraction, null-guard scanning
    ├── proto.ts        # MODIFY: richer field context (message + event association)
    ├── graphql.ts      # MODIFY (minor): richer field context if applicable
    ├── writer.ts       # MODIFY: richer FTS descriptions for fields + events
    └── pipeline.ts     # unchanged (description construction moved to writer.ts)
```

## Architectural Patterns

### Pattern 1: Description Construction in writer.ts

**What:** Each `insertXxxWithFts()` helper in `writer.ts` assembles the FTS `description` string before calling `indexEntity()`. This is the single place where richness can be added.

**Current state:**
- Module: `mod.summary` + optional `table:${tableName}`
- Event: `evt.schemaDefinition` (raw proto message text)
- Service: `svc.description` (gRPC RPC list)
- Field: `${field.parentName} ${field.fieldType}` — minimal

**For v4.2, every field's FTS description should become:**
```typescript
// Current
description: `${field.parentName} ${field.fieldType}`

// Richer: repo context + constraints inline
description: `${repoName} ${field.parentName} ${field.fieldType}${isRequired ? ' required' : ' nullable'}${eventName ? ` event:${eventName}` : ''}`
```

**When to use:** Whenever an entity type has context that makes it searchable by indirect terms (event names, parent schema name, repo name, nullability constraint).

**Trade-offs:** The `repoName` must be passed into the field insertion loop inside `persistRepoData()`/`persistSurgicalData()`. Currently only `repoId` is available in the insert loop — `metadata.name` (already in scope) satisfies this.

### Pattern 2: Query Transformation in executeFtsWithFallback

**What:** The existing `executeFtsWithFallback` in `fts.ts` wraps a single FTS5 MATCH query with a phrase-fallback on syntax error. The v4.2 change extends this to a multi-tier strategy.

**Current flow:**
```
tokenizeForFts(query)
  → try MATCH tokens (AND-implicit by FTS5 default)
  → catch syntax error → try as phrase match
  → return results (possibly empty)
```

**Target flow:**
```
tokenizeForFts(query)
  → try MATCH tokens with OR operator (NEAR or explicit "tok1 OR tok2 OR tok3")
  → if results >= threshold → return
  → if results < threshold → try phrase match
  → return results (possibly empty)
```

**Key FTS5 mechanics:** FTS5 default is AND for multi-token queries (`token1 token2` means both required). Explicit OR needs `"token1" OR "token2"` syntax. A helper that joins tokenized tokens with ` OR ` produces higher-recall results.

**When to use:** Default for AI agent consumers. Agents rarely want zero results from partial name matches.

**Trade-offs:** OR means more results, lower precision. BM25 ranking still sorts best matches first. The AI consumer reads top N results and filters semantically — recall > precision is the right trade-off here.

### Pattern 3: Progressive Relaxation as a Wrapper

**What:** A new function wraps the multi-tier query logic so `searchText()` stays clean.

**Current architecture:** `searchText()` calls `executeFtsQuery()` which calls `executeFtsWithFallback()`. The relaxation logic belongs inside `executeFtsQuery()` or in `executeFtsWithFallback()` — not in `searchText()` which handles hydration.

**Proposed:**
```typescript
// fts.ts
export function executeFtsWithRelaxation<T>(
  db: Database.Database,
  sql: string,
  processedQuery: string,
  buildParams: (query: string) => (string | number)[],
  minResults = 3,
): T[] {
  // Tier 1: OR query
  const orQuery = buildOrQuery(processedQuery);
  const results = executeFtsWithFallback<T>(db, sql, orQuery, buildParams);
  if (results.length >= minResults) return results;

  // Tier 2: phrase match (existing fallback behavior)
  const phraseQuery = `"${processedQuery.replace(/"/g, '')}"`;
  return executeFtsWithFallback<T>(db, sql, phraseQuery, buildParams);
}
```

**When to use:** Replace `executeFtsWithFallback` call in `text.ts`'s `executeFtsQuery()`.

**Trade-offs:** Two DB queries when OR tier is insufficient. Both are indexed FTS5 queries — sub-millisecond. No meaningful performance concern.

### Pattern 4: Deeper Ecto Extraction in elixir.ts

**What:** `extractElixirFile` already calls `extractRequiredFields()` which parses `validate_required/2`. v4.2 adds extraction of `cast/3` attr lists and `@optional_fields` / `@required_fields` module attributes.

**Current state:** `ElixirModule.requiredFields` is populated from `validate_required`. The pipeline uses `!mod.requiredFields.includes(f.name)` for nullability.

**Target additions to `ElixirModule`:**
```typescript
interface ElixirModule {
  // existing...
  requiredFields: string[];    // from validate_required
  optionalFields: string[];    // NEW: from @optional_fields or cast attrs
  castFields: string[];        // NEW: from cast(attrs, [...fields])
}
```

**Integration point:** `extractElixirModules()` → `parseElixirFile()` → new private helpers `extractCastFields()` and `extractOptionalFields()`. These helpers follow the same regex-over-content pattern as `extractRequiredFields()`.

**When to use:** Ecto schemas that use changeset-driven constraints rather than schema-level type enforcement.

### Pattern 5: Null-Guard Heuristic Scanning

**What:** Scan for `is_nil(field_ref)` and `case field_ref` nil-branch patterns near field references in Elixir source to infer nullability where schema declarations are ambiguous.

**Integration point:** This is a new private helper in `elixir.ts` called at the end of `parseElixirFile()` per module. It augments `requiredFields` / `optionalFields` data — it does NOT produce a new data structure.

**Pattern:**
```typescript
function detectNullGuardedFields(content: string): Set<string> {
  const guarded = new Set<string>();
  // Pattern: is_nil(var.field_name) or is_nil(field_name)
  const isNilRe = /is_nil\(\w+\.(\w+)\)/g;
  // Pattern: case something.field_name do ... nil -> ...
  const caseNilRe = /case\s+\w+\.(\w+)\s+do[\s\S]*?nil\s*->/g;
  // ...
  return guarded;
}
```

**Feeds into:** `ElixirModule.nullGuardedFields` (new field) → pipeline uses it as additional signal when `requiredFields` is empty for a field.

**When to use:** Fields not in `validate_required` but also not `cast` optional — the "assumed present but nil-checked" category.

## Data Flow

### Indexing Data Flow (write path)

```
elixir.ts: extractElixirModules()
  ├── extractSchemaDetails()     → schemaFields: [{name, type}]
  ├── extractRequiredFields()    → requiredFields: string[]
  ├── extractCastFields() [NEW]  → castFields: string[]
  └── detectNullGuardedFields() [NEW] → nullGuardedFields: string[]
          │
          ▼
pipeline.ts: extractRepoData()
  ├── ectoFields = elixirModules.flatMap(mod =>
  │     mod.schemaFields.map(f => ({
  │       ...
  │       nullable: !mod.requiredFields.includes(f.name)
  │                && !mod.castFields.includes(f.name) [ENHANCED]
  │     }))
  │   )
  └── protoFields = protoDefinitions.flatMap(proto =>
        proto.messages.flatMap(msg =>
          msg.fields.map(f => ({
            ...
            // proto adds: eventName association [ENHANCED in proto.ts]
          }))
        )
      )
          │
          ▼
writer.ts: persistRepoData() / persistSurgicalData()
  └── for each field:
        description = buildFieldDescription(field, repoName, eventName) [ENHANCED]
            = `${repoName} ${parentName} ${fieldType} ${constraint} ${eventContext}`
        indexEntity(db, { type: 'field', description })

knowledge_fts table updated
```

### Search Query Data Flow (read path)

```
kb_search / CLI search
  → searchText(db, query, options)
       → executeFtsQuery(db, query, limit, typeFilter)
            → tokenizeForFts(query)           [unchanged]
            → buildOrQuery(tokens) [NEW]
            → executeFtsWithRelaxation() [NEW wrapper]
                 → Tier 1: OR query → MATCH
                 → Tier 2 (if few results): phrase match
                 → return FtsMatch[]
       → hydrate each result
  → return TextSearchResult[]
```

### Key Data Flows

1. **Richer field descriptions:** `elixir.ts` (more constraint data) → `pipeline.ts` (same FieldData shape, richer nullable signal) → `writer.ts` (richer description string) → `knowledge_fts` (more searchable tokens)

2. **OR-default search:** `text.ts` → `fts.ts::executeFtsWithRelaxation` (new) → FTS5 OR query → higher recall, same BM25 ranking

3. **Progressive relaxation:** Same path as OR-default, but triggered when OR tier returns fewer than `minResults` (default 3) — adds phrase tier as final fallback

4. **Proto field context:** `proto.ts` (message + event name in ProtoField or ProtoMessage) → `pipeline.ts` (surfaced into FieldData description) → `writer.ts` → FTS description includes event name

## Integration Points

### New vs Modified: Explicit Boundary

| File | Change Type | What Changes | What Stays the Same |
|------|-------------|--------------|---------------------|
| `src/db/fts.ts` | MODIFY | Add `buildOrQuery()`, `executeFtsWithRelaxation()` | `indexEntity()`, `executeFtsWithFallback()`, `resolveTypeFilter()`, FTS DDL |
| `src/search/text.ts` | MODIFY | `executeFtsQuery()` calls `executeFtsWithRelaxation` instead of `executeFtsWithFallback` | Hydration loop, options, return type |
| `src/indexer/writer.ts` | MODIFY | `insertFieldWithFts()` builds richer description (needs `repoName` in scope); `insertEventWithFts()` may add message context | `insertModuleWithFts()`, `insertServiceWithFts()`, all persist/clear functions |
| `src/indexer/elixir.ts` | MODIFY | New private helpers: `extractCastFields()`, `detectNullGuardedFields()`; `ElixirModule` interface gets new optional fields | All existing parsing logic, `extractSchemaDetails()`, `extractRequiredFields()` |
| `src/indexer/proto.ts` | MODIFY | Surface event association in `ProtoMessage` or `ProtoField` if feasible | Message/field extraction logic, file scanning |
| `src/indexer/pipeline.ts` | MODIFY (minor) | Use new `ElixirModule` fields for nullability signal | 3-phase structure, all extractor calls, surgical/full branching |

### Internal Boundaries

| Boundary | Communication | Constraint |
|----------|--------------|-----------|
| `elixir.ts` → `pipeline.ts` | `ElixirModule[]` interface | Adding fields to `ElixirModule` is backward-compatible; pipeline already destructures it |
| `pipeline.ts` → `writer.ts` | `FieldData[]` interface | `FieldData` shape is the contract — richer descriptions are built in `writer.ts`, not `FieldData` |
| `writer.ts` → `fts.ts` | `indexEntity()` call with `description` string | `description` is just a string; writer assembles it, fts.ts stores it |
| `fts.ts` → `text.ts` | `executeFtsWithFallback` (current) / `executeFtsWithRelaxation` (new) | `text.ts` only changes one call site |

### FieldData Contract: Stable

`FieldData` in `writer.ts` does NOT change shape. The richer descriptions are assembled inside `writer.ts`'s insert helpers using data already available at insert time (`repoName` from metadata in scope, `eventId` lookup already performed). This keeps `pipeline.ts`'s mapping logic clean.

```typescript
// FieldData stays:
interface FieldData {
  parentType: 'ecto_schema' | 'proto_message' | 'graphql_type';
  parentName: string;
  fieldName: string;
  fieldType: string;
  nullable: boolean;       // enriched by deeper Ecto extraction
  sourceFile: string;
  moduleId?: number | null;
  eventId?: number | null;
}
// eventId already present — writer.ts can look up event name from eventId for FTS description
```

## Suggested Build Order (Dependency-Driven)

```
Phase A: FTS query layer (no extractor changes needed)
  1. fts.ts: buildOrQuery() + executeFtsWithRelaxation()
  2. text.ts: wire executeFtsWithRelaxation
  3. Tests: confirm OR behavior, progressive relaxation, existing golden tests pass

Phase B: Richer FTS descriptions (depends on existing FieldData shape)
  4. writer.ts: richer field description builder (repoName + constraint + event context)
  5. writer.ts: richer event description (include proto message context if available)
  6. Tests: re-index test fixture, verify FTS tokens include new context

Phase C: Deeper Ecto extraction (independent of Phase A/B, feeds Phase B signal)
  7. elixir.ts: extractCastFields()
  8. elixir.ts: detectNullGuardedFields()
  9. elixir.ts: ElixirModule interface additions
  10. pipeline.ts: use new fields in nullable determination
  11. Tests: unit tests for new extractors; integration test for improved nullability

Phase D: Proto field context enrichment (independent of all above)
  12. proto.ts: surface event/message association in extraction output
  13. pipeline.ts / writer.ts: use in FieldData description
  14. Tests: proto field FTS tokens include message name
```

**Rationale for order:**
- Phase A is pure query-time and delivers immediate recall improvement with zero re-index required
- Phase B improves existing index richness — requires re-index to see results but no extractor risk
- Phase C changes extractor output and nullability signal — isolated risk, good to validate separately
- Phase D is the smallest scope change and most independent; can ship with any phase or last

## Anti-Patterns

### Anti-Pattern 1: Changing FieldData Shape for Descriptions

**What people do:** Add a `ftsDescription` field to `FieldData` and assemble the richer string in `pipeline.ts`.

**Why it's wrong:** `pipeline.ts` is the extraction orchestrator. Description assembly is a persistence concern. It also pushes `repoName` into every `FieldData` object when it's only needed at write time.

**Do this instead:** Keep `FieldData` stable. Assemble richer descriptions inside `writer.ts`'s insert helpers, where `repoName` is already in scope from the transaction context.

### Anti-Pattern 2: Hard-Coding OR as the FTS5 Query Mode

**What people do:** Change `tokenizeForFts` to always return an OR-joined string.

**Why it's wrong:** `tokenizeForFts` is used for both index-time tokenization (write path) and query-time tokenization. Injecting `OR` operators into the indexed text would corrupt the FTS index.

**Do this instead:** Keep `tokenizeForFts` as a pure text normalizer. Add a separate `buildOrQuery(processedQuery: string): string` helper that joins tokens with ` OR `. Call it only on the query side in `fts.ts`.

### Anti-Pattern 3: Adding a Progressive Relaxation State Machine in text.ts

**What people do:** Put the multi-tier query logic directly in `searchText()` alongside the hydration loop.

**Why it's wrong:** `searchText()` owns hydration, repo filtering, and result shaping. Query strategy is a DB-layer concern. Mixing them makes both harder to test.

**Do this instead:** Keep `executeFtsWithRelaxation()` in `fts.ts`. `text.ts` stays a thin orchestrator: tokenize → query (opaque) → hydrate.

### Anti-Pattern 4: Running Null-Guard Scan Across Entire File

**What people do:** Scan the entire `.ex` file content for `is_nil` patterns.

**Why it's wrong:** `is_nil` appears in non-schema functions. A guard on `opts.timeout` is not field nullability signal.

**Do this instead:** Scope the scan to the per-module content slice (`moduleContent`) that `parseElixirFile` already carves out. The function is already per-module in scope.

## Sources

All findings from direct codebase inspection (2026-03-11):

- `src/db/fts.ts` — FTS5 schema, `indexEntity`, `executeFtsWithFallback`, query logic
- `src/db/tokenizer.ts` — tokenization behavior, dual write/query usage
- `src/search/text.ts` — `searchText` orchestration, hydration, option handling
- `src/indexer/elixir.ts` — `ElixirModule` interface, `extractRequiredFields`, per-module content slicing
- `src/indexer/proto.ts` — `ProtoMessage`/`ProtoField` shapes
- `src/indexer/writer.ts` — `insertFieldWithFts` description construction, `FieldData` interface
- `src/indexer/pipeline.ts` — `extractRepoData` field mapping, nullability signal construction
- `src/search/field-impact.ts` — confirms `fields` table and `nullable` column semantics
- `.planning/PROJECT.md` — v4.2 target features and milestone context

---
*Architecture research for: v4.2 Search Quality (repo-knowledge-base)*
*Researched: 2026-03-11*
