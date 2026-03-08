# Requirements: Repo Knowledge Base

**Defined:** 2026-03-08
**Core Value:** Eliminate the repeated cost of AI agents re-learning the same codebase architecture every session

## v2.0 Requirements

Requirements for v2.0 Design-Time Intelligence. Each maps to roadmap phases.

### Service Topology

- [ ] **TOPO-01**: gRPC client/server call extraction across all repos (proto imports, service stubs)
- [ ] **TOPO-02**: HTTP client module extraction (Tesla/HTTPoison base_url, endpoint patterns)
- [x] **TOPO-03**: Gateway routing config extraction (compose/services definitions, schema sources)
- [ ] **TOPO-04**: Kafka producer/consumer wiring extraction (topic names, handler modules)
- [ ] **TOPO-05**: Dependency query generalization — traverse all edge types (gRPC, HTTP, gateway, Kafka), not just events
- [ ] **TOPO-06**: `--mechanism` filter on `kb deps` to filter by communication type (grpc, http, kafka, event, gateway)
- [ ] **TOPO-07**: Confidence levels on topology edges (high for gRPC/proto, medium for gateway, low for HTTP regex)

### Semantic Search

- [ ] **SEM-01**: sqlite-vec integration — load native extension into better-sqlite3, validate macOS ARM64
- [ ] **SEM-02**: Embedding generation pipeline — nomic-embed-text-v1.5 via Transformers.js, 256d Matryoshka, post-persistence phase
- [ ] **SEM-03**: Code-aware embedding text preprocessing — reuse tokenizeForFts() for CamelCase/snake_case splitting
- [ ] **SEM-04**: KNN vector similarity search — `kb search --semantic "query"` returns nearest entities
- [ ] **SEM-05**: Hybrid FTS5 + vector search with RRF scoring — combines keyword and semantic results
- [ ] **SEM-06**: Graceful degradation — falls back to FTS5-only when sqlite-vec unavailable or embeddings not generated
- [ ] **SEM-07**: `kb_semantic` MCP tool for natural language queries from AI agents

## Future Requirements

### Ownership

- **OWN-01**: CODEOWNERS file parsing and storage
- **OWN-02**: Team-based ownership queries ("who owns app-customers?")
- **OWN-03**: File-level ownership resolution with last-match-wins semantics

### Intelligence

- **INT-01**: Auto-learn patterns from completed tasks
- **INT-02**: Suggest relevant repos/files for feature descriptions
- **INT-03**: Cross-repo impact analysis (partially addressed by topology)

## Out of Scope

| Feature | Reason |
|---------|--------|
| AST-based parsing | Regex sufficient for well-structured macros; AST adds heavy deps |
| Real-time file watching | On-demand re-index sufficient for local tool |
| Cloud deployment | Local-only tool, no external infrastructure |
| UI dashboard | CLI + MCP only |
| PR creation or code generation | Knowledge layer, not action layer |
| Hybrid search with re-ranking models | Over-engineering; RRF scoring is sufficient |
| Streaming embeddings during index | Decoupled embedding pass avoids blocking extraction pipeline |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TOPO-01 | Phase 16 | Pending |
| TOPO-02 | Phase 16 | Pending |
| TOPO-03 | Phase 16 | Complete |
| TOPO-04 | Phase 16 | Pending |
| TOPO-05 | Phase 17 | Pending |
| TOPO-06 | Phase 17 | Pending |
| TOPO-07 | Phase 17 | Pending |
| SEM-01 | Phase 18 | Pending |
| SEM-02 | Phase 18 | Pending |
| SEM-03 | Phase 18 | Pending |
| SEM-04 | Phase 19 | Pending |
| SEM-05 | Phase 19 | Pending |
| SEM-06 | Phase 19 | Pending |
| SEM-07 | Phase 19 | Pending |

**Coverage:**
- v2.0 requirements: 14 total
- Mapped to phases: 14
- Unmapped: 0

---
*Requirements defined: 2026-03-08*
*Last updated: 2026-03-08 after roadmap creation*
