# Requirements: Repo Knowledge Base

**Defined:** 2026-03-08
**Core Value:** Eliminate the repeated cost of AI agents re-learning the same codebase architecture every session

## v2.1 Requirements

Requirements for v2.1 Cleanup & Tightening. Each maps to roadmap phases.

### Cleanup

- [ ] **CLEAN-01**: Remove `src/embeddings/` directory (pipeline.ts, generate.ts, text.ts)
- [ ] **CLEAN-02**: Remove sqlite-vec extension loading (src/db/vec.ts) and vec0 migration (V8)
- [ ] **CLEAN-03**: Remove `@huggingface/transformers` and `sqlite-vec` npm dependencies
- [ ] **CLEAN-04**: Remove `searchSemantic`, `searchHybrid` from search layer — default search uses FTS5 only
- [ ] **CLEAN-05**: Remove `--semantic` CLI flag, `--embed` CLI flag, and `kb_semantic` MCP tool
- [ ] **CLEAN-06**: Remove all embedding-related tests and update test counts in docs

### Fix

- [ ] **FIX-01**: `kb index --repo <name>` implies force (skip staleness check) — explicit `--force` not required
- [ ] **FIX-02**: Scanner follows symlinks when discovering repos under root directory

### Meta

- [ ] **META-01**: PROJECT.md constraints, context, and stats reflect current reality (400 repos, correct tool/test counts)

## v2.0 Requirements (Complete)

### Service Topology

- [x] **TOPO-01**: gRPC client/server call extraction across all repos (proto imports, service stubs)
- [x] **TOPO-02**: HTTP client module extraction (Tesla/HTTPoison base_url, endpoint patterns)
- [x] **TOPO-03**: Gateway routing config extraction (compose/services definitions, schema sources)
- [x] **TOPO-04**: Kafka producer/consumer wiring extraction (topic names, handler modules)
- [x] **TOPO-05**: Dependency query generalization — traverse all edge types (gRPC, HTTP, gateway, Kafka), not just events
- [x] **TOPO-06**: `--mechanism` filter on `kb deps` to filter by communication type (grpc, http, kafka, event, gateway)
- [x] **TOPO-07**: Confidence levels on topology edges (high for gRPC/proto, medium for gateway, low for HTTP regex)

### Semantic Search

- [x] **SEM-01**: sqlite-vec integration — load native extension into better-sqlite3, validate macOS ARM64
- [x] **SEM-02**: Embedding generation pipeline — nomic-embed-text-v1.5 via Transformers.js, 256d Matryoshka, post-persistence phase
- [x] **SEM-03**: Code-aware embedding text preprocessing — reuse tokenizeForFts() for CamelCase/snake_case splitting
- [x] **SEM-04**: KNN vector similarity search — `kb search --semantic "query"` returns nearest entities
- [x] **SEM-05**: Hybrid FTS5 + vector search with RRF scoring — combines keyword and semantic results
- [x] **SEM-06**: Graceful degradation — falls back to FTS5-only when sqlite-vec unavailable or embeddings not generated
- [x] **SEM-07**: `kb_semantic` MCP tool for natural language queries from AI agents

### Targeted Reindexing

- [x] **RIDX-01**: `kb index --repo <name>` indexes only targeted repo(s), filtering discoverRepos output by basename
- [x] **RIDX-02**: `gitRefresh()` fetches from origin and resets local default branch to match remote (fetch + reset --hard)
- [x] **RIDX-03**: `--refresh` CLI flag triggers git refresh before indexing (works with or without `--repo`)
- [x] **RIDX-04**: Git refresh handles errors gracefully — no remote, dirty working tree, fetch timeout all return error instead of crashing
- [x] **RIDX-05**: `kb_reindex` MCP tool accepts repo names and triggers targeted reindex with optional git refresh

## Future Requirements

### Ownership

- **OWN-01**: CODEOWNERS file parsing and storage
- **OWN-02**: Team-based ownership queries ("who owns app-customers?")
- **OWN-03**: File-level ownership resolution with last-match-wins semantics

### Intelligence

- **INT-01**: Auto-learn patterns from completed tasks
- **INT-02**: Suggest relevant repos/files for feature descriptions
- **INT-03**: Cross-repo impact analysis (partially addressed by topology)

### Nomik-Inspired (see nomik.co)

- **NOM-01**: Impact analysis queries — "what breaks if I change this event/service?" using existing topology edges
- **NOM-02**: Flow tracing MCP tool — "trace HTTP request → service → Kafka event → consumer" across topology graph
- **NOM-03**: Tree-sitter AST parsing — replace regex extractors for deeper accuracy and multi-language support (big lift)

## Out of Scope

| Feature | Reason |
|---------|--------|
| AST-based parsing | Deferred to NOM-03; regex sufficient for now, Tree-sitter is future option |
| Real-time file watching | On-demand re-index sufficient for local tool |
| Cloud deployment | Local-only tool, no external infrastructure |
| UI dashboard | CLI + MCP only |
| PR creation or code generation | Knowledge layer, not action layer |
| Embedding/semantic search | Impractical — 1hr generation time, OOM on targeted runs, FTS5 covers 95% of queries |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| TOPO-01 | Phase 16 | Complete |
| TOPO-02 | Phase 16 | Complete |
| TOPO-03 | Phase 16 | Complete |
| TOPO-04 | Phase 16 | Complete |
| TOPO-05 | Phase 17 | Complete |
| TOPO-06 | Phase 17 | Complete |
| TOPO-07 | Phase 17 | Complete |
| SEM-01 | Phase 18 | Complete |
| SEM-02 | Phase 18 | Complete |
| SEM-03 | Phase 18 | Complete |
| SEM-04 | Phase 19 | Complete |
| SEM-05 | Phase 19 | Complete |
| SEM-06 | Phase 19 | Complete |
| SEM-07 | Phase 19 | Complete |
| RIDX-01 | Phase 20 | Complete |
| RIDX-02 | Phase 20 | Complete |
| RIDX-03 | Phase 20 | Complete |
| RIDX-04 | Phase 20 | Complete |
| RIDX-05 | Phase 20 | Complete |
| CLEAN-01 | Phase 21 | Pending |
| CLEAN-02 | Phase 21 | Pending |
| CLEAN-03 | Phase 21 | Pending |
| CLEAN-04 | Phase 21 | Pending |
| CLEAN-05 | Phase 21 | Pending |
| CLEAN-06 | Phase 21 | Pending |
| FIX-01 | Phase 22 | Pending |
| FIX-02 | Phase 22 | Pending |
| META-01 | Phase 22 | Pending |

**Coverage:**
- v2.0 requirements: 19 total (complete)
- v2.1 requirements: 9 total, 9 mapped (0 complete)
- Unmapped: 0

---
*Requirements defined: 2026-03-08*
*Last updated: 2026-03-09 after v2.1 roadmap creation*
