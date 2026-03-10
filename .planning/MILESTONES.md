# Milestones

## v3.0 Graph Intelligence (Shipped: 2026-03-10)

**Phases completed:** 4 phases (23-26), 9 plans
**Timeline:** 1 day (2026-03-09)
**Stats:** 46 commits, 58 files changed, 8,376 insertions, 672 tests, 8,417 LOC TypeScript

**Key accomplishments:**
- Graph infrastructure: in-memory adjacency list builder with BFS traversal primitives, event/Kafka two-hop resolution, shared edge utilities extracted from dependencies.ts
- Blast radius analysis: `kb_impact` MCP tool and `kb impact` CLI — downstream impact with depth tiers, mechanism filtering, blast radius scoring, compact formatter for 4KB MCP budget
- Flow tracing: `kb_trace` MCP tool and `kb trace` CLI — shortest path between services with per-hop mechanism labels, confidence scoring, and arrow-chain path summaries
- Service explanation cards: `kb_explain` MCP tool and `kb explain` CLI — structured service overviews with connections, events, modules, entity counts, and agent-actionable hints
- All three tools work over the existing topology edge data (11.7K edges) with no new indexing requirements

**Delivered:** Three graph intelligence tools that give AI agents instant answers to blast radius, request flow, and service overview questions — built on top of the existing topology data with JS BFS (200-1000x faster than SQLite recursive CTEs).

---

## v2.1 Cleanup & Tightening (Shipped: 2026-03-09)

**Phases completed:** 2 phases (21-22), 4 plans
**Timeline:** 1 day (2026-03-09)
**Stats:** 11 commits, 506 tests, 6,796 LOC TypeScript, -2,108 net lines (cleanup milestone)

**Key accomplishments:**
- Removed all embedding infrastructure: sqlite-vec, @huggingface/transformers, vec0 table, semantic/hybrid search, kb_semantic MCP tool — 3,150 lines deleted across 47 files
- Simplified search to FTS5-only: removed async search paths, hybrid RRF scoring, graceful degradation logic
- `kb index --repo foo` now implicitly skips staleness check (no `--force` needed for targeted reindex)
- Scanner follows symlinks when discovering repos under root directory
- All project metadata (PROJECT.md, CLAUDE.md, README.md) updated to reflect FTS5-only reality: 9 MCP tools, 506 tests, no embedding references

**Delivered:** Codebase cleanup that removed an impractical embedding subsystem (1hr generation, OOM on targeted runs), fixed two UX papercuts, and ensured all documentation accurately reflects the current state.

---

## v2.0 Design-Time Intelligence (Shipped: 2026-03-09)

**Phases completed:** 5 phases (16-20), 11 plans
**Timeline:** 2 days (Mar 8-9, 2026)
**Stats:** 506 tests (at peak before cleanup), ~6,800 LOC TypeScript

**Key accomplishments:**
- Service topology extraction: gRPC, HTTP, gateway routing, and Kafka producer/consumer edges detected during indexing — 11,700+ topology edges across 400 repos
- Topology query layer: `kb deps` traverses all edge types with `--mechanism` filtering and confidence levels (high/medium/low)
- Embedding infrastructure: sqlite-vec + nomic-embed-text-v1.5 for 256d vector embeddings (later removed in v2.1 — impractical at scale)
- Semantic search: KNN vector similarity, hybrid FTS5+vector with RRF scoring, kb_semantic MCP tool (later removed in v2.1)
- Targeted repo reindex: `kb index --repo foo --refresh` with git fetch+reset, `kb_reindex` MCP tool

**Delivered:** Full service topology mapping across gRPC/HTTP/gateway/Kafka with queryable dependency graph, plus targeted repo reindexing with git refresh. Semantic search was shipped but later removed in v2.1 after proving impractical at scale.

---

## v1.2 Hardening & Quick Wins (Shipped: 2026-03-07)

**Phases completed:** 5 phases (11-15), 12 plans, 23 tasks
**Timeline:** 1 day (2026-03-07)
**Stats:** 45 commits, 435 tests, 14,249 LOC TypeScript (5,582 src + 8,667 tests)

**Key accomplishments:**
- Safety net: 16 MCP contract tests + 15 FTS golden tests + 8 CLI snapshot tests locking API contracts and search quality
- Database performance: SQLite pragma tuning, prepared statement hoisting, B-tree indexes, FTS5 optimize/WAL checkpoint, perf_hooks instrumentation
- MCP layer dedup: wrapToolHandler HOF, withAutoSync helper, unified McpResponse format, shared DB path utility — ~84 lines eliminated
- Core layer dedup: shared FTS fallback, entity hydrator, writer helpers, pipeline unification (indexSingleRepo → extractRepoData + persistExtractedData) — ~400 lines eliminated
- TypeScript hardening: noUncheckedIndexedAccess enabled (60 fixes), dead code removed, dependency query parameterized, all catch blocks documented

**Delivered:** Systematic hardening of the entire codebase — safety nets for refactoring confidence, SQLite performance tuning, ~500 lines of duplicated code consolidated, and strict TypeScript enabled across all source files.

---

## v1.1 Improved Reindexing (Shipped: 2026-03-07)

**Phases completed:** 5 phases (6-10), 11 plans, ~18 tasks
**Timeline:** 2 days (Mar 5-7, 2026)
**Stats:** 19 feat commits, 388 tests, 13,258 LOC TypeScript (5,739 src + 7,519 tests)

**Key accomplishments:**
- Branch-aware indexing: repos always indexed from main/master regardless of local checkout, using git plumbing commands
- Surgical file-level indexing: only re-processes changed files since last commit, with automatic full-rebuild fallback
- New extractors: GraphQL (SDL + Absinthe), gRPC services, Ecto schemas, Event Catalog metadata
- Parallel execution: multi-repo concurrent indexing with p-limit for 2-4x faster re-indexing
- Search type filtering: granular sub-type filtering (schema, graphql_query, grpc) via CLI --type and MCP type parameter with --list-types discovery

**Delivered:** Faster, smarter indexing with branch-aware tracking, surgical updates, parallel execution, 4 new extractors (GraphQL, gRPC, Ecto, Event Catalog), and granular search type filtering — all queryable via CLI and MCP.

---

## v1.0 MVP (Shipped: 2026-03-06)

**Phases completed:** 5 phases, 9 plans
**Timeline:** ~18 hours (Mar 5-6, 2026)
**Stats:** 49 commits, 116 files, 8,193 LOC TypeScript, 236 tests

**Key accomplishments:**
- SQLite storage layer with FTS5 full-text search and CamelCase/snake_case tokenizer
- Indexing pipeline: repo scanner, metadata extractor, Elixir/proto/event parsers with incremental re-indexing
- Search layer: FTS5 text search, structured entity queries, BFS dependency graph traversal
- CLI with 8 commands: index, search, deps, status, learn, learned, forget, docs
- MCP server with 7 tools (search, entity, deps, learn, forget, status, cleanup) via stdio transport
- Auto-sync detects stale repos and re-indexes transparently; data hygiene prunes deleted repos

**Delivered:** A persistent knowledge base that indexes ~50+ microservice repos into a single SQLite file, queryable via CLI or MCP tools by any Claude Code session — eliminating repeated codebase re-learning.

---

