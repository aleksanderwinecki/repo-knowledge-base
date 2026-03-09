# Roadmap: Repo Knowledge Base

## Milestones

- v1.0 MVP -- Phases 1-5 (shipped 2026-03-06)
- v1.1 Improved Reindexing -- Phases 6-10 (shipped 2026-03-07)
- v1.2 Hardening & Quick Wins -- Phases 11-15 (shipped 2026-03-07)
- v2.0 Design-Time Intelligence -- Phases 16-20 (shipped 2026-03-09)
- v2.1 Cleanup & Tightening -- Phases 21-22 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-5) -- SHIPPED 2026-03-06</summary>

- [x] Phase 1: Storage Foundation (1/1 plans) -- completed 2026-03-05
- [x] Phase 2: Indexing Pipeline (2/2 plans) -- completed 2026-03-05
- [x] Phase 3: Search (1/1 plans) -- completed 2026-03-05
- [x] Phase 4: CLI + MCP + Knowledge (2/2 plans) -- completed 2026-03-05
- [x] Phase 5: MCP Server (2/2 plans) -- completed 2026-03-06

</details>

<details>
<summary>v1.1 Improved Reindexing (Phases 6-10) -- SHIPPED 2026-03-07</summary>

- [x] Phase 6: Branch-Aware Tracking & Schema Migration (2/2 plans) -- completed 2026-03-06
- [x] Phase 7: Surgical File-Level Indexing (2/2 plans) -- completed 2026-03-06
- [x] Phase 8: New Extractors (3/3 plans) -- completed 2026-03-06
- [x] Phase 9: Parallel Execution (2/2 plans) -- completed 2026-03-07
- [x] Phase 10: Search Type Filtering (2/2 plans) -- completed 2026-03-07

</details>

<details>
<summary>v1.2 Hardening & Quick Wins (Phases 11-15) -- SHIPPED 2026-03-07</summary>

- [x] Phase 11: Safety Net (2/2 plans) -- completed 2026-03-07
- [x] Phase 12: Database Performance (3/3 plans) -- completed 2026-03-07
- [x] Phase 13: MCP Layer Dedup (2/2 plans) -- completed 2026-03-07
- [x] Phase 14: Core Layer Dedup (3/3 plans) -- completed 2026-03-07
- [x] Phase 15: TypeScript Hardening (2/2 plans) -- completed 2026-03-07

</details>

<details>
<summary>v2.0 Design-Time Intelligence (Phases 16-20) -- SHIPPED 2026-03-09</summary>

- [x] Phase 16: Topology Extraction (3/3 plans) -- completed 2026-03-08
- [x] Phase 17: Topology Query Layer (2/2 plans) -- completed 2026-03-08
- [x] Phase 18: Embedding Infrastructure (2/2 plans) -- completed 2026-03-08
- [x] Phase 19: Semantic Search (2/2 plans) -- completed 2026-03-08
- [x] Phase 20: Targeted Repo Reindex (2/2 plans) -- completed 2026-03-09

</details>

### v2.1 Cleanup & Tightening (In Progress)

**Milestone Goal:** Remove dead embedding infrastructure, fix --repo targeting UX, and update project metadata to reflect current reality.

- [x] **Phase 21: Embedding Removal** - Rip out sqlite-vec, transformers.js, vec0, semantic search, and all related code/tests (completed 2026-03-09)
- [x] **Phase 22: Fixes & Metadata** - Implicit force for --repo, symlink support in scanner, project metadata update (completed 2026-03-09)

## Phase Details

<details>
<summary>Phase 16-20 Details (v2.0 -- complete)</summary>

### Phase 16: Topology Extraction
**Goal**: The knowledge base captures service-to-service communication edges (gRPC, HTTP, gateway routing, Kafka) during indexing
**Depends on**: Phase 15 (v1.2 complete)
**Requirements**: TOPO-01, TOPO-02, TOPO-03, TOPO-04
**Success Criteria** (what must be TRUE):
  1. Running `kb index` on a repo with gRPC client stubs produces edges linking caller to the proto service
  2. Running `kb index` on a repo with HTTP client modules (Tesla/HTTPoison base_url) produces edges linking caller to target service
  3. Running `kb index` on gateway repos produces edges linking the gateway to upstream services based on routing config
  4. Running `kb index` on repos with Kafka producers/consumers produces edges linking services via topic names
  5. All topology edges are persisted with a mechanism type (grpc, http, gateway, kafka) in the edges table
**Plans**: 3 plans

Plans:
- [x] 16-01-PLAN.md -- Types, V7 migration, gRPC/HTTP/Kafka extractors
- [x] 16-02-PLAN.md -- Gateway routing extractor
- [x] 16-03-PLAN.md -- Pipeline integration and persistence wiring

### Phase 17: Topology Query Layer
**Goal**: Users can query the full service communication graph -- filtering by mechanism, seeing confidence levels, traversing all edge types
**Depends on**: Phase 16
**Requirements**: TOPO-05, TOPO-06, TOPO-07
**Success Criteria** (what must be TRUE):
  1. `kb deps <repo>` returns all communication edges (gRPC, HTTP, gateway, Kafka, events) -- not just event edges
  2. `kb deps <repo> --mechanism grpc` filters results to only gRPC communication edges
  3. Each topology edge displays a confidence level (high/medium/low) reflecting extraction reliability
  4. `kb_deps` MCP tool supports the same mechanism filtering as the CLI
**Plans**: 2 plans

Plans:
- [x] 17-01-PLAN.md -- Types, query engine rewrite, tests (all edge types, mechanism filter, confidence)
- [x] 17-02-PLAN.md -- CLI --mechanism flag and MCP tool mechanism param

### Phase 18: Embedding Infrastructure
**Goal**: The system can generate and store vector embeddings for all indexed entities using local inference
**Depends on**: Phase 16 (topology data enriches embedding text)
**Requirements**: SEM-01, SEM-02, SEM-03
**Success Criteria** (what must be TRUE):
  1. sqlite-vec native extension loads successfully in better-sqlite3 on macOS ARM64
  2. Running `kb index` generates 256-dimensional embeddings for all entities using nomic-embed-text-v1.5 as a post-persistence step
  3. Embedding text preprocessing splits CamelCase/snake_case tokens (reusing tokenizeForFts) before feeding to the model
  4. Embeddings are stored in a vec0 virtual table queryable by KNN distance
**Plans**: 2 plans

Plans:
- [x] 18-01-PLAN.md -- sqlite-vec loading, V8 migration, vec0 table, embedding text composition
- [x] 18-02-PLAN.md -- Transformers.js pipeline, batch embedding generation, indexer integration

### Phase 19: Semantic Search
**Goal**: Users can search the knowledge base with natural language queries and get semantically relevant results
**Depends on**: Phase 18
**Requirements**: SEM-04, SEM-05, SEM-06, SEM-07
**Success Criteria** (what must be TRUE):
  1. `kb search --semantic "which services handle payments"` returns entities ranked by vector similarity
  2. `kb search "payments"` (without --semantic) combines FTS5 keyword results with vector similarity via RRF scoring for hybrid search
  3. When sqlite-vec is unavailable or embeddings have not been generated, all search commands gracefully fall back to FTS5-only with no errors
  4. `kb_semantic` MCP tool accepts natural language queries and returns semantically relevant entities for AI agent consumption
**Plans**: 2 plans

Plans:
- [x] 19-01-PLAN.md -- Core search functions: generateQueryEmbedding, searchSemantic (KNN), searchHybrid (RRF), withAutoSyncAsync
- [x] 19-02-PLAN.md -- CLI --semantic flag, hybrid default search, kb_semantic MCP tool

### Phase 20: Targeted Repo Reindex with Git Refresh
**Goal**: Users can reindex specific repos (instead of all ~400) with an automatic git refresh step that fetches latest code from remote before indexing
**Depends on**: Phase 19
**Requirements**: RIDX-01, RIDX-02, RIDX-03, RIDX-04, RIDX-05
**Success Criteria** (what must be TRUE):
  1. `kb index --repo foo` indexes only the targeted repo, not all repos
  2. `gitRefresh()` fetches from origin and resets the local default branch to match remote
  3. `kb index --repo foo --refresh` does git fetch+reset before indexing
  4. Git refresh handles errors gracefully (no remote, dirty working tree, fetch timeout)
  5. `kb_reindex` MCP tool accepts repo names and triggers targeted reindex with refresh
**Plans**: 2 plans

Plans:
- [x] 20-01-PLAN.md -- gitRefresh(), targeted repo filtering in pipeline, CLI --repo/--refresh flags
- [x] 20-02-PLAN.md -- kb_reindex MCP tool

</details>

### Phase 21: Embedding Removal
**Goal**: All embedding infrastructure is gone -- the codebase has no sqlite-vec, no transformers.js, no vec0 table, no semantic search paths, and all tests pass
**Depends on**: Phase 20 (v2.0 complete)
**Requirements**: CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04, CLEAN-05, CLEAN-06
**Success Criteria** (what must be TRUE):
  1. `src/embeddings/` directory does not exist and no source file imports from it
  2. `npm ls sqlite-vec` and `npm ls @huggingface/transformers` both report "not installed"
  3. `kb search "query"` uses FTS5 only -- no hybrid/vector code path exists, no degradation logic needed
  4. `kb search "payments"` (default search) returns FTS5 results only, no hybrid/RRF scoring
  5. `kb search --semantic` and `kb_semantic` MCP tool are gone -- running them produces "unknown option" / tool-not-found errors
  6. All tests pass with no embedding-related test files remaining
**Plans**: 2 plans

Plans:
- [x] 21-01-PLAN.md -- Remove embeddings dir, vec module, V8 migration, uninstall npm packages
- [x] 21-02-PLAN.md -- Remove semantic/hybrid search, CLI flags, MCP tool, tests, update docs

### Phase 22: Fixes & Metadata
**Goal**: Remaining UX papercuts are fixed and all project documentation accurately reflects the post-cleanup state of the codebase
**Depends on**: Phase 21
**Requirements**: FIX-01, FIX-02, META-01
**Success Criteria** (what must be TRUE):
  1. `kb index --repo foo` skips the staleness check and always reindexes (no separate `--force` needed)
  2. Scanner discovers repos that are symlinks under the root directory (not just real directories)
  3. PROJECT.md stats, constraints, tool counts, and tech stack reflect the post-cleanup reality (no sqlite-vec, no transformers.js, correct test count)
**Plans**: 2 plans

Plans:
- [x] 22-01-PLAN.md -- Implicit force for --repo, symlink support in scanner
- [x] 22-02-PLAN.md -- Update PROJECT.md and CLAUDE.md metadata

## Progress

**Execution Order:**
Phases execute in numeric order: 21 -> 22

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-5 | v1.0 | 9/9 | Complete | 2026-03-06 |
| 6-10 | v1.1 | 11/11 | Complete | 2026-03-07 |
| 11-15 | v1.2 | 12/12 | Complete | 2026-03-07 |
| 16-20 | v2.0 | 11/11 | Complete | 2026-03-09 |
| 21. Embedding Removal | v2.1 | 2/2 | Complete | 2026-03-09 |
| 22. Fixes & Metadata | v2.1 | 2/2 | Complete | 2026-03-09 |
