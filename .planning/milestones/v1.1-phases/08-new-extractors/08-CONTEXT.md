# Phase 8: New Extractors - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract GraphQL schemas, gRPC service definitions, Ecto database structures, and Event Catalog domain metadata from indexed repos into the knowledge base. All new extractors must follow the source_file convention and changedFiles filter pattern established in Phase 7 for surgical re-indexing compatibility.

</domain>

<decisions>
## Implementation Decisions

### Ecto schema extraction
- Extend existing `elixir.ts` — add Ecto detection inside parseElixirFile's defmodule loop (single pass over .ex files)
- Only extract `schema "table_name" do` blocks — skip `embedded_schema` (no table, less useful for KB)
- Populate `modules.table_name` with the Ecto schema table name
- Store fields as JSON array of `{name, type}` in `modules.schema_fields` — e.g., `[{"name": "email", "type": "string"}]`
- Associations (`belongs_to`, `has_many`, `has_one`, `many_to_many`) stored as edges in the edges table between modules
- Edge relationship types: `belongs_to`, `has_many`, `has_one`, `many_to_many`

### GraphQL extraction — SDL files
- New `graphql.ts` extractor file for `.graphql` SDL file parsing
- Extract top-level objects only: types, queries, mutations, input types
- Skip individual field-level extraction (fields captured as summary text)
- Storage approach: Claude's discretion (modules table vs services table)

### GraphQL extraction — Absinthe macros
- Add Absinthe macro detection to `elixir.ts` (alongside Ecto, same .ex file pass)
- Extract `object`, `input_object`, `query`, `mutation` macro blocks
- Top-level objects only — skip individual `field` macros (fields captured as summary text)

### gRPC service wiring
- Proto services already parsed (`ProtoService` with RPCs) but not persisted — wire persistence in `pipeline.ts`
- One service row per proto service in services table with `service_type='grpc'`
- RPC methods stored as description or JSON summary on the service row
- No new extractor file — just wiring in pipeline to map ProtoService to writer format

### gRPC client call edges (EXT-06)
- Detect `ServiceName.Stub.method_name(channel, request)` patterns in .ex files — the standard gRPC Elixir client pattern
- Also catch aliased stub modules
- Create `calls_grpc` edges from repo → service (repo-level, not module-level)

### Event Catalog integration
- Auto-discover repo named `fresha-event-catalog` under the indexing root directory
- Post-processing pass: run AFTER all repos are indexed, scan catalog once, enrich matching events across all repos
- Match catalog events to proto events by exact name match (CamelCase proto message names)
- Update `events.domain` and `events.owner_team` columns from catalog frontmatter — enrichment only, no new entity creation
- Catalog entries with no matching proto event: skip silently (catalog may be stale)
- Re-enrich on every full re-index (domain/owner_team wiped with events, re-populated from catalog)
- Handle both EventCatalog v2 and v3 frontmatter formats (unknown which version is used — researcher should validate against actual catalog repo)

### Claude's Discretion
- GraphQL entity storage strategy (modules vs services table)
- How to store gRPC RPC methods on service rows (description text vs JSON)
- Exact regex patterns for Absinthe macro detection
- Exact regex patterns for gRPC stub call detection
- EventCatalog frontmatter field mapping (which fields → domain, which → owner_team)
- How to handle Absinthe query/mutation blocks that span multiple files (resolvers vs schema)
- Transaction strategy for Event Catalog post-processing enrichment

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/indexer/elixir.ts`: `parseElixirFile()` walks defmodule blocks — extend loop to detect Ecto schema/Absinthe macros
- `src/indexer/proto.ts`: `ProtoService` and `ProtoRpc` interfaces already parsed — just not persisted
- `src/indexer/events.ts`: `detectEventRelationships()` pattern for edge creation — reuse for Ecto associations and gRPC calls
- `src/indexer/writer.ts`: `ModuleData`, `EventData`, `EdgeData` interfaces — extend or add `ServiceData`
- `src/db/migrations.ts`: V3 already added `modules.table_name`, `modules.schema_fields`, `services.service_type`, `events.domain`, `events.owner_team`

### Established Patterns
- Extractors: `extract*(repoPath, branch)` → pure data arrays; `parse*(filePath, content)` pure functions
- Pipeline: maps extractor output to writer format, persists via `persistRepoData()`/`persistSurgicalData()`
- Surgical compatibility: entities have `source_file`/`file_id`; pipeline filters by `changedSet` for surgical mode
- LIB_PATH_PATTERNS regex for .ex file filtering (shared between elixir.ts and events.ts)

### Integration Points
- `pipeline.ts:indexSingleRepo()`: add gRPC service persistence, GraphQL extraction calls, Ecto association edge insertion
- `pipeline.ts:indexAllRepos()`: add Event Catalog post-processing pass after repo loop
- `writer.ts`: add service persistence function (upsertService or similar)
- `writer.ts:RepoData`: extend interface to include services array

</code_context>

<specifics>
## Specific Ideas

- Event Catalog repo is named `fresha-event-catalog` (not generic "event-catalog")
- Catalog may be out of date — enrichment is best-effort, proto data is source of truth
- STATE.md flags: "EventCatalog frontmatter fields may vary between v2/v3 — validate against actual catalog repo during Phase 8"

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 08-new-extractors*
*Context gathered: 2026-03-06*
