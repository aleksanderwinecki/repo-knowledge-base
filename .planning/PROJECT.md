# Repo Knowledge Base

## What This Is

A persistent knowledge base that indexes Fresha's microservice ecosystem (~50+ repos) into a single SQLite file with FTS5 search. Any AI agent can instantly query architectural knowledge, service relationships, event flows, and implementation patterns via CLI or MCP tools — without re-scanning repos every session.

## Current State

**Latest shipped:** v2.1 Cleanup & Tightening — Phase 21 Embedding Removal (2026-03-09)
**Current milestone:** v2.1 Cleanup & Tightening — Phase 22 Fixes & Metadata

## Current Milestone: v2.1 Cleanup & Tightening

**Goal:** Remove dead embedding infrastructure, fix scoping/UX issues in existing features, and update all project metadata to reflect current reality.

**Target features:**
- ~~Remove embedding infrastructure~~ (completed Phase 21)
- Fix --repo targeting UX (implicit force, symlink support in scanner)
- Update all project metadata (PROJECT.md stats, constraints, context to reflect current reality)

## Core Value

Eliminate the repeated cost of AI agents re-learning the same codebase architecture every session. One index, always fresh, queryable in milliseconds.

## Requirements

### Validated

- v1.2 SAFE-01..03: MCP contract tests, FTS golden tests, CLI snapshot tests — Phase 11
- v1.2 PERF-01..07: SQLite pragmas, prepared statements, indexes, FTS5 optimize, WAL checkpoint, perf_hooks — Phase 12
- v1.2 MCP-01..05: wrapToolHandler HOF, withAutoSync, McpResponse, DB path, EntityType union — Phase 13
- v1.2 CORE-01..08: Pipeline unification, FTS path, entity hydration, writer helpers, edge ops — Phase 14
- v1.2 TS-01..04: noUncheckedIndexedAccess, dead code, deps symmetry, catch docs — Phase 15
- v1.1 IDX2-01..05, EXT-01..06, TF-01..08: Branch-aware indexing, new extractors, type filtering — Phases 6-10
- v1.0 STOR-01..04, IDX-01..07, SRCH-01..04, INTF-01..04, KNOW-01..03: Foundation — Phases 1-5

### Active

- [x] Remove embedding infrastructure (CLEAN-01..06) — completed Phase 21
- [x] Fix --repo implicit force and symlink support in scanner (FIX-01, FIX-02) — completed Phase 22
- [x] Update project metadata to reflect current state (META-01) — completed Phase 22

### Deferred

- [ ] Auto-learn patterns from completed tasks (INT-01)
- [ ] Suggest relevant repos/files for feature descriptions (INT-02)
- [ ] Cross-repo impact analysis (INT-03) — partially addressed by topology
- [ ] Impact analysis queries over topology graph (NOM-01) — inspired by nomik.co
- [ ] Flow tracing MCP tool across service topology (NOM-02) — inspired by nomik.co
- [ ] Tree-sitter AST parsing for multi-language support (NOM-03) — inspired by nomik.co

### Out of Scope

- Full AI orchestrator / task executor — separate project, builds on this knowledge layer
- PR creation or code generation — this is knowledge, not action
- UI dashboard — CLI + MCP only
- Real-time file watching — on-demand re-index is sufficient
- Cloud deployment — local-only tool
- Code review or linting — out of domain

## Context

Shipped v2.1 with 506 tests passing across 32 test files.
Tech stack: Node.js, TypeScript (strict + noUncheckedIndexedAccess), better-sqlite3, FTS5, @modelcontextprotocol/sdk, commander.js, p-limit, vitest.
Built across v1.0, v1.1, v1.2, v2.0, and v2.1 milestones.

9 MCP tools: kb_search, kb_entity, kb_deps, kb_list_types, kb_reindex, kb_learn, kb_forget, kb_status, kb_cleanup.
CLI: kb index (--force, --repo, --refresh, --timing), kb search (--type, --list-types, --entity), kb deps (--direction, --mechanism), kb status, kb learn, kb learned, kb forget, kb docs.

400 repos indexed: 125k modules, 8.4k events, 127 services, 11.7k topology edges.

Known limitations:
- All extractors use regex parsing (no AST) — good enough for well-structured Elixir/proto/GraphQL macros
- Topology extraction catches most patterns but unusual client wrappers may be missed

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
| Safety nets before refactoring | Contract tests + golden tests catch regressions from any structural change | v1.2 Good |
| wrapToolHandler HOF for MCP tools | Single error handling path; individual tools are pure logic only | v1.2 Good |
| withAutoSync generic helper | Type-safe sync-requery pattern; direction-agnostic | v1.2 Good |
| extractRepoData + persistExtractedData as single pipeline | indexSingleRepo and indexAllRepos share identical extraction/persistence code | v1.2 Good |
| noUncheckedIndexedAccess enabled | Catches undefined array/record access at compile time; 60 fixes were mechanical | v1.2 Good |
| Document intentional silence over forced logging | 28 bare catches are all legitimate (git probes, file reads, FTS fallbacks) | v1.2 Good |

## Constraints

- **Runtime**: Local only, no external infrastructure
- **Storage**: SQLite — zero dependencies
- **Language**: Node.js/TypeScript
- **Indexing speed**: Full index completes in under 10 minutes for 400 repos
- **Query speed**: Search returns in under 2 seconds
- **MCP responses**: Under 4KB per response

---
*Last updated: 2026-03-09 after Phase 21 completion (embedding removal)*
