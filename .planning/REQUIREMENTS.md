# Requirements: Repo Knowledge Base

**Defined:** 2026-03-05
**Core Value:** Eliminate repeated cost of AI agents re-learning codebase architecture every session

## v1 Requirements

### Storage

- [ ] **STOR-01**: SQLite database stores all indexed knowledge in a single file
- [ ] **STOR-02**: Schema supports repos, files, modules, events, services, and relationships between them
- [ ] **STOR-03**: FTS5 full-text search over indexed content
- [ ] **STOR-04**: Per-repo metadata tracks last indexed git commit for incremental updates

### Indexing

- [ ] **IDX-01**: Scan all repos under a configurable root directory (default ~/Documents/Repos/)
- [ ] **IDX-02**: Extract repo metadata: name, description (from README/CLAUDE.md), tech stack, key files
- [ ] **IDX-03**: Extract Elixir module definitions and their responsibilities
- [ ] **IDX-04**: Extract proto file definitions (event schemas, service definitions)
- [ ] **IDX-05**: Extract Kafka event producer/consumer relationships from code
- [ ] **IDX-06**: Incremental re-indexing: only process repos with new commits since last index
- [ ] **IDX-07**: Per-repo error isolation: one repo failing doesn't block others

### Search

- [ ] **SRCH-01**: Text search across all indexed content ("booking cancellation")
- [ ] **SRCH-02**: Structured entity queries ("which services consume BookingCreated?")
- [ ] **SRCH-03**: Service dependency queries ("what does payments-service depend on?")
- [ ] **SRCH-04**: Search results include file paths, repo names, and relevant context

### Interface

- [ ] **INTF-01**: CLI tool for indexing, querying, and learning
- [ ] **INTF-02**: MCP server exposable to Claude Code for mid-conversation queries
- [ ] **INTF-03**: Human-readable output formatting for CLI results
- [ ] **INTF-04**: MCP responses sized appropriately (under 4KB, well-structured summaries)

### Knowledge

- [ ] **KNOW-01**: Manual knowledge injection via CLI ("learn" command)
- [ ] **KNOW-02**: Learned facts stored persistently and searchable alongside indexed data
- [ ] **KNOW-03**: Service relationship graph queryable (service → events → consumers)

### MCP Server

- [x] **MCP-01**: MCP server exposing search, deps, entity lookup, and learn/forget as tools
- [x] **MCP-02**: MCP responses are concise (<4KB), well-structured summaries suitable for LLM consumption
- [x] **MCP-03**: Auto-sync: server detects stale indexes and re-indexes repos with new commits when queried
- [x] **MCP-04**: Data hygiene: server can identify and clean outdated/wrong facts (e.g., repos that no longer exist, stale learned facts)
- [x] **MCP-05**: Installable via claude_desktop_config.json or Claude Code MCP settings with zero manual config beyond initial setup

## v2 Requirements

### Semantic Search

- **SEM-01**: Embedding-based semantic search for natural language queries
- **SEM-02**: Code-aware embeddings (handles CamelCase, snake_case, module names)

### Extended Extractors

- **EXT-01**: Extract GraphQL schema definitions (types, queries, mutations)
- **EXT-02**: Extract gRPC service definitions
- **EXT-03**: Extract Ecto schemas and database structure
- **EXT-04**: Extract from Event Catalog as supplementary data source

### Intelligence

- **INT-01**: Auto-learn patterns from completed tasks ("adding event field touched these files")
- **INT-02**: Suggest relevant repos/files when given a feature description
- **INT-03**: Cross-repo impact analysis ("if I change this proto, what breaks?")

## Out of Scope

| Feature | Reason |
|---------|--------|
| Full AI orchestrator / task executor | Separate project, builds on this knowledge layer |
| PR creation or code generation | This is knowledge, not action |
| UI dashboard | CLI + MCP only for v1 |
| Real-time file watching | On-demand re-index is sufficient |
| Cloud deployment | Local-only tool |
| Vector DB infrastructure | SQLite FTS5 sufficient for ~50 repos |
| Code review or linting | Out of domain |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| STOR-01 | Phase 1 | Pending |
| STOR-02 | Phase 1 | Pending |
| STOR-03 | Phase 1 | Pending |
| STOR-04 | Phase 1 | Pending |
| IDX-01 | Phase 2 | Pending |
| IDX-02 | Phase 2 | Pending |
| IDX-03 | Phase 2 | Pending |
| IDX-04 | Phase 2 | Pending |
| IDX-05 | Phase 2 | Pending |
| IDX-06 | Phase 2 | Pending |
| IDX-07 | Phase 2 | Pending |
| SRCH-01 | Phase 3 | Pending |
| SRCH-02 | Phase 3 | Pending |
| SRCH-03 | Phase 3 | Pending |
| SRCH-04 | Phase 3 | Pending |
| INTF-01 | Phase 4 | Pending |
| INTF-02 | Phase 4 | Pending |
| INTF-03 | Phase 4 | Pending |
| INTF-04 | Phase 4 | Pending |
| KNOW-01 | Phase 4 | Pending |
| KNOW-02 | Phase 4 | Pending |
| KNOW-03 | Phase 4 | Pending |
| MCP-01 | Phase 5 | Complete |
| MCP-02 | Phase 5 | Complete |
| MCP-03 | Phase 5 | Complete |
| MCP-04 | Phase 5 | Complete |
| MCP-05 | Phase 5 | Complete |

**Coverage:**
- v1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-03-05*
*Last updated: 2026-03-05 after roadmap creation*
