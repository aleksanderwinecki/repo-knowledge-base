# Phase 35: FTS Description Enrichment - Research

**Researched:** 2026-03-11
**Domain:** FTS5 description assembly in indexer/writer.ts for cross-repo disambiguation and proto field discoverability
**Confidence:** HIGH

## Summary

This phase modifies FTS description strings at index time to improve search discoverability across three axes: (1) embedding repo names in all entity FTS descriptions so searching a repo name surfaces its modules and fields, (2) enriching proto field descriptions with parent message and event context so searching an event name surfaces associated proto fields, and (3) enriching module FTS descriptions with repo context and structural semantics without polluting BM25 rankings with field name lists.

All changes are confined to `src/indexer/writer.ts` -- specifically the `insertModuleWithFts` helper, the field insertion loops inside `persistRepoData()` and `persistSurgicalData()`, and potentially `insertEventWithFts`. No new files, no new dependencies, no schema version bump needed. The repo name (`data.metadata.name`) is already in scope in both persist functions but is not currently threaded into the FTS description builders. The event name for proto fields is already resolvable at persist time via the `lookupEvent` query that resolves `field.parentName` to an event ID.

**Primary recommendation:** Modify the FTS description strings in writer.ts's persist functions to include repo name for all entity types, event/message context for proto fields, and structural semantics (table name, associations) for modules -- while strictly avoiding field name lists in module descriptions.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DESC-01 | All FTS entity descriptions include repo name for cross-repo disambiguation | `data.metadata.name` is in scope in `persistRepoData()` and `data.metadata` available in `persistSurgicalData()`. Repo name must be added to FTS descriptions for modules (in `insertModuleWithFts`), fields (in field insert loops), events (in `insertEventWithFts`), and services (in `insertServiceWithFts`). Currently none of these include repo name. |
| DESC-02 | Proto field FTS descriptions include parent message name and associated event name | For proto fields, `field.parentName` IS the proto message name (e.g., `BookingCreated`), which also serves as the event name. The `lookupEvent` query already resolves `parentName` to an event ID. The FTS description can include explicit `event:` prefix for discoverability. Current description is just `${field.parentName} ${field.fieldType}`. |
| DESC-03 | Module FTS descriptions include repo context without duplicating field-level tokens | Current module description is `mod.summary` + optional `table:${tableName}`. Can add repo name and association targets. MUST NOT add field name lists -- fields are already indexed separately in the `fields` table FTS entries. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | existing | Synchronous SQLite driver | Already in use; no changes needed |
| SQLite FTS5 | bundled | Full-text search with BM25 ranking | FTS5 `knowledge_fts` table already configured with `tokenize='unicode61'` and `prefix='2,3'` |

### Supporting
No new libraries needed. All changes are pure string construction in existing TypeScript code.

## Architecture Patterns

### Pattern 1: FTS Description Assembly in writer.ts

**What:** Each entity type has its FTS description assembled in `writer.ts` at persist time, then passed to `indexEntity()` which tokenizes and inserts into `knowledge_fts`.

**Current state (what gets indexed):**
```
Module:  mod.summary + optional "table:${tableName}"
Event:   evt.schemaDefinition (raw proto message text)
Service: svc.description (gRPC RPC list)
Field:   "${field.parentName} ${field.fieldType}"  -- MINIMAL
Repo:    data.metadata.description
```

**Target state (after enrichment):**
```
Module:  "${repoName} ${mod.summary} table:${tableName} ${associationTargets}"
         -- NO field name lists
Event:   "${repoName} ${evt.schemaDefinition}"
Service: "${repoName} ${svc.description}"
Field:   "${repoName} ${field.parentName} ${field.fieldType} ${constraintLabel}"
         -- For proto fields: "${repoName} ${field.parentName} ${field.fieldType} event:${eventName}"
Repo:    unchanged (already has metadata.description)
```

**Key constraint:** `indexEntity()` runs `tokenizeForFts()` on the description before inserting into FTS5. The tokenizer lowercases everything and splits on separators (underscores, dots, colons). So `table:bookings` becomes tokens `table bookings` and `event:BookingCreated` becomes `event booking created`. This is fine -- both the prefix label and the split name become searchable tokens.

### Pattern 2: Repo Name Threading

**What:** `data.metadata.name` (the repo name, e.g. `booking-service`) is available in both `persistRepoData()` and `persistSurgicalData()` but is NOT currently passed to `insertModuleWithFts`, `insertEventWithFts`, `insertServiceWithFts`, or the field insert loops.

**Implementation approach:** Pass `repoName` as an additional parameter to the private insert helpers, OR capture it as a local constant at the top of each persist function's transaction body and use it directly in the field insert loop.

**For `insertModuleWithFts` and `insertEventWithFts`:** These are private functions that take prepared statements. Add a `repoName: string` parameter.

**For field and service insert loops:** These are inline in the persist functions. The repo name is already in scope via `data.metadata.name` -- just use it in the description string.

**Code change pattern:**
```typescript
// Current field FTS description
description: `${field.parentName} ${field.fieldType}`

// Enriched (DESC-01 + DESC-02)
const repoName = data.metadata.name;
// ...in the field loop:
let description = `${repoName} ${field.parentName} ${field.fieldType}`;
if (field.parentType === 'proto_message') {
  description += ` event:${field.parentName}`;
}
```

### Pattern 3: Module Description Enrichment (DESC-03)

**What:** Module FTS descriptions should include structural context without field name dumps.

**Current module FTS description assembly (insertModuleWithFts, lines 230-236):**
```typescript
let ftsDescription = mod.summary;
if (mod.tableName) {
  ftsDescription = mod.summary
    ? `${mod.summary} table:${mod.tableName}`
    : `Ecto schema table: ${mod.tableName}`;
}
```

**Enriched (with repo name and association targets):**
```typescript
// Build parts array, join at end
const parts: string[] = [];
if (repoName) parts.push(repoName);
if (mod.summary) parts.push(mod.summary);
if (mod.tableName) parts.push(`table:${mod.tableName}`);
// Association targets are MODULE-LEVEL semantics (not field names)
// They tell you "this schema has_many Appointments" which is structural
// Could be added if ModuleData carried association info -- currently it doesn't.
const ftsDescription = parts.join(' ') || null;
```

**Critical boundary:** Module descriptions carry module-level semantics (moduledoc summary, table name, association targets). Field names are NOT module-level semantics and MUST NOT appear in module FTS descriptions.

### Pattern 4: Dual Persist Path Consistency

**What:** `persistRepoData()` (full reindex) and `persistSurgicalData()` (incremental) both have separate field insert loops (lines 396-436 and 546-586 respectively). Both loops construct the identical FTS description string. Any enrichment changes MUST be applied to BOTH loops.

**Risk:** Changing only one persist path creates inconsistent FTS entries depending on whether a repo gets a full or surgical reindex. Both paths must produce identical descriptions for the same field data.

**Mitigation:** Extract a shared `buildFieldDescription()` helper function that both loops call. This eliminates the duplication.

### Anti-Patterns to Avoid

- **Adding field name lists to module descriptions:** This is the #1 pitfall for this phase. `id`, `name`, `status`, `email` appearing in every schema module's FTS entry collapses BM25 rank spread. Fields are already indexed in the `fields` table's own FTS entries.

- **Changing `FieldData` interface shape:** Descriptions should be assembled in `writer.ts` at persist time, not carried in `FieldData`. The `pipeline.ts` extraction phase should not know about FTS description formatting.

- **Forgetting to update `persistSurgicalData`:** The surgical path has a copy of the field insert loop. Both must change.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FTS tokenization | Custom token splitter | `tokenizeForFts()` from `tokenizer.ts` | Already handles CamelCase, snake_case, dots -- `indexEntity()` calls it automatically |
| Event name lookup for proto fields | New DB query | Existing `lookupEvent` pattern in persist functions | Already resolves `field.parentName` to event ID; use same query to get event name |
| Schema version bump | New migration | Not needed | Description format changes are data-only; next reindex picks up new format. No column or table changes. |

## Common Pitfalls

### Pitfall 1: Token Pollution from Field Names in Module Descriptions
**What goes wrong:** Adding required/optional field name lists to module descriptions causes common tokens like `id`, `name`, `status` to appear in every schema module's FTS entry, collapsing BM25 differentiation.
**Why it happens:** It feels natural to make modules "more searchable" by adding their field names.
**How to avoid:** Module descriptions carry module-level semantics only: repo name, moduledoc, table name, association targets. Field names belong in the `fields` table FTS entries.
**Warning signs:** Searching `name` or `id` returns 80%+ of all modules with near-identical relevance scores.

### Pitfall 2: Inconsistent Descriptions Between Full and Surgical Persist
**What goes wrong:** Enriching the field description in `persistRepoData()` but not `persistSurgicalData()` (or vice versa) creates inconsistent FTS entries depending on reindex mode.
**Why it happens:** Both functions have separate, copy-pasted field insert loops.
**How to avoid:** Extract a shared `buildFieldDescription(field, repoName)` helper. Both persist paths call it.
**Warning signs:** Running `kb reindex --repo X` produces different search results than `kb index --force`.

### Pitfall 3: Proto Field Event Context Is Redundant with ParentName
**What goes wrong:** For proto fields, `field.parentName` already IS the message name (e.g., `BookingCreated`), which is also the event name. Adding `event:BookingCreated` when `parentName` is already `BookingCreated` adds marginal value -- both tokenize to the same tokens.
**Why it happens:** The event-name-in-description requirement implies a new piece of data, but for proto messages the event name == parent name.
**How to avoid:** Still add the `event:` prefix because it makes the description explicitly searchable by the pattern `event:X` (the prefix word `event` itself becomes a searchable token). Searching "event BookingCreated" will now MATCH proto fields, not just events. But be clear this is adding a semantic label, not new entity data.
**Warning signs:** None critical -- this is a design awareness item, not a failure mode.

### Pitfall 4: Enrichment Without Reindex Shows No Effect
**What goes wrong:** After deploying enrichment code, existing FTS entries retain old descriptions until the repo is reindexed.
**Why it happens:** FTS descriptions are written at index time. The FTS table persists between runs.
**How to avoid:** After shipping enrichment, run `kb index --force` to reindex all repos. Do NOT bump `SCHEMA_VERSION` unless you also want to drop all learned facts and edges -- a full reindex with `--force` is sufficient and less disruptive.
**Warning signs:** Code changes are deployed but `kb search "booking-service"` still doesn't return booking-service modules.

## Code Examples

### Current Field FTS Description (writer.ts lines 429-434)
```typescript
// Source: src/indexer/writer.ts
indexEntity(db, {
  type: 'field' as EntityType,
  id: fieldId,
  name: field.fieldName,
  description: `${field.parentName} ${field.fieldType}`,
  subType: field.parentType,
});
```

### Enriched Field FTS Description (proposed)
```typescript
// Shared helper to avoid duplication between persistRepoData and persistSurgicalData
function buildFieldDescription(field: FieldData, repoName: string): string {
  const parts = [repoName, field.parentName, field.fieldType];
  // For proto fields, add explicit event label for "event X" searches
  if (field.parentType === 'proto_message') {
    parts.push(`event:${field.parentName}`);
  }
  return parts.join(' ');
}
```

### Current Module FTS Description (writer.ts lines 230-236)
```typescript
// Source: src/indexer/writer.ts
let ftsDescription = mod.summary;
if (mod.tableName) {
  ftsDescription = mod.summary
    ? `${mod.summary} table:${mod.tableName}`
    : `Ecto schema table: ${mod.tableName}`;
}
```

### Enriched Module FTS Description (proposed)
```typescript
// In insertModuleWithFts, with repoName parameter added
const parts: string[] = [];
parts.push(repoName);
if (mod.summary) parts.push(mod.summary);
if (mod.tableName) parts.push(`table:${mod.tableName}`);
const ftsDescription = parts.join(' ') || null;
```

### Event FTS Description Enrichment (proposed)
```typescript
// In insertEventWithFts, with repoName parameter added
indexEntity(db, {
  type: 'event' as EntityType,
  id: evtId,
  name: evt.name,
  description: evt.schemaDefinition ? `${repoName} ${evt.schemaDefinition}` : repoName,
  subType: 'event',
});
```

### Service FTS Description Enrichment (proposed)
```typescript
// In insertServiceWithFts, with repoName parameter added
indexEntity(db, {
  type: 'service' as EntityType,
  id: svcId,
  name: svc.name,
  description: svc.description ? `${repoName} ${svc.description}` : repoName,
  subType: svc.serviceType ?? 'service',
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Minimal field descriptions (`parent type`) | Still minimal (`${parentName} ${fieldType}`) | v4.0 | Proto fields unsearchable by event name or repo name |
| No repo name in FTS descriptions | Still absent | v1.0 | Cross-repo disambiguation impossible via FTS search |
| Module descriptions with summary only | summary + `table:tableName` | v3.x | Table name searchable, but repo name still missing |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npm test -- --reporter=dot` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DESC-01 | Repo name appears in FTS descriptions for all entity types | integration | `npx vitest run tests/indexer/writer.test.ts -t "repo name in FTS" -x` | No - Wave 0 |
| DESC-01 | Searching repo name returns modules/fields from that repo | golden | `npx vitest run tests/search/golden.test.ts -t "repo name" -x` | No - Wave 0 |
| DESC-02 | Proto field FTS description includes event context | integration | `npx vitest run tests/indexer/writer.test.ts -t "proto field event" -x` | No - Wave 0 |
| DESC-02 | Searching event name returns associated proto fields | golden | `npx vitest run tests/search/golden.test.ts -t "event name returns" -x` | No - Wave 0 |
| DESC-03 | Module FTS description includes repo context | integration | `npx vitest run tests/indexer/writer.test.ts -t "module description" -x` | No - Wave 0 |
| DESC-03 | Module FTS description does NOT contain field names | unit | `npx vitest run tests/indexer/writer.test.ts -t "no field names" -x` | No - Wave 0 |
| DESC-03 | Common field name search does not flood module results | golden | `npx vitest run tests/search/golden.test.ts -t "common field" -x` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test -- --reporter=dot` (814 tests, ~6s)
- **Per wave merge:** `npm test` (full output)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Golden tests in `tests/search/golden.test.ts` for repo-name search and event-name-to-field search
- [ ] Writer integration tests in `tests/indexer/writer.test.ts` for enriched FTS descriptions
- [ ] Test seed in `tests/fixtures/seed.ts` needs fields data to test field FTS descriptions (currently seeds no fields)

## Open Questions

1. **Association targets in module descriptions**
   - What we know: `ElixirModule.associations` contains `{ kind, name, target }` tuples. `ModuleData` does NOT carry association data -- it's lost during the `elixirModuleData` mapping in `pipeline.ts`.
   - What's unclear: Should module FTS descriptions include association target names (e.g., "has_many Appointments")? This is module-level structural semantics (not field names) and would improve searchability.
   - Recommendation: Skip for this phase. Adding association data requires extending `ModuleData` or a DB lookup. The three requirements (DESC-01/02/03) are achievable without it. Can be added as follow-up.

2. **Schema version bump**
   - What we know: No table or column changes are needed. FTS description format changes take effect on next reindex.
   - What's unclear: Should `SCHEMA_VERSION` be bumped to force auto-rebuild on existing installs?
   - Recommendation: Do NOT bump. A version bump triggers drop+rebuild which nukes all indexed data. A `kb index --force` is sufficient and less disruptive. Document the need for `--force` reindex in the plan.

3. **Repo FTS description enrichment**
   - What we know: The repo entity itself already includes `metadata.description` as its FTS description.
   - What's unclear: Should the repo description also be enriched (e.g., with tech stack)?
   - Recommendation: Out of scope for DESC-01/02/03. The repo entity is already searchable by name. The requirements focus on making *other* entities discoverable via repo name.

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection (2026-03-11):
  - `src/indexer/writer.ts` -- FTS description assembly for all entity types, `persistRepoData()` and `persistSurgicalData()` field insert loops
  - `src/indexer/pipeline.ts` -- `extractRepoData()` field mapping, data flow from extractors to writer
  - `src/indexer/proto.ts` -- `ProtoMessage` / `ProtoField` shapes, no event association metadata
  - `src/db/fts.ts` -- `indexEntity()` tokenization path, `searchWithRelaxation()` query path
  - `src/db/tokenizer.ts` -- `tokenizeForFts()` splitting/lowercasing behavior
  - `src/search/text.ts` -- `searchText()` orchestration, hydration loop
  - `src/db/schema.ts` -- `SCHEMA_VERSION = 10`, table definitions
  - `tests/fixtures/seed.ts` -- test data (no fields seeded currently)
  - `tests/search/golden.test.ts` -- 18 golden tests, progressive relaxation coverage
  - `tests/indexer/writer.test.ts` -- writer integration tests

### Secondary (MEDIUM confidence)
- `.planning/research/PITFALLS.md` -- Pitfall 3 (token pollution) confirmed via codebase inspection
- `.planning/research/ARCHITECTURE.md` -- Pattern 1 (description construction) confirmed accurate

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all verified against existing codebase
- Architecture: HIGH - all patterns confirmed via direct source inspection; exact line numbers verified
- Pitfalls: HIGH - token pollution pitfall confirmed via tokenizer behavior analysis; dual-persist-path risk confirmed by code inspection showing identical copy-pasted loops at writer.ts:396-436 and writer.ts:546-586

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable -- pure logic changes in well-understood codebase)
