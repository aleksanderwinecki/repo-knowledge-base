# Repo Knowledge Base

## What This Is

A persistent knowledge base that indexes Fresha's microservice ecosystem (~50+ repos) into a single SQLite file with FTS5 search. Any AI agent can instantly query architectural knowledge, service relationships, event flows, and implementation patterns via CLI or MCP tools — without re-scanning repos every session.

## Current State

**Latest shipped:** v1.1 Improved Reindexing (2026-03-07)
**Next milestone:** v1.2 Hardening & Quick Wins

## Current Milestone: v1.2 Hardening & Quick Wins

**Goal:** Systematic module-by-module review of the codebase to find and ship optimizations, refactoring, and verification improvements.

**Target features:**
- Module-by-module code review for quick wins
- Refactoring opportunities (duplication, API cleanup, module boundaries)
- Performance optimizations (indexing, search, persistence)
- Test coverage and correctness verification

## Core Value

Eliminate the repeated cost of AI agents re-learning the same codebase architecture every session. One index, always fresh, queryable in milliseconds.

## Requirements

### Validated

- v1.1 IDX2-01: Indexer tracks only main/master branch commit SHA — Phase 6
- v1.1 IDX2-02: Surgical file-level re-indexing (only changed files) — Phase 7
- v1.1 IDX2-03: Deleted file cleanup via git diff — Phase 7
- v1.1 IDX2-04: Parallel repo indexing with configurable concurrency — Phase 9
- v1.1 IDX2-05: Schema migration (v3) for new extractors — Phase 6
- v1.1 EXT-01: gRPC service definitions from .proto files — Phase 8
- v1.1 EXT-02: Ecto schema fields and associations — Phase 8
- v1.1 EXT-03: GraphQL types/queries/mutations from .graphql SDL — Phase 8
- v1.1 EXT-04: Absinthe macro extraction — Phase 8
- v1.1 EXT-05: Event Catalog metadata integration — Phase 8
- v1.1 EXT-06: gRPC client call edge detection — Phase 8
- v1.1 TF-01..TF-08: Search type filtering with parent:subtype FTS, CLI --type, MCP type param, kb_list_types — Phase 10
- v1.0 STOR-01..04: SQLite + FTS5 storage, schema, per-repo tracking
- v1.0 IDX-01..07: Repo scanning, extraction, incremental indexing, error isolation
- v1.0 SRCH-01..04: Text search, entity queries, dependency graphs, contextual results
- v1.0 INTF-01..04: CLI, MCP server, JSON output, <4KB responses
- v1.0 KNOW-01..03: Manual knowledge injection, persistence, relationship graphs

### Active

- [ ] Embedding-based semantic search for natural language queries (SEM-01)
- [ ] Code-aware embeddings for CamelCase/snake_case (SEM-02)
- [ ] CODEOWNERS parsing and ownership queries (OWN-01..03)
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

Shipped v1.1 with 13,258 LOC TypeScript (5,739 src + 7,519 tests), 388 tests passing across 25 test files.
Tech stack: Node.js, TypeScript, better-sqlite3, FTS5, @modelcontextprotocol/sdk, commander.js, p-limit, vitest.
Built in ~20 hours total across v1.0 and v1.1.

8 MCP tools: kb_search, kb_entity, kb_deps, kb_learn, kb_forget, kb_status, kb_cleanup, kb_list_types.
CLI: kb index, kb search (--type, --list-types, --entity), kb deps, kb status, kb learn, kb learned, kb forget, kb docs.

Known limitations:
- FTS5 keyword search only (no semantic/embedding search) — handles ~80% of queries well
- sqlite-vec platform compatibility on macOS ARM64 untested — needed for v2 embeddings
- All extractors use regex parsing (no AST) — good enough for well-structured Elixir/proto/GraphQL macros

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
| Surgical threshold: <=200 files AND <=50% of repo | Above threshold silently falls back to full rebuild; avoids slow surgical on large changes | v1.1 Good |
| Regex over AST for all extractors | No AST dependency; regex sufficient for well-structured macros | v1.1 Good |
| p-limit over worker_threads for parallelism | SQLite can't share connections across threads; p-limit + Promise.all sufficient | v1.1 Good |
| EventCatalog via filesystem parsing | SDK is file-based, no HTTP API; direct MDX/YAML parsing works | v1.1 Good |
| FTS parent:subtype composite format | Enables both coarse and granular type filtering without separate columns | v1.1 Good |
| UNINDEXED entity_type in FTS | Prevents type tokens from polluting MATCH results; still supports = and LIKE | v1.1 Good |

## Constraints

- **Runtime**: Local only, no external infrastructure
- **Storage**: SQLite — zero dependencies
- **Language**: Node.js/TypeScript
- **Indexing speed**: Full index completes in under 10 minutes for ~50 repos
- **Query speed**: Search returns in under 2 seconds
- **MCP responses**: Under 4KB per response

---
*Last updated: 2026-03-07 after v1.1 milestone*
