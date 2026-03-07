# Milestones

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

