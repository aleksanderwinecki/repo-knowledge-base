# Phase 3: Search - Context

**Gathered:** 2026-03-05
**Status:** Ready for planning

<domain>
## Phase Boundary

Query layer over indexed data: full-text search, structured entity queries, and dependency lookups with contextual results. This phase builds the search engine; CLI and MCP wrapping are Phase 4.

Requirements: SRCH-01, SRCH-02, SRCH-03, SRCH-04

</domain>

<decisions>
## Implementation Decisions

### Result context & shape
- Text search returns snippet (matching line + ~3-5 lines surrounding context) plus metadata (repo name, file path, entity type)
- Plain text results — no FTS5 highlight markers; formatting is Phase 4's concern
- Entity queries return structured "entity card" objects: entity name, type, repo, file path, relationship direction, plus relevant code snippet
- Default 20 results per query; caller can override

### Query interface design
- Separate functions per query type: `searchText()`, `findEntity()`, `queryDependencies()`
- Text search accepts FTS5 match syntax directly (AND, OR, NOT, phrase matching) — plain text also works as-is
- Entity queries use name + optional filter object: `findEntity('BookingCreated', {type: 'event', relationship: 'consumers'})`
- All search functions accept optional repo filter to scope results
- Text search supports optional entity type filter to scope FTS to specific content types

### Ranking & relevance
- FTS5 built-in BM25 ranking only — no custom scoring logic
- No cross-function deduplication at search layer; caller handles if needed
- Entity and dependency results sorted grouped by repo, then alphabetical within each group

### Dependency traversal
- Configurable depth: default to direct dependencies (depth 1), accept depth parameter (1, 2, or 'all')
- Results include connection mechanism (Kafka, gRPC, direct call) — e.g., 'payments -> BookingCreated (Kafka consumer)'
- Both directions supported: upstream ('what does X depend on') and downstream ('what depends on X') via direction parameter
- Multi-hop traversals show full path with intermediate steps: payments -> BookingCreated (Kafka) -> booking-service -> AppointmentUpdated (Kafka) -> appointments-service

### Claude's Discretion
- Internal query building and FTS5 optimization
- Error handling for malformed queries
- Exact snippet extraction algorithm (how to determine the ~3-5 line window)
- Cycle detection in dependency graph traversal

</decisions>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-search*
*Context gathered: 2026-03-05*
