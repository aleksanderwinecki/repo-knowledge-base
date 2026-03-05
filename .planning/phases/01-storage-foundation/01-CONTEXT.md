# Phase 1: Storage Foundation - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

SQLite database with schema for repos, files, modules, events, services, and their relationships. FTS5 full-text search over indexed content. Per-repo tracking for incremental indexing. This phase delivers the data layer — no indexing logic, no CLI, no MCP.

</domain>

<decisions>
## Implementation Decisions

### Storage Engine
- SQLite via better-sqlite3 (synchronous, fast, zero infrastructure)
- Single .db file, location configurable (default: ~/.repo-knowledge-base/knowledge.db)
- sqlite-vec extension deferred to v2 — FTS5 is sufficient for MVP

### Relationship Model
- Generic edges table: (source_type, source_id, target_type, target_id, relationship_type, source_file)
- Graph-like flexibility within SQLite — enables arbitrary relationship queries via SQL JOINs
- Four relationship types for v1: produces_event, consumes_event, calls_grpc, exposes_graphql
- Minimal edge metadata: source, target, type, and the file path where relationship was found
- Service-level granularity (not module-level) — tracks which service produces/consumes, not which specific module

### Search Strategy
- FTS5 full-text search over: repo descriptions, module/file summaries, event/proto names
- Raw source code NOT indexed in FTS — too noisy, too large
- Custom tokenizer splits on word boundaries: CamelCase → [camel, case], snake_case → [snake, case]
- Searching "booking" should match BookingCreated, booking_service, etc.

### Schema Design
- Core tables: repos, files, modules, services, events
- Relationship table: edges (generic, graph-like)
- FTS virtual table: knowledge_fts (populated from descriptions, summaries, names)
- Metadata: each repo tracks last_indexed_commit SHA for incremental re-index

### Claude's Discretion
- Exact column definitions and data types
- Index strategy beyond FTS5
- Migration/versioning approach for schema changes
- DB file directory creation and permission handling

</decisions>

<specifics>
## Specific Ideas

- The edges table should feel "graph-like" — querying "2 hops from this service" should be possible with recursive CTEs
- FTS tokenizer must handle Elixir conventions: module names (BookingContext.Commands.CreateBooking), function names (handle_event/2), proto message names (BookingCreated)

</specifics>

<deferred>
## Deferred Ideas

- Vector/embedding search (sqlite-vec) — v2 after MVP proves structured search is sufficient
- Module-level relationship tracking — could enrich service-level data later
- Graph visualization of service dependencies — separate tool/phase

</deferred>

---

*Phase: 01-storage-foundation*
*Context gathered: 2026-03-05*
