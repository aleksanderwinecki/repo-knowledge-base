# Repo Knowledge Base

## What This Is

A persistent knowledge base that indexes Fresha's microservice ecosystem (~400 repos) into a single SQLite file with FTS5 search and graph intelligence. Any AI agent can instantly query architectural knowledge, service relationships, event flows, blast radius, request paths, and service overviews via CLI or MCP tools — without re-scanning repos every session.

## Current State

**Latest shipped:** v3.0 Graph Intelligence (2026-03-10)

## Current Milestone: v3.1 Indexing UX

**Goal:** Make `kb index` output useful for humans watching a terminal during the ~1hr full reindex.

**Target features:**
- Progress counters with line-overwrite for git refresh and extraction phases
- Grouped git refresh failure summary (by category: worktree conflict, dirty tree, timeout)
- Live extraction/indexing progress (`[42/412] Indexing app-foo...`)
- Compact final summary (counts only, errors listed individually)
- JSON output gated behind `--json` flag or non-TTY detection

## Core Value

Eliminate the repeated cost of AI agents re-learning the same codebase architecture every session. One index, always fresh, queryable in milliseconds.

## Requirements

### Validated

- v3.0 GRAPH-01..05: In-memory graph module with BFS traversal, event/Kafka resolution, shared edge utilities — Phase 23
- v3.0 IMPACT-01..07: Blast radius analysis with mechanism filtering, depth tiers, compact MCP formatting — Phase 24
- v3.0 TRACE-01..04: Flow tracing with shortest path, per-hop mechanisms, confidence scoring — Phase 25
- v3.0 EXPLAIN-01..05: Service explanation cards with connections, events, modules, agent hints — Phase 26
- v2.1 CLEAN-01..06: Embedding infrastructure removal (sqlite-vec, transformers.js, vec0, semantic/hybrid search) — Phase 21
- v2.1 FIX-01, FIX-02: Implicit force for --repo, symlink support in scanner — Phase 22
- v2.1 META-01: Project metadata updated to reflect post-cleanup reality — Phase 22
- v2.0 TOPO-01..07: Service topology extraction and query layer (gRPC, HTTP, gateway, Kafka) — Phases 16-17
- v2.0 SEM-01..07: Embedding infrastructure and semantic search (shipped then removed in v2.1) — Phases 18-19
- v2.0 RIDX-01..05: Targeted repo reindex with git refresh — Phase 20
- v1.2 SAFE-01..03: MCP contract tests, FTS golden tests, CLI snapshot tests — Phase 11
- v1.2 PERF-01..07: SQLite pragmas, prepared statements, indexes, FTS5 optimize, WAL checkpoint, perf_hooks — Phase 12
- v1.2 MCP-01..05: wrapToolHandler HOF, withAutoSync, McpResponse, DB path, EntityType union — Phase 13
- v1.2 CORE-01..08: Pipeline unification, FTS path, entity hydration, writer helpers, edge ops — Phase 14
- v1.2 TS-01..04: noUncheckedIndexedAccess, dead code, deps symmetry, catch docs — Phase 15
- v1.1 IDX2-01..05, EXT-01..06, TF-01..08: Branch-aware indexing, new extractors, type filtering — Phases 6-10
- v1.0 STOR-01..04, IDX-01..07, SRCH-01..04, INTF-01..04, KNOW-01..03: Foundation — Phases 1-5

### Active

- [ ] Progress reporting during indexing
- [ ] Grouped git refresh error summary
- [ ] JSON output gated behind --json flag / non-TTY
- [ ] Compact human-readable summary

### Deferred

- [ ] Auto-learn patterns from completed tasks (INT-01)
- [ ] Suggest relevant repos/files for feature descriptions (INT-02)
- [ ] Cross-repo impact analysis (INT-03) — partially addressed by topology
- [ ] Multiple path discovery (top N paths) in kb_trace (AGRAPH-01)
- [ ] `--detail` flag for rich path data in kb_impact (AGRAPH-02)
- [ ] Architecture rules engine ("X should not call Y") (AGRAPH-03)
- [ ] Historical graph comparison / snapshots (AGRAPH-04)
- [ ] Code-level (function granularity) impact analysis (AGRAPH-05)
- [ ] Graph caching layer for sub-millisecond repeated queries (AGRAPH-06)
- [ ] Tree-sitter AST parsing for multi-language support (NOM-03)

### Out of Scope

- Full AI orchestrator / task executor — separate project, builds on this knowledge layer
- PR creation or code generation — this is knowledge, not action
- UI dashboard — CLI + MCP only
- Real-time file watching — on-demand re-index is sufficient
- Cloud deployment — local-only tool
- Code review or linting — out of domain
- Neo4j integration — SQLite handles 12K edges in <10ms
- Graph visualization UI — CLI + MCP only

## Context

Shipped v3.0 with 672 tests passing across 40 test files.
Tech stack: Node.js, TypeScript (strict + noUncheckedIndexedAccess), better-sqlite3, FTS5, @modelcontextprotocol/sdk, commander.js, p-limit, vitest.
Built across v1.0, v1.1, v1.2, v2.0, v2.1, and v3.0 milestones (26 phases, 56 plans).

12 MCP tools: kb_search, kb_entity, kb_deps, kb_impact, kb_trace, kb_explain, kb_list_types, kb_reindex, kb_learn, kb_forget, kb_status, kb_cleanup.
CLI: kb index (--force, --repo, --refresh, --timing), kb search (--type, --list-types, --entity), kb deps (--direction, --mechanism), kb impact (--mechanism, --depth), kb trace, kb explain, kb status, kb learn, kb learned, kb forget, kb docs.

400 repos indexed: 125k modules, 8.4k events, 127 services, 11.7k topology edges.

Known limitations:
- All extractors use regex parsing (no AST) — good enough for well-structured Elixir/proto/GraphQL macros
- Topology extraction catches most patterns but unusual client wrappers may be missed
- Indexing output is noisy and lacks progress indication for the ~1hr full reindex

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
| Regex for topology extraction (no AST) | Consistent with existing extractor pattern; gRPC/HTTP/Kafka patterns are well-structured | v2.0 Good |
| Confidence levels on topology edges | High for gRPC/proto (exact match), medium for gateway, low for HTTP regex | v2.0 Good |
| Generic edges table for all topology | Single table with mechanism column vs separate tables per type; simpler queries | v2.0 Good |
| Remove embedding infrastructure entirely | 1hr generation time, OOM on targeted runs, FTS5 covers 95%+ of queries | v2.1 Good |
| --repo implies force (skip staleness) | Targeted reindex always re-indexes; requiring --force was redundant UX | v2.1 Good |
| SCHEMA_VERSION back to 7 (no vec0) | V8 was vec0 migration; removing it means DB auto-rebuilds cleanly | v2.1 Good |
| JS BFS over SQLite recursive CTEs | 200-1000x faster; SQL loads edges in bulk, JS traverses in memory | v3.0 Good |
| Event/Kafka two-hop resolution in graph builder | repo->event->repo collapsed to single logical edge transparently | v3.0 Good |
| Compact formatter for hub nodes | Flat list + stats fits 300+ services in 4KB MCP budget; no generic halving | v3.0 Good |
| kb_explain independent of graph module | Pure SQL aggregation simpler and sufficient for service cards | v3.0 Good |
| Mechanism filter during BFS traversal | Applied at traversal time, not post-filter, for correct scoped queries | v3.0 Good |
| Static agent hints with placeholder substitution | Simpler than dynamic hint generation; covers all common next-step patterns | v3.0 Good |

## Constraints

- **Runtime**: Local only, no external infrastructure
- **Storage**: SQLite — zero dependencies
- **Language**: Node.js/TypeScript
- **Indexing speed**: Full index completes in under 10 minutes for 400 repos
- **Query speed**: Search returns in under 2 seconds
- **MCP responses**: Under 4KB per response

---
*Last updated: 2026-03-10 after v3.1 milestone start*
