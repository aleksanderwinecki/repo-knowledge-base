# Repo Knowledge Base

## What This Is

A persistent knowledge base that indexes Fresha's microservice ecosystem (~50+ repos) into a single SQLite file with FTS5 search. Any AI agent can instantly query architectural knowledge, service relationships, event flows, and implementation patterns via CLI or MCP tools — without re-scanning repos every session.

## Current Milestone: v1.1 Improved Reindexing

**Goal:** Faster, smarter indexing with branch-aware tracking, surgical file-level updates, parallel execution, and new extractors for GraphQL, gRPC, Ecto, and Event Catalog.

**Target features:**
- Track only main/master branch (ignore PR branch checkouts)
- Surgical file-level re-indexing (only re-process changed files)
- Parallel repo indexing for faster full re-index
- GraphQL schema extraction (types, queries, mutations)
- gRPC service definition extraction
- Ecto schema and database structure extraction
- Event Catalog as supplementary data source

## Core Value

Eliminate the repeated cost of AI agents re-learning the same codebase architecture every session. One index, always fresh, queryable in milliseconds.

## Requirements

### Validated

- v1.1 IDX2-01: Indexer tracks only main/master branch commit SHA, ignoring checked-out PR branches — Phase 6
- v1.1 IDX2-05: Schema migration (v3) adds columns/tables needed for new extractors — Phase 6
- v1.0 STOR-01: SQLite database stores all indexed knowledge in a single file
- v1.0 STOR-02: Schema supports repos, files, modules, events, services, and relationships
- v1.0 STOR-03: FTS5 full-text search over indexed content
- v1.0 STOR-04: Per-repo metadata tracks last indexed git commit for incremental updates
- v1.0 IDX-01: Scan all repos under configurable root directory
- v1.0 IDX-02: Extract repo metadata (name, description, tech stack, key files)
- v1.0 IDX-03: Extract Elixir module definitions and responsibilities
- v1.0 IDX-04: Extract proto file definitions (event schemas, service definitions)
- v1.0 IDX-05: Extract Kafka event producer/consumer relationships
- v1.0 IDX-06: Incremental re-indexing (only process repos with new commits)
- v1.0 IDX-07: Per-repo error isolation
- v1.0 SRCH-01: Text search across all indexed content
- v1.0 SRCH-02: Structured entity queries
- v1.0 SRCH-03: Service dependency queries
- v1.0 SRCH-04: Search results include file paths, repo names, and context
- v1.0 INTF-01: CLI tool for indexing, querying, and learning
- v1.0 INTF-02: MCP server for mid-conversation queries
- v1.0 INTF-03: JSON output formatting for CLI
- v1.0 INTF-04: MCP responses sized under 4KB with structured summaries
- v1.0 KNOW-01: Manual knowledge injection via learn command
- v1.0 KNOW-02: Learned facts stored persistently and searchable
- v1.0 KNOW-03: Service relationship graph queryable

### Active

- [ ] Embedding-based semantic search for natural language queries (SEM-01)
- [ ] Code-aware embeddings for CamelCase/snake_case (SEM-02)
- [ ] Extract GraphQL schema definitions (EXT-01)
- [ ] Extract gRPC service definitions (EXT-02)
- [ ] Extract Ecto schemas and database structure (EXT-03)
- [ ] Extract from Event Catalog as supplementary data source (EXT-04)
- [ ] Auto-learn patterns from completed tasks (INT-01)
- [ ] Suggest relevant repos/files for feature descriptions (INT-02)
- [ ] Cross-repo impact analysis (INT-03)

### Out of Scope

- Full AI orchestrator / task executor — separate project, builds on this knowledge layer
- PR creation or code generation — this is knowledge, not action
- UI dashboard — CLI + MCP only
- Real-time file watching — on-demand re-index is sufficient
- Cloud deployment — local-only tool
- Code review or linting — out of domain

## Context

Shipped v1.0 with 8,193 LOC TypeScript, 236 tests passing. Phase 6 added branch-aware indexing — 263 tests passing.
Tech stack: Node.js, TypeScript, better-sqlite3, FTS5, @modelcontextprotocol/sdk, commander.js, vitest.
Built in ~18 hours as a hackathon project.

Known limitations:
- FTS5 keyword search only (no semantic/embedding search) — handles ~80% of queries well
- sqlite-vec platform compatibility on macOS ARM64 untested — needed for v2 embeddings
- Elixir/proto extractors use regex parsing (no AST) — good enough for common patterns

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| SQLite + FTS5 over vector DB | Zero infrastructure, debuggable, fast enough for ~50 repos | v1.0 Good |
| Node.js/TypeScript over Elixir | Faster prototyping, better MCP SDK support | v1.0 Good |
| MCP tool integration | Any Claude Code session can query knowledge without setup | v1.0 Good |
| Incremental over full re-index | Git diff since last indexed commit avoids redundant work | v1.0 Good |
| Deferred embeddings to v2 | FTS5 handles 80% of value; embeddings add complexity | v1.0 Good |
| Combined CLI + MCP + Knowledge phase | Shared core with thin wrappers reduces duplication | v1.0 Good |
| No MCP SDK in utility modules | Pure data/DB operations for easy testing | v1.0 Good |
| Recursive halving for response sizing | Reliable <4KB MCP responses without binary search | v1.0 Good |
| createServer factory pattern | Testable MCP server without stdio transport in tests | v1.0 Good |
| Git plumbing over porcelain for branch reads | rev-parse/ls-tree/show are scriptable, no working tree interference | v1.1 Good |
| main→master→null fallback chain | Simple, covers 99% of repos; no remote queries needed | v1.1 Good |
| Extractors accept branch param, parse functions unchanged | Minimal API surface change; parseElixirFile/parseProtoFile stay pure | v1.1 Good |

## Constraints

- **Runtime**: Local only, no external infrastructure
- **Storage**: SQLite — zero dependencies
- **Language**: Node.js/TypeScript
- **Indexing speed**: Full index completes in under 10 minutes for ~50 repos
- **Query speed**: Search returns in under 2 seconds
- **MCP responses**: Under 4KB per response

---
*Last updated: 2026-03-06 after Phase 6*
