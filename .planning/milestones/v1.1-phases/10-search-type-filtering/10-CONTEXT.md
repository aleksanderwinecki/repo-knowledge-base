# Phase 10: Search Type Filtering - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Expose granular entity sub-type filtering across CLI, MCP, and search internals. Users can filter search results by specific entity sub-types (e.g., `schema`, `graphql_query`, `grpc`) rather than only coarse types (`module`, `event`, `service`). Includes a type discovery mechanism (`--list-types` / `kb_list_types`).

</domain>

<decisions>
## Implementation Decisions

### Filter taxonomy
- Use exact sub-types from the database as filter values: `schema`, `context`, `command`, `query`, `graphql_type`, `graphql_query`, `graphql_mutation`, `absinthe_object`, `absinthe_query`, `absinthe_mutation`, `grpc`, `module`, etc.
- Single unified `--type` flag accepts both coarse types (`module`, `event`, `service`, `repo`) and granular sub-types (`schema`, `graphql_query`, `grpc`)
- Filtering applies to modules (via `modules.type`) and services (via `services.service_type`). Events do not have a meaningful sub-type dimension yet.
- `--list-types` flag / `kb_list_types` MCP tool for discovering available types dynamically from the database

### Interface design
- CLI: Existing `--type` flag on `kb search` extended to accept sub-types (backward compatible)
- MCP `kb_search`: Add `type` string parameter (currently missing entirely)
- MCP `kb_entity`: Add `type` string parameter (currently missing entirely)
- New `kb_list_types` MCP tool for type discovery
- Entity query mode (`kb search --entity --type schema`) also supports sub-type filtering

### FTS integration
- Store sub-types in FTS `entity_type` column using `parent:subtype` prefix convention (e.g., `module:schema`, `module:graphql_query`, `service:grpc`)
- Coarse type queries (`--type module`) use prefix matching against `module:*`
- Granular type queries (`--type schema`) match the subtype portion
- Scrap old database and rebuild from scratch (no migration needed — just re-index)
- Entities without a meaningful sub-type use `parent:parent` format (e.g., `event:event`, `repo:repo`)

### Result presentation
- Add `subType` field to `TextSearchResult` interface (e.g., `schema`, `graphql_query`, `grpc`)
- Keep existing coarse `entityType` field for backward compatibility
- `--list-types` output grouped by parent type with counts: `module: [schema (142), context (58), ...]`
- Update MCP tool descriptions and kb skill to mention type filtering and discovery

### Claude's Discretion
- Exact FTS prefix matching SQL implementation
- How to parse `parent:subtype` back into separate fields during hydration
- Error messages for invalid type values
- Whether `--list-types` is a subcommand or a flag on search

</decisions>

<specifics>
## Specific Ideas

- "We need a way to filter by entity type - graphql query, dbschema, etc." — primary motivation is distinguishing Phase 8 extractor outputs in search results
- User wants to scrap old DB and rebuild rather than migrate — keep it simple

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `searchText()` in `src/search/text.ts`: Already accepts `entityTypeFilter` — extend to handle sub-types via prefix convention
- `findEntity()` in `src/search/entity.ts`: Already accepts `EntityFilters.type` — extend similarly
- `modules.type` column: Already populated with sub-types (`schema`, `graphql_type`, `absinthe_object`, etc.) by extractors
- `services.service_type` column: Already populated with `grpc`
- `classifyModule()` in `src/indexer/elixir.ts`: Produces module sub-types (schema, context, command, query, module)
- Pipeline in `src/indexer/pipeline.ts`: Produces `graphql_${kind}` and `absinthe_${kind}` sub-types

### Established Patterns
- FTS indexing via `indexEntity()` in `src/db/fts.ts`: Entity type stored as string in `entity_type` column
- CLI command registration pattern in `src/cli/commands/search.ts`: Commander.js with options
- MCP tool registration pattern in `src/mcp/tools/search.ts`: Zod schema + handler function
- `formatResponse()` for MCP response sizing under 4KB

### Integration Points
- `src/db/fts.ts` `indexEntity()`: Change `entity.type` to store `parent:subtype` format
- `src/indexer/writer.ts`: Where FTS entries are created during indexing — must pass sub-type
- `src/search/text.ts` `executeFtsQuery()`: Where FTS `entity_type` filter is applied — update for prefix matching
- `src/search/types.ts`: Add `subType` to `TextSearchResult`
- `src/cli/commands/search.ts`: Extend `--type` validation, add `--list-types`
- `src/mcp/tools/search.ts`: Add `type` parameter to Zod schema
- `src/mcp/tools/entity.ts`: Add `type` parameter to Zod schema
- New file: `src/mcp/tools/list-types.ts` for discovery tool

</code_context>

<deferred>
## Deferred Ideas

- Event filtering by domain or owner_team — could be its own feature/phase
- Group aliases (`graphql` matching all graphql_* sub-types) — not needed with exact sub-types for now

</deferred>

---

*Phase: 10-search-type-filtering*
*Context gathered: 2026-03-07*
