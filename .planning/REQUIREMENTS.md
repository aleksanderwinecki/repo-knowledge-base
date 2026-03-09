# Requirements: Repo Knowledge Base

**Defined:** 2026-03-09
**Core Value:** Eliminate the repeated cost of AI agents re-learning codebase architecture every session

## v3.0 Requirements

Requirements for Graph Intelligence milestone. Each maps to roadmap phases.

### Graph Infrastructure

- [x] **GRAPH-01**: Graph module builds in-memory forward and reverse adjacency lists from a single bulk SQL query
- [x] **GRAPH-02**: BFS downstream traversal returns all reachable nodes with depth tracking
- [x] **GRAPH-03**: Shortest path returns ordered hop list between any two services
- [x] **GRAPH-04**: Event/Kafka intermediate nodes are resolved transparently (two-hop repo->event->repo collapsed to single logical edge)
- [x] **GRAPH-05**: Shared edge utilities (confidence extraction, mechanism formatting, metadata parsing) extracted from dependencies.ts into reusable module

### Impact Analysis

- [x] **IMPACT-01**: Agent can query blast radius for any service via MCP tool `kb_impact` or CLI `kb impact`
- [x] **IMPACT-02**: Results grouped by depth with mechanism labels and confidence per affected service
- [x] **IMPACT-03**: Optional `--mechanism` filter limits traversal to specific edge types (grpc, http, kafka, event, gateway)
- [x] **IMPACT-04**: Optional `--depth` limit caps traversal depth (default: 3)
- [x] **IMPACT-05**: Severity tiers classify affected services as direct, indirect, or transitive
- [x] **IMPACT-06**: Response includes aggregated mechanism summary and blast radius score in stats block
- [x] **IMPACT-07**: Compact response formatter fits 300+ affected services within 4KB MCP cap

### Flow Tracing

- [x] **TRACE-01**: Agent can find shortest path between two services via MCP tool `kb_trace` or CLI `kb trace`
- [x] **TRACE-02**: Response includes ordered hop list with mechanism per hop and a path_summary string
- [x] **TRACE-03**: Distinct error responses for "service not found" vs "no path exists"
- [x] **TRACE-04**: Each hop annotated with confidence level; response includes min-path confidence (weakest link)

### Service Explanation

- [ ] **EXPLAIN-01**: Agent can get a structured service card via MCP tool `kb_explain` or CLI `kb explain`
- [ ] **EXPLAIN-02**: Card includes service identity, description, inbound/outbound connections grouped by mechanism
- [ ] **EXPLAIN-03**: Card includes events produced/consumed, entity counts by type, and repo metadata
- [ ] **EXPLAIN-04**: Card includes "talks to" / "called by" summaries and top modules by type
- [ ] **EXPLAIN-05**: Card includes next-step hints for agents (e.g., "Run kb_impact app-payments to see blast radius")

## Future Requirements

Deferred to post-v3.0 milestones. Tracked but not in current roadmap.

### Advanced Graph

- **AGRAPH-01**: Multiple path discovery (top N paths) in kb_trace
- **AGRAPH-02**: `--detail` flag for rich path data in kb_impact
- **AGRAPH-03**: Architecture rules engine ("X should not call Y")
- **AGRAPH-04**: Historical graph comparison / snapshots
- **AGRAPH-05**: Code-level (function granularity) impact analysis
- **AGRAPH-06**: Graph caching layer for sub-millisecond repeated queries

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Neo4j integration | SQLite handles 12K edges in <10ms; zero-dependency philosophy |
| Tree-sitter AST parsing | Regex extractors sufficient for well-structured source |
| Architecture rules engine | Separate milestone after graph tools prove value |
| Real-time file watching | On-demand reindex is sufficient |
| Graph visualization UI | CLI + MCP only |
| Graph database migration | SQLite recursive CTEs + JS BFS cover all use cases at current scale |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| GRAPH-01 | Phase 23 | Complete |
| GRAPH-02 | Phase 23 | Complete |
| GRAPH-03 | Phase 23 | Complete |
| GRAPH-04 | Phase 23 | Complete |
| GRAPH-05 | Phase 23 | Complete |
| IMPACT-01 | Phase 24 | Complete |
| IMPACT-02 | Phase 24 | Complete |
| IMPACT-03 | Phase 24 | Complete |
| IMPACT-04 | Phase 24 | Complete |
| IMPACT-05 | Phase 24 | Complete |
| IMPACT-06 | Phase 24 | Complete |
| IMPACT-07 | Phase 24 | Complete |
| TRACE-01 | Phase 25 | Complete |
| TRACE-02 | Phase 25 | Complete |
| TRACE-03 | Phase 25 | Complete |
| TRACE-04 | Phase 25 | Complete |
| EXPLAIN-01 | Phase 26 | Pending |
| EXPLAIN-02 | Phase 26 | Pending |
| EXPLAIN-03 | Phase 26 | Pending |
| EXPLAIN-04 | Phase 26 | Pending |
| EXPLAIN-05 | Phase 26 | Pending |

**Coverage:**
- v3.0 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0

---
*Requirements defined: 2026-03-09*
*Last updated: 2026-03-09 after roadmap creation*
