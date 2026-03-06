# Phase 8: New Extractors - Research

**Researched:** 2026-03-06
**Domain:** Elixir/Proto/GraphQL extraction pipelines, EventCatalog enrichment
**Confidence:** HIGH

## Summary

Phase 8 adds four new extraction capabilities (gRPC service persistence, Ecto schema fields/associations, GraphQL from SDL and Absinthe, Event Catalog enrichment) and one cross-cutting concern (gRPC client call edge detection). The DB schema (V3) already has the required columns (`modules.table_name`, `modules.schema_fields`, `services.service_type`, `events.domain`, `events.owner_team`). The proto extractor already parses `ProtoService`/`ProtoRpc` — it just needs pipeline wiring to persist to the services table.

A critical finding from investigating the actual Event Catalog repo: the matching strategy from CONTEXT.md ("exact name match on CamelCase proto message names") is only partially correct. Of 7,469 events in the KB, 1,120 are named `Payload` (the proto message name), with the real event identity living in the **file path** (e.g., `proto/.../appointment_customer_changed/v1/...`). The enrichment logic must match by converting the catalog event ID (`event:appointment-customer-changed`) to snake_case (`appointment_customer_changed`) and matching against event `source_file` paths, not just event names. For events with meaningful CamelCase names (6,349 events), direct name matching also works as a secondary strategy.

Another key finding: gRPC client calls in the codebase rarely use the raw `ServiceName.Stub.method_name(channel, request)` pattern. Instead, the standard pattern is `use RpcClient.Client, service: ..., stub: ...` in generated client modules, and `@module_attr.method_name(request)` at call sites. However, the `use RpcClient.Client, ... stub: ServiceName.Stub` pattern in generated `.pb.ex` files is reliably detectable and maps to a specific gRPC service, which is what we should target.

**Primary recommendation:** Implement extractors in dependency order: (1) gRPC service persistence (simplest — just wiring), (2) Ecto schema extraction (extends existing elixir.ts), (3) GraphQL SDL + Absinthe extraction (new file + elixir.ts extension), (4) gRPC client call edges, (5) Event Catalog post-processing (most complex due to matching logic).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Ecto schema extraction: extend existing `elixir.ts` — add Ecto detection inside parseElixirFile's defmodule loop (single pass over .ex files)
- Only extract `schema "table_name" do` blocks — skip `embedded_schema` (no table, less useful for KB)
- Populate `modules.table_name` with the Ecto schema table name
- Store fields as JSON array of `{name, type}` in `modules.schema_fields` — e.g., `[{"name": "email", "type": "string"}]`
- Associations (`belongs_to`, `has_many`, `has_one`, `many_to_many`) stored as edges in the edges table between modules
- Edge relationship types: `belongs_to`, `has_many`, `has_one`, `many_to_many`
- New `graphql.ts` extractor file for `.graphql` SDL file parsing
- Extract top-level objects only: types, queries, mutations, input types
- Skip individual field-level extraction (fields captured as summary text)
- Add Absinthe macro detection to `elixir.ts` (alongside Ecto, same .ex file pass)
- Extract `object`, `input_object`, `query`, `mutation` macro blocks
- Top-level objects only — skip individual `field` macros (fields captured as summary text)
- Proto services already parsed (`ProtoService` with RPCs) but not persisted — wire persistence in `pipeline.ts`
- One service row per proto service in services table with `service_type='grpc'`
- RPC methods stored as description or JSON summary on the service row
- No new extractor file — just wiring in pipeline to map ProtoService to writer format
- Detect `ServiceName.Stub.method_name(channel, request)` patterns in .ex files — the standard gRPC Elixir client pattern
- Also catch aliased stub modules
- Create `calls_grpc` edges from repo -> service (repo-level, not module-level)
- Auto-discover repo named `fresha-event-catalog` under the indexing root directory
- Post-processing pass: run AFTER all repos are indexed, scan catalog once, enrich matching events across all repos
- Match catalog events to proto events by exact name match (CamelCase proto message names)
- Update `events.domain` and `events.owner_team` columns from catalog frontmatter — enrichment only, no new entity creation
- Catalog entries with no matching proto event: skip silently
- Re-enrich on every full re-index (domain/owner_team wiped with events, re-populated from catalog)
- Handle both EventCatalog v2 and v3 frontmatter formats

### Claude's Discretion
- GraphQL entity storage strategy (modules vs services table)
- How to store gRPC RPC methods on service rows (description text vs JSON)
- Exact regex patterns for Absinthe macro detection
- Exact regex patterns for gRPC stub call detection
- EventCatalog frontmatter field mapping (which fields -> domain, which -> owner_team)
- How to handle Absinthe query/mutation blocks that span multiple files (resolvers vs schema)
- Transaction strategy for Event Catalog post-processing enrichment

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| EXT-01 | gRPC service definitions from `.proto` files persisted to services table | ProtoService/ProtoRpc already parsed in proto.ts; pipeline.ts needs wiring to call writer with ServiceData; services table has service_type column from V3 |
| EXT-02 | Ecto schema fields, associations, table names from `.ex` files | parseElixirFile already detects `schema "table_name"`; extend to extract fields via `field :name, :type` regex and associations via `belongs_to`/`has_many` etc.; V3 added modules.table_name and modules.schema_fields |
| EXT-03 | GraphQL types, queries, mutations from `.graphql` SDL files | New graphql.ts extractor needed; SDL files found at various paths (schema.graphql, graphql-schemas/*.graphql); regex-parseable top-level `type`, `query`, `mutation`, `input` blocks |
| EXT-04 | Absinthe macro definitions from `.ex` files | Extend parseElixirFile to detect `object :name do`, `input_object :name do`, `query do`, `mutation do` macros; same single-pass approach as Ecto |
| EXT-05 | Event Catalog enrichment (descriptions, team ownership, domain) | Catalog at fresha-event-catalog/src/events/; MDX frontmatter has `owners:` (team) and event identity; domain derived from domain->service->event chain; matching requires path-based strategy, not just name matching |
| EXT-06 | gRPC client call patterns for `calls_grpc` edges | Primary pattern is `use RpcClient.Client, stub: ServiceName.Stub` in generated files; secondary is direct `ServiceName.Stub.method_name()` calls; edges are repo->service level |
</phase_requirements>

## Architecture Patterns

### Existing Extractor Pattern (MUST follow)
```
Extractors: extract*(repoPath, branch) -> pure data arrays
            parse*(filePath, content) -> pure functions (unit testable)
Pipeline:   maps extractor output to writer format, persists
Writer:     ModuleData, EventData, EdgeData interfaces -> DB
```

### Recommended Approach Per Extractor

**EXT-01 (gRPC service persistence):** No new extractor code. `extractProtoDefinitions()` already returns `ProtoDefinition[]` with `services: ProtoService[]`. Add `ServiceData` interface to writer.ts. Map in pipeline.ts: `ProtoService` -> `ServiceData` with `service_type='grpc'`, RPC methods as JSON summary in description.

**EXT-02 (Ecto schemas):** Extend `parseElixirFile()` to extract from the existing `moduleContent` slice:
- Fields: regex `field\s+:(\w+),\s+:?(\w+)` inside `schema "..." do` blocks
- Associations: regex `(belongs_to|has_many|has_one|many_to_many)\s+:(\w+),\s+(\w+(?:\.\w+)*)`
- Return new properties on `ElixirModule`: `schemaFields: {name, type}[]`, `associations: {type, name, target}[]`
- Pipeline maps `schemaFields` -> `modules.schema_fields` (JSON), associations -> edges between modules

**EXT-03 (GraphQL SDL):** New `src/indexer/graphql.ts` following exact same pattern as proto.ts:
- `extractGraphqlDefinitions(repoPath, branch)` -> `GraphqlDefinition[]`
- `parseGraphqlFile(filePath, content)` -> pure parse
- Filter `.graphql` files (no path restriction — they appear at various locations)

**EXT-04 (Absinthe macros):** Extend `parseElixirFile()` to detect Absinthe macros in `moduleContent`:
- `object :name do` blocks
- `input_object :name do` blocks
- `query do` / `mutation do` blocks
- Return as new property on `ElixirModule` or as separate `AbsintheType[]`

**EXT-05 (Event Catalog):** New function in pipeline.ts (or new `src/indexer/catalog.ts`):
- `enrichFromEventCatalog(db, rootDir)` called after `indexAllRepos()` loop
- Scans `{rootDir}/fresha-event-catalog/src/events/` directories
- Parses MDX frontmatter (YAML between `---` markers)
- Matches to existing events and updates `domain`/`owner_team`

**EXT-06 (gRPC client edges):** Extend elixir.ts or add detection in events.ts:
- Scan `.ex` files for `stub: (\w+(?:\.\w+)*)\.Stub` or `ServiceName.Stub.method_name` patterns
- Create `calls_grpc` edges: source=repo, target=service (looked up by name)

### Surgical Indexing Compatibility

All new extractor output MUST flow through the existing surgical pipeline pattern:
1. Extractors run on ALL branch files in both modes
2. Pipeline filters output to `changedSet` files for surgical persist
3. Entities have `source_file`/`file_id` for file-level cleanup
4. Edges always re-derived repo-wide after surgical persist

**Gap identified:** The `services` table has no `source_file` or `file_id` column. For surgical indexing of gRPC services, either:
- (a) Add V5 migration with `source_file` and `file_id` to services table, and update `clearRepoFiles()` to handle services
- (b) Always wipe and re-insert all services during surgical mode (simpler, acceptable since proto service count per repo is small)

**Recommendation:** Option (b) — wipe all repo services in surgical mode. Proto files rarely change individually, and the service count per repo is tiny (1-5). This avoids a schema migration.

### GraphQL Entity Storage (Claude's Discretion)

**Recommendation: Use modules table**, not services table.

Rationale:
- GraphQL types/queries/mutations are file-level entities with `source_file` — modules table already handles this
- Services table is for service-level entities (gRPC services, API endpoints) — not type definitions
- Modules table has `file_id` FK for surgical cleanup; services table does not
- Module `type` field can be set to `graphql_type`, `graphql_query`, `graphql_mutation`, `graphql_input`
- Module `summary` field captures the fields as text summary
- This avoids needing a V5 migration to add `file_id` to services

### gRPC RPC Method Storage (Claude's Discretion)

**Recommendation: JSON in description field.**

Format: `gRPC service with RPCs: CreateBooking(CreateBookingRequest) -> CreateBookingResponse, CancelBooking(...) -> ...`

Rationale:
- Human-readable in `kb search` output
- Searchable via FTS (method names appear in text)
- No schema change needed — uses existing `description` column
- JSON array alternative (`[{name, input, output}]`) is less FTS-friendly

### Absinthe Query/Mutation Spanning Files (Claude's Discretion)

**Recommendation:** Extract from the root schema file (the one with `use Absinthe.Schema` and `query do`/`mutation do` blocks) as well as individual type files (ones with `use Absinthe.Schema.Notation` and `object :name do` blocks). Don't try to resolve `import_types`/`import_fields` — just capture what's explicitly defined in each file. This matches how the existing elixir.ts extractor works (per-file, no cross-file resolution).

### Event Catalog Frontmatter Mapping (Claude's Discretion)

**Recommendation based on actual catalog structure:**

The EventCatalog v2 (core 2.60.0) frontmatter format:
```yaml
---
id: 'event:payment-failed'
name: Payment Failed
version: 1.0.0
summary: An event for Payment Failed
owners:
  - team-xd
repository:
  url: 'https://github.com/surgeventures/app-payments'
channels:
  - id: 'channel:payments-payment-events'
---
```

Mapping:
- **owner_team**: `owners[0]` from event MDX frontmatter (first owner). Strip `team-` prefix if desired, or keep as-is for consistency with catalog.
- **domain**: Derived by traversing domain MDX files. Each domain lists `services:` with IDs, and each service lists `sends:` with event IDs. Build a lookup: `event_id -> service_id -> domain_id`. This requires reading domain + service MDX files too.

**Simpler alternative for domain:** Since domains contain services which contain events, and the event `owners:` maps to a team, we can derive domain from: find the service whose `repository.url` matches the event's `repository.url`, then find the domain containing that service. This is fragile though.

**Simplest viable approach:** Parse domain MDX frontmatter to build `domain_name -> [service_ids]` map. Parse service MDX frontmatter to build `service_id -> [event_ids_sent]` map. Invert to get `event_id -> domain_name`. This is 100% deterministic from the catalog data.

### Event Catalog Matching Strategy (CRITICAL RESEARCH FINDING)

The CONTEXT.md states "match catalog events to proto events by exact name match (CamelCase proto message names)." This is **partially incorrect** based on actual data:

- **1,120 of 7,469 events** (15%) in the KB are named `Payload` — their identity is in the `source_file` path
- Event catalog IDs are kebab-case: `event:payment-failed`
- Proto message names are CamelCase: `PaymentFailed` (when not `Payload`)
- Proto source_file paths contain snake_case: `.../payment_failed/...`

**Recommended multi-strategy matching:**
1. **Name match (primary):** Convert catalog ID `event:payment-failed` to CamelCase `PaymentFailed`. Search events by `name = 'PaymentFailed'` or `name LIKE '%PaymentFailed%Payload'`. This catches the 85% of events with meaningful names.
2. **Path match (fallback):** Convert catalog ID to snake_case `payment_failed`. Search events by `source_file LIKE '%payment_failed%'` AND `name = 'Payload'`. This catches the remaining 15%.
3. **Skip if no match:** Catalog entries with no matching KB event are silently skipped (catalog may be stale).

### Transaction Strategy for Event Catalog (Claude's Discretion)

**Recommendation:** Single transaction wrapping all event catalog enrichment UPDATEs.

Rationale:
- Enrichment is ~260 catalog events, each doing 1-2 UPDATE queries
- Total: ~500-1000 lightweight UPDATE statements
- Single transaction is fast (~10ms) and atomic (all-or-nothing enrichment)
- No risk of partial enrichment leaving inconsistent data

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter parsing | Custom YAML parser | Simple regex for `---` blocks + line-by-line key extraction | EventCatalog frontmatter is flat YAML (no nesting beyond arrays); full YAML parser (js-yaml) is overkill and adds a dependency |
| GraphQL SDL parsing | Full GraphQL parser | Regex for top-level `type`, `query`, `mutation`, `input` blocks | The Out of Scope doc explicitly says "AST-based parsing — regex sufficient for well-structured... GraphQL macros" |
| Ecto field type mapping | Elixir type system | Direct string capture of `:string`, `:integer`, etc. | We only need the type name as text for the JSON schema_fields column |
| gRPC service discovery across repos | Custom service registry | Match by proto service name in DB | Services table indexed by (repo_id, name); simple SELECT to find target |

**Key insight:** Every extractor in this phase is regex-based by design (project decision: no AST parsing). The patterns are well-structured macro/definition blocks, not arbitrary code. Regex is the correct tool.

## Common Pitfalls

### Pitfall 1: Ecto Association Target Resolution
**What goes wrong:** `belongs_to :user, MyApp.Accounts.User` — the target module name is `MyApp.Accounts.User`, but edges need to reference module IDs. The target module may not exist in the same repo (cross-repo schemas).
**Why it happens:** Associations reference Elixir module names, not DB IDs. The target module may be in a different repo or may use an alias.
**How to avoid:** Create edges using module names as lookup keys. If target module not found in DB, skip the edge (don't create phantom modules). Log/warn for debugging.
**Warning signs:** Edges with null target IDs, or edges pointing to modules that don't exist.

### Pitfall 2: Regex Greediness on Ecto Schema Blocks
**What goes wrong:** The regex for `schema "table" do ... end` might match too much content if there are nested `do...end` blocks inside the schema.
**Why it happens:** Ecto schemas can contain `field`, `timestamps()`, `belongs_to`, and embedded blocks — all with their own `do...end` pairs.
**How to avoid:** Use the existing `moduleContent` slice (already scoped to a single defmodule) and extract fields line-by-line from within the schema block, rather than trying to match the full block boundary.
**Warning signs:** Fields from one schema appearing in another, or associations from outside the schema block being captured.

### Pitfall 3: GraphQL SDL Encoding Variations
**What goes wrong:** Some `.graphql` files use `type Query { ... }` while others use `extend type Query { ... }`. Some define scalars, enums, unions, interfaces.
**Why it happens:** SDL is flexible — there's no single canonical structure.
**How to avoid:** Match all top-level keywords: `type`, `input`, `enum`, `interface`, `union`, `scalar`, `extend type`. For the `extend` case, treat as a regular type but note it's an extension.
**Warning signs:** Missing types from SDL files, or types with duplicate names from extend blocks.

### Pitfall 4: Event Catalog "Payload" Collision
**What goes wrong:** Multiple events from different repos are all named `Payload`. Enrichment UPDATE matches the wrong one.
**Why it happens:** The proto convention uses `Payload` as the generic message name, with identity in the package/path.
**How to avoid:** When matching by source_file path, always scope to the specific repo (via repo_id or repo_name from the catalog's `repository.url` field). Never do an unscoped UPDATE on name alone.
**Warning signs:** Events getting wrong domain/owner_team assignments.

### Pitfall 5: Surgical Mode Missing Service Cleanup
**What goes wrong:** After surgical re-index, stale gRPC service entries remain because `clearRepoFiles()` doesn't handle the services table.
**Why it happens:** Services table has no `file_id` or `source_file` column for file-level cleanup.
**How to avoid:** In surgical mode, wipe all repo services and re-insert from full extractor output (services count is small per repo, ~1-5). Add service deletion to the surgical persist path.
**Warning signs:** Duplicate service rows, or old service definitions persisting after proto file deletion.

### Pitfall 6: FTS Index Not Updated for New Columns
**What goes wrong:** New data (table_name, schema_fields, GraphQL types) exists in the DB but doesn't appear in `kb search` results.
**Why it happens:** FTS index only contains `name` and `description`. New data stored in other columns won't be searched unless we update what goes into FTS.
**How to avoid:** Include relevant new data in the FTS `description` field. For example, include table_name in the FTS description for modules with Ecto schemas. Include gRPC service RPC methods in the FTS description.
**Warning signs:** `kb search "bookings"` (a table name) returns nothing even though the Ecto schema is indexed.

## Code Examples

### Ecto Schema Field Extraction (regex pattern)
```typescript
// Extract fields from within a schema block
// Already have moduleContent scoped to a single defmodule

// Detect schema block
const schemaMatch = moduleContent.match(/schema\s+"(\w+)"\s+do([\s\S]*?)(?:^  end|\bend\b)/m);
if (!schemaMatch) return;

const tableName = schemaMatch[1]; // "bookings"
const schemaBody = schemaMatch[2];

// Extract fields: field :name, :type or field(:name, :type)
const fieldRe = /field[( ]+:(\w+),\s*:?(\w[\w.]*)/g;
const fields: {name: string, type: string}[] = [];
let m;
while ((m = fieldRe.exec(schemaBody)) !== null) {
  fields.push({ name: m[1], type: m[2] });
}

// Extract associations
const assocRe = /(belongs_to|has_many|has_one|many_to_many)[( ]+:(\w+),\s*(\w[\w.]*)/g;
while ((m = assocRe.exec(schemaBody)) !== null) {
  // m[1] = association type, m[2] = field name, m[3] = target module
}
```

### GraphQL SDL Top-Level Extraction (regex pattern)
```typescript
// Match: type TypeName { ... }, input InputName { ... }, etc.
const typeRe = /^(?:extend\s+)?(type|input|enum|interface|union|scalar)\s+(\w+)\s*(?:\{([^}]*)\}|)/gm;

let match;
while ((match = typeRe.exec(content)) !== null) {
  const kind = match[1]; // "type", "input", "enum", etc.
  const name = match[2]; // "BookingType"
  const body = match[3] || ''; // field definitions as text
}
```

### Absinthe Macro Detection (regex pattern)
```typescript
// Absinthe object/input_object macros
const absintheObjectRe = /(object|input_object)\s+:(\w+)\s+do\b/g;
// Absinthe query/mutation root blocks
const absintheRootRe = /(query|mutation)\s+do\b/g;

// Inside parseElixirFile's module loop:
let m;
absintheObjectRe.lastIndex = 0;
while ((m = absintheObjectRe.exec(moduleContent)) !== null) {
  // m[1] = "object" or "input_object"
  // m[2] = type name (atom without colon)
  // Capture body between this "do" and its matching "end" for summary
}
```

### gRPC Stub Detection (regex pattern)
```typescript
// Pattern 1: Direct stub calls
// e.g., BookingService.Stub.create_booking(channel, request)
const stubCallRe = /(\w+(?:\.\w+)*)\.Stub\.(\w+)\s*\(/g;

// Pattern 2: RpcClient.Client usage (generated files)
// e.g., use RpcClient.Client, service: Rpc.Appointments.V1.RPCService, stub: Rpc.Appointments.V1.RPCService.Stub
const rpcClientRe = /use\s+RpcClient\.(?:Client|MockableRpcClient)[^]*?(?:stub|service):\s*(\w+(?:\.\w+)*)/g;

// Pattern 3: Module attribute injection (actual call sites)
// e.g., @platform_rpc Application.compile_env!(:resources, [:platform_rpc])
// Then: @platform_rpc.get_provider_language!(request)
// This is too indirect to reliably trace to a specific gRPC service
// SKIP pattern 3 — focus on patterns 1 and 2
```

### Event Catalog Frontmatter Parsing
```typescript
// Parse MDX frontmatter (between --- markers)
function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const yaml = match[1];
  const result: Record<string, unknown> = {};

  // Simple line-by-line YAML extraction (flat keys + arrays)
  let currentKey = '';
  for (const line of yaml.split('\n')) {
    const kvMatch = line.match(/^(\w+):\s*(.+)?$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2]?.trim();
      if (value && !value.startsWith('-')) {
        result[currentKey] = value.replace(/^['"]|['"]$/g, '');
      } else if (!value) {
        result[currentKey] = [];
      }
    } else if (line.match(/^\s+-\s+(.+)/) && Array.isArray(result[currentKey])) {
      const item = line.match(/^\s+-\s+(.+)/)?.[1]?.trim().replace(/^['"]|['"]$/g, '');
      if (item) (result[currentKey] as string[]).push(item);
    }
  }
  return result;
}
```

### Event Catalog Event-to-KB Matching
```typescript
// Convert catalog event ID to matching patterns
function catalogIdToMatchers(catalogId: string): { camelCase: string; snakeCase: string } {
  // "event:payment-failed" -> "payment-failed"
  const slug = catalogId.replace(/^event:/, '');

  // kebab to CamelCase: "payment-failed" -> "PaymentFailed"
  const camelCase = slug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');

  // kebab to snake_case: "payment-failed" -> "payment_failed"
  const snakeCase = slug.replace(/-/g, '_');

  return { camelCase, snakeCase };
}

// Match strategy:
// 1. SELECT id FROM events WHERE name = ? (camelCase)
// 2. SELECT id FROM events WHERE name LIKE ? ('%' + camelCase + '%')
// 3. SELECT id FROM events WHERE source_file LIKE ? ('%' + snakeCase + '%') AND name = 'Payload'
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Proto services parsed but discarded | Proto services persisted to DB | Phase 8 | `kb search` returns gRPC service definitions |
| Elixir modules have type + table_name only | Modules include schema_fields + associations | Phase 8 | Ecto schema structure visible in KB |
| Events have name + schema_definition only | Events enriched with domain + owner_team | Phase 8 | Team ownership queryable |
| No GraphQL awareness | GraphQL types/queries/mutations extracted | Phase 8 | `kb search` finds GraphQL definitions |

## Open Questions

1. **Event Catalog matching accuracy**
   - What we know: 85% of events have meaningful CamelCase names; 15% are `Payload`
   - What's unclear: What percentage of catalog events will successfully match to KB events? Some catalog events may reference proto files from repos not indexed by KB.
   - Recommendation: Log match statistics during enrichment (matched/unmatched counts). Accept partial enrichment as valid — this is best-effort.

2. **gRPC client call detection coverage**
   - What we know: The codebase uses `RpcClient.Client`/`MockableRpcClient` wrappers, not raw `Stub.method()` calls at most call sites
   - What's unclear: Whether detecting `use RpcClient.Client, stub: X.Stub` in generated `.pb.ex` files gives us the same information as detecting actual call sites (it tells us "this repo CAN call service X" not "this repo DOES call service X")
   - Recommendation: Detect stub references in generated files as a proxy for "calls_grpc". It's not perfect but captures the dependency relationship, which is what the KB is for. The generated client module only exists if the service actually uses that gRPC client.

3. **Services table surgical cleanup**
   - What we know: Services table lacks `file_id`/`source_file`; `clearRepoFiles` doesn't touch services
   - What's unclear: Whether a V5 migration is worth it vs. simpler full-wipe approach for services
   - Recommendation: Full wipe of repo services in surgical mode (documented in Architecture Patterns above). Proto service count per repo is 1-5; the cost is negligible.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/indexer/elixir.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EXT-01 | gRPC services persisted from proto | unit + integration | `npx vitest run tests/indexer/pipeline.test.ts -t "grpc"` | Partially (pipeline.test.ts exists, no gRPC tests) |
| EXT-02 | Ecto schema fields + associations extracted | unit | `npx vitest run tests/indexer/elixir.test.ts -t "ecto"` | Partially (elixir.test.ts exists, only table_name test) |
| EXT-03 | GraphQL SDL types extracted | unit | `npx vitest run tests/indexer/graphql.test.ts` | No - Wave 0 |
| EXT-04 | Absinthe macros extracted | unit | `npx vitest run tests/indexer/elixir.test.ts -t "absinthe"` | No - Wave 0 |
| EXT-05 | Event Catalog enrichment | unit + integration | `npx vitest run tests/indexer/catalog.test.ts` | No - Wave 0 |
| EXT-06 | gRPC client call edges detected | unit | `npx vitest run tests/indexer/elixir.test.ts -t "grpc"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/indexer/` (all indexer tests)
- **Per wave merge:** `npx vitest run` (full suite, 197+ tests)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/indexer/graphql.test.ts` — covers EXT-03 (parseGraphqlFile, extractGraphqlDefinitions)
- [ ] `tests/indexer/catalog.test.ts` — covers EXT-05 (parseFrontmatter, enrichFromEventCatalog, matching logic)
- [ ] Add Ecto field/association tests to `tests/indexer/elixir.test.ts` — covers EXT-02
- [ ] Add Absinthe macro tests to `tests/indexer/elixir.test.ts` — covers EXT-04
- [ ] Add gRPC stub detection tests to `tests/indexer/elixir.test.ts` — covers EXT-06
- [ ] Add gRPC service persistence tests to `tests/indexer/pipeline.test.ts` — covers EXT-01
- [ ] Add service cleanup to `tests/indexer/writer.test.ts` — covers surgical mode

## Sources

### Primary (HIGH confidence)
- **Codebase inspection**: All source files in `src/indexer/`, `src/db/`, `src/search/`, `src/types/` read and analyzed
- **Actual EventCatalog repo** (`~/Documents/Repos/fresha-event-catalog/`): inspected frontmatter format, file structure, v2.60.0 core version, event naming conventions
- **Actual service repos**: inspected gRPC client patterns, Ecto schema patterns, Absinthe usage, GraphQL SDL files
- **KB database**: queried to verify event name distribution (7,469 total: 6,349 named, 1,120 Payload)

### Secondary (MEDIUM confidence)
- gRPC client call detection patterns — based on observed patterns in a few repos; may not cover all variations across all repos

### Tertiary (LOW confidence)
- EventCatalog domain->service->event chain for domain derivation — verified file structure but not tested end-to-end enrichment logic; some events may not have traceable domain paths

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all based on existing codebase patterns, no new dependencies needed
- Architecture: HIGH - extending established extractor/pipeline/writer pattern
- Pitfalls: HIGH - identified from actual codebase investigation (Payload naming, surgical gaps, etc.)
- Event Catalog matching: MEDIUM - multi-strategy approach is sound but needs real-world validation of match rates

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable — all based on existing codebase, no external dependency changes expected)
