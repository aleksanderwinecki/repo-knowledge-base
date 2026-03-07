# Phase 10: Search Type Filtering - Research

**Researched:** 2026-03-07
**Domain:** SQLite FTS5 filtering, CLI/MCP search interface extension
**Confidence:** HIGH

## Summary

Phase 10 adds granular entity sub-type filtering to the existing search infrastructure. The database already stores sub-types (`modules.type` has values like `schema`, `context`, `command`, `query`, `graphql_type`, `graphql_query`, `absinthe_object`, etc., and `services.service_type` has `grpc`), but the FTS index only stores coarse parent types (`module`, `event`, `service`, `repo`). The core work is: (1) change FTS `entity_type` values to use a `parent:subtype` convention during indexing, (2) update query-side filtering to support both coarse prefix matches and exact sub-type matches, (3) expose the `type` parameter through MCP tools that currently lack it, and (4) add a type discovery mechanism.

The codebase is well-structured for this change. All FTS indexing goes through `indexEntity()` in `src/db/fts.ts`, all FTS querying goes through `executeFtsQuery()` in `src/search/text.ts` and `findByFts()` in `src/search/entity.ts`, and all persistence goes through `persistRepoData()`/`persistSurgicalData()` in `src/indexer/writer.ts`. The user decision to scrap and rebuild the database (rather than migrate) simplifies things considerably -- no migration needed, just re-index.

**Primary recommendation:** Modify `indexEntity()` to accept and store `parent:subtype` format, update `executeFtsQuery()`/`findByFts()` to use `LIKE 'parent:%'` for coarse types and exact `=` for sub-types, add `subType` to `TextSearchResult`, extend CLI/MCP interfaces, and add a `listTypes` query function.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use exact sub-types from the database as filter values: `schema`, `context`, `command`, `query`, `graphql_type`, `graphql_query`, `graphql_mutation`, `absinthe_object`, `absinthe_query`, `absinthe_mutation`, `grpc`, `module`, etc.
- Single unified `--type` flag accepts both coarse types (`module`, `event`, `service`, `repo`) and granular sub-types (`schema`, `graphql_query`, `grpc`)
- Filtering applies to modules (via `modules.type`) and services (via `services.service_type`). Events do not have a meaningful sub-type dimension yet.
- `--list-types` flag / `kb_list_types` MCP tool for discovering available types dynamically from the database
- CLI: Existing `--type` flag on `kb search` extended to accept sub-types (backward compatible)
- MCP `kb_search`: Add `type` string parameter (currently missing entirely)
- MCP `kb_entity`: Add `type` string parameter (currently missing entirely)
- New `kb_list_types` MCP tool for type discovery
- Entity query mode (`kb search --entity --type schema`) also supports sub-type filtering
- Store sub-types in FTS `entity_type` column using `parent:subtype` prefix convention (e.g., `module:schema`, `module:graphql_query`, `service:grpc`)
- Coarse type queries (`--type module`) use prefix matching against `module:*`
- Granular type queries (`--type schema`) match the subtype portion
- Scrap old database and rebuild from scratch (no migration needed -- just re-index)
- Entities without a meaningful sub-type use `parent:parent` format (e.g., `event:event`, `repo:repo`)
- Add `subType` field to `TextSearchResult` interface (e.g., `schema`, `graphql_query`, `grpc`)
- Keep existing coarse `entityType` field for backward compatibility
- `--list-types` output grouped by parent type with counts: `module: [schema (142), context (58), ...]`
- Update MCP tool descriptions and kb skill to mention type filtering and discovery

### Claude's Discretion
- Exact FTS prefix matching SQL implementation
- How to parse `parent:subtype` back into separate fields during hydration
- Error messages for invalid type values
- Whether `--list-types` is a subcommand or a flag on search

### Deferred Ideas (OUT OF SCOPE)
- Event filtering by domain or owner_team -- could be its own feature/phase
- Group aliases (`graphql` matching all graphql_* sub-types) -- not needed with exact sub-types for now
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.0.0 | SQLite database with FTS5 | Already in use, FTS5 virtual table drives all search |
| commander | ^14.0.3 | CLI framework | Already in use for `kb` commands |
| zod | ^4.3.6 | MCP tool schema validation | Already in use for all MCP tool registrations |
| @modelcontextprotocol/sdk | ^1.27.1 | MCP server framework | Already in use |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | ^3.0.0 | Test framework | All new tests |

### Alternatives Considered
None -- this phase uses only the existing stack. No new dependencies needed.

## Architecture Patterns

### Recommended Change Structure
```
src/
├── db/
│   └── fts.ts              # indexEntity() accepts subType, stores parent:subtype
├── search/
│   ├── types.ts            # Add subType to TextSearchResult, update EntityFilters
│   ├── text.ts             # executeFtsQuery() handles prefix/exact type matching
│   └── entity.ts           # findByFts()/findExact() handle sub-type filter logic
├── indexer/
│   └── writer.ts           # Pass sub-type info through to indexEntity() calls
├── cli/
│   └── commands/
│       └── search.ts       # Extend --type description, add --list-types
├── mcp/
│   └── tools/
│       ├── search.ts       # Add type parameter to Zod schema
│       ├── entity.ts       # Add type parameter to Zod schema
│       └── list-types.ts   # NEW: kb_list_types MCP tool
└── types/
    └── entities.ts         # EntityType stays unchanged (coarse types only)
```

### Pattern 1: FTS `parent:subtype` Convention
**What:** Store `entity_type` in FTS as `parent:subtype` (e.g., `module:schema`, `service:grpc`, `event:event`)
**When to use:** Every call to `indexEntity()`
**Implementation detail:** The `entity_type` column in FTS5 is NOT marked as UNINDEXED, so it gets full-text indexed. However, all current filtering uses SQL `AND entity_type = ?`, not MATCH on entity_type. With the new convention, this becomes `AND entity_type LIKE 'module:%'` for coarse filtering or `AND entity_type = 'module:schema'` for exact sub-type. We could also mark it UNINDEXED in the rebuilt FTS table since we never full-text-search the type column. This is a discretion decision -- recommended to add UNINDEXED since it saves index space and we only use SQL operators on this column.

**Example:**
```typescript
// In indexEntity() - store composite type
const compositeType = subType ? `${entity.type}:${subType}` : `${entity.type}:${entity.type}`;
db.prepare(
  'INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)',
).run(processedName, processedDescription, compositeType, entity.id);
```

### Pattern 2: Unified Type Resolution
**What:** A single function that determines whether a `--type` value is a coarse parent type or a granular sub-type, and produces the appropriate SQL filter.
**When to use:** In both `executeFtsQuery()` and `findByFts()` / `findExact()`.

**Example:**
```typescript
// Coarse types map to LIKE prefix, sub-types to exact suffix match
const COARSE_TYPES = new Set(['repo', 'module', 'event', 'service']);

function resolveTypeFilter(typeValue: string): { sql: string; param: string } {
  if (COARSE_TYPES.has(typeValue)) {
    // Coarse: match all sub-types under this parent
    return { sql: 'entity_type LIKE ?', param: `${typeValue}:%` };
  }
  // Granular: match the sub-type portion with any parent
  // e.g., --type schema -> entity_type LIKE '%:schema'
  return { sql: 'entity_type LIKE ?', param: `%:${typeValue}` };
}
```

### Pattern 3: Hydration Sub-Type Extraction
**What:** Parse `parent:subtype` from FTS results back into separate `entityType` and `subType` fields.
**When to use:** In `hydrateResult()` and search result construction.

**Example:**
```typescript
function parseCompositeType(compositeType: string): { entityType: EntityType; subType: string } {
  const colonIdx = compositeType.indexOf(':');
  if (colonIdx === -1) {
    // Legacy format (shouldn't happen after rebuild, but defensive)
    return { entityType: compositeType as EntityType, subType: compositeType };
  }
  const parent = compositeType.substring(0, colonIdx) as EntityType;
  const sub = compositeType.substring(colonIdx + 1);
  return { entityType: parent, subType: sub };
}
```

### Pattern 4: Type Discovery via SQL Aggregation
**What:** Query distinct `entity_type` values from FTS table with counts, grouped by parent type.
**When to use:** `--list-types` and `kb_list_types` MCP tool.

**Example:**
```typescript
function listAvailableTypes(db: Database.Database): Record<string, { subType: string; count: number }[]> {
  const rows = db.prepare(`
    SELECT entity_type, COUNT(*) as count
    FROM knowledge_fts
    GROUP BY entity_type
    ORDER BY entity_type
  `).all() as Array<{ entity_type: string; count: number }>;

  const grouped: Record<string, { subType: string; count: number }[]> = {};
  for (const row of rows) {
    const { entityType, subType } = parseCompositeType(row.entity_type);
    if (!grouped[entityType]) grouped[entityType] = [];
    grouped[entityType].push({ subType, count: row.count });
  }
  return grouped;
}
```

### Anti-Patterns to Avoid
- **Modifying EntityType union for sub-types:** The `EntityType` type (`'repo' | 'file' | 'module' | 'service' | 'event'`) should remain as coarse types. Sub-types are a separate dimension stored as plain strings. Don't pollute the union with `'schema' | 'graphql_query' | ...`.
- **Multiple --type flags:** Don't add separate `--subtype` flag. Single `--type` handles both coarse and granular -- simpler UX.
- **Querying source tables for type discovery:** Don't query `modules.type` and `services.service_type` separately for list-types. The FTS `entity_type` column is the single source of truth after indexing, and it covers all entity categories uniformly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FTS prefix matching | Custom tokenizer or separate type table | `LIKE 'parent:%'` in SQL WHERE clause | FTS5 supports standard SQL operators alongside MATCH; the MATCH narrows the result set first, then LIKE post-filters efficiently |
| Type validation | Manual if/else validation chains | Set lookup against COARSE_TYPES + dynamic DB query | The set of valid sub-types grows with extractors; static validation becomes stale |

## Common Pitfalls

### Pitfall 1: FTS5 entity_type Column Is Full-Text Indexed
**What goes wrong:** The current FTS5 table has `entity_type` as a regular (indexed) column. Storing `module:schema` means FTS5 will tokenize it as separate tokens `module` and `schema`, which could interfere with MATCH queries if someone searches for "module" or "schema" as text.
**Why it happens:** FTS5 indexes all columns by default unless marked UNINDEXED.
**How to avoid:** When rebuilding the FTS table, mark `entity_type` and `entity_id` as UNINDEXED. `entity_id` is already UNINDEXED. Add UNINDEXED to `entity_type` too. This prevents the colon-separated type string from polluting full-text search results while still allowing SQL = and LIKE operations.
**Warning signs:** Searching for "schema" returns results ranked by entity_type matches rather than name/description matches.

### Pitfall 2: Hydration Switch Statement Assumes Coarse Types
**What goes wrong:** `hydrateResult()` in `text.ts` has a switch on `entityType` with cases for `repo`, `module`, `event`, `service`, `learned_fact`. After the FTS convention change, `match.entity_type` will be `module:schema` instead of `module`.
**Why it happens:** The switch extracts `entityType` directly from the FTS result.
**How to avoid:** Parse the composite type BEFORE the switch statement. Extract the parent type for routing, pass the sub-type through to the result.
**Warning signs:** All results return `null` from `hydrateResult()` because no switch case matches `module:schema`.

### Pitfall 3: Entity Search Uses entity_type = ? for FTS
**What goes wrong:** Both `executeFtsQuery()` and `findByFts()` currently use `AND entity_type = ?` with the raw EntityType value. After the convention change, passing `'module'` won't match `'module:schema'`.
**Why it happens:** Direct string equality breaks with the new composite format.
**How to avoid:** Replace `entity_type = ?` with the type resolution logic (LIKE for coarse types, exact for composite).
**Warning signs:** `--type module` returns zero results even though modules exist.

### Pitfall 4: findExact() Bypasses FTS -- Needs Separate Sub-Type Filtering
**What goes wrong:** `findExact()` in `entity.ts` queries source tables directly (not FTS). It uses `EntityFilters.type` to select which tables to query. With sub-type filtering, querying the `modules` table with `--type schema` needs to also add `AND m.type = 'schema'` to the SQL.
**Why it happens:** `findExact()` uses the `type` filter to choose which entity tables to search, not to filter within a table.
**How to avoid:** When the type filter is a sub-type (not a coarse type), determine its parent, query that parent's table, AND add a sub-type column filter. For modules: `AND m.type = ?`. For services: `AND s.service_type = ?`.
**Warning signs:** `kb search "MyModule" --entity --type schema` returns all modules named "MyModule" regardless of their sub-type.

### Pitfall 5: `learned_fact` Entity Type in FTS
**What goes wrong:** Learned facts are stored in FTS with `entity_type = 'learned_fact'`, which isn't in the EntityType union. The new convention would make it `learned_fact:learned_fact`.
**Why it happens:** Learned facts are a special case -- indexed in FTS but not a formal entity type.
**How to avoid:** Handle `learned_fact` as a valid coarse type in the resolution logic. Store as `learned_fact:learned_fact` in FTS.
**Warning signs:** Learned facts disappear from search results or `--list-types` shows unexpected entries.

### Pitfall 6: Surgical Persist FTS Entries Use Old Convention
**What goes wrong:** Both `persistRepoData()` and `persistSurgicalData()` call `indexEntity()`. If `indexEntity()` is updated but the callers don't pass sub-type information, new FTS entries will use the parent-only format.
**Why it happens:** `indexEntity()` currently only receives `entity.type` (the coarse type). It needs the sub-type too.
**How to avoid:** Extend the `indexEntity()` signature to accept an optional `subType` parameter. Update ALL callers in `writer.ts` to pass the sub-type from module data or service data.
**Warning signs:** FTS entries have `module:module` for everything instead of `module:schema`, `module:context`, etc.

## Code Examples

### Current indexEntity() Signature (to be modified)
```typescript
// Source: src/db/fts.ts lines 35-62
export function indexEntity(
  db: Database.Database,
  entity: {
    type: EntityType;
    id: number;
    name: string;
    description?: string | null;
  },
): void {
  // Currently stores entity.type directly as entity_type
  // e.g., 'module', 'event', 'service', 'repo'
}
```

### Current executeFtsQuery() Filter (to be modified)
```typescript
// Source: src/search/text.ts lines 58-95
// Current: AND entity_type = ?
const typeFilter = entityTypeFilter ? ' AND entity_type = ?' : '';
// Needs to become: AND entity_type LIKE ? (for coarse) or AND entity_type = ? (for composite)
```

### Current FTS Schema (to be rebuilt)
```sql
-- Source: src/db/fts.ts lines 19-27
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  name,
  description,
  entity_type,           -- Currently indexed (full-text), should become UNINDEXED
  entity_id UNINDEXED,
  tokenize = 'unicode61'
);
```

### Sub-Type Source Data Already Available in Writer
```typescript
// Source: src/indexer/writer.ts -- module insertion (lines 201-224)
// mod.type already has values like 'schema', 'context', 'command', 'graphql_type'
for (const mod of data.modules) {
  // mod.type = sub-type (e.g., 'schema', 'context', 'command', 'query', 'module')
  // Currently: indexEntity(db, { type: 'module' as EntityType, ... })
  // Needed:    indexEntity(db, { type: 'module' as EntityType, subType: mod.type, ... })
}

// Source: src/indexer/writer.ts -- service insertion (lines 253-279)
// svc.serviceType already has values like 'grpc'
for (const svc of data.services) {
  // svc.serviceType = sub-type (e.g., 'grpc')
  // Currently: indexEntity(db, { type: 'service' as EntityType, ... })
  // Needed:    indexEntity(db, { type: 'service' as EntityType, subType: svc.serviceType, ... })
}
```

### MCP Tool Registration Pattern (for new kb_list_types)
```typescript
// Source: src/mcp/tools/search.ts -- pattern to follow
server.tool(
  'kb_list_types',
  'Discover available entity types and sub-types in the knowledge base',
  {
    // No required parameters -- returns all types
  },
  async () => {
    // Query FTS for distinct entity_type values with counts
    // Return grouped by parent type
  },
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| FTS entity_type stores coarse types only | FTS entity_type stores `parent:subtype` | This phase | Enables granular filtering without schema migration |
| CLI --type only accepts repo/module/event/service | CLI --type accepts both coarse and sub-types | This phase | Backward compatible -- old values still work |
| MCP kb_search has no type parameter | MCP kb_search gains type parameter | This phase | Feature parity with CLI |

**Deprecated/outdated:**
- Old FTS entries with coarse-only entity_type: Wiped on re-index per user decision. No migration needed.

## Open Questions

1. **Should `entity_type` be UNINDEXED in rebuilt FTS table?**
   - What we know: Currently it's indexed (full-text). Storing `module:schema` would create FTS tokens for `module` and `schema`, polluting search results.
   - What's unclear: Performance impact of UNINDEXED vs indexed for LIKE queries.
   - Recommendation: **Mark UNINDEXED.** We never full-text search this column. SQL = and LIKE still work on UNINDEXED columns. This prevents type strings from appearing in MATCH results and saves index space. Confidence: HIGH (verified via SQLite FTS5 docs).

2. **Should `--list-types` be a flag on `search` or a separate subcommand?**
   - What we know: `kb search` is the main search command with flags. Commander.js supports both approaches.
   - Recommendation: **Flag on search** (`kb search --list-types`). It's a discovery helper for the search command specifically. Adding a top-level `kb types` subcommand is also fine but less discoverable. The MCP side (`kb_list_types`) is clearly a separate tool regardless.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0.0 |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/search/` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TF-01 | FTS stores parent:subtype format | unit | `npx vitest run tests/db/fts.test.ts -x` | Needs update |
| TF-02 | Coarse --type module returns all module sub-types | unit | `npx vitest run tests/search/text.test.ts -x` | Needs update |
| TF-03 | Granular --type schema returns only schema modules | unit | `npx vitest run tests/search/text.test.ts -x` | Needs update |
| TF-04 | TextSearchResult includes subType field | unit | `npx vitest run tests/search/text.test.ts -x` | Needs update |
| TF-05 | Entity search supports sub-type filtering | unit | `npx vitest run tests/search/entity.test.ts -x` | Needs update |
| TF-06 | --list-types returns grouped type counts | unit | `npx vitest run tests/search/text.test.ts -x` | New test |
| TF-07 | MCP kb_search accepts type parameter | integration | `npx vitest run tests/mcp/ -x` | Needs update |
| TF-08 | MCP kb_list_types returns type discovery data | integration | `npx vitest run tests/mcp/ -x` | New test |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/search/ tests/db/fts.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before verify

### Wave 0 Gaps
- [ ] Update test data in `tests/search/text.test.ts` to include modules with different sub-types (schema, graphql_query, etc.)
- [ ] Existing FTS tests need sub-type coverage

## Sources

### Primary (HIGH confidence)
- Codebase analysis: `src/db/fts.ts`, `src/search/text.ts`, `src/search/entity.ts`, `src/search/types.ts`, `src/indexer/writer.ts`, `src/indexer/pipeline.ts`, `src/indexer/elixir.ts`, `src/cli/commands/search.ts`, `src/mcp/tools/search.ts`, `src/mcp/tools/entity.ts`, `src/mcp/server.ts`, `src/db/migrations.ts`, `src/types/entities.ts`
- [SQLite FTS5 official documentation](https://www.sqlite.org/fts5.html) -- confirmed UNINDEXED columns support SQL = and LIKE operators, confirmed MATCH+AND performance characteristics

### Secondary (MEDIUM confidence)
- SQLite FTS5 prefix matching behavior verified across multiple documentation sources

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all existing libraries
- Architecture: HIGH -- clear modification points identified, all code paths traced
- Pitfalls: HIGH -- identified 6 specific pitfalls from code analysis, all with concrete file/line references
- FTS5 UNINDEXED behavior: HIGH -- verified against official SQLite docs

**Research date:** 2026-03-07
**Valid until:** Indefinite -- this is a self-contained codebase analysis with stable SQLite behavior
