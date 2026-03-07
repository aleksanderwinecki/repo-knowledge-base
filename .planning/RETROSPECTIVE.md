# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-03-06
**Phases:** 5 | **Plans:** 9 | **Commits:** 49

### What Was Built
- SQLite storage with FTS5 full-text search and custom tokenizer for code identifiers
- Full indexing pipeline: repo discovery, metadata extraction, Elixir/proto/event parsing
- Search layer: text search, entity cards, BFS dependency graph traversal
- CLI with 8 commands (index, search, deps, status, learn, learned, forget, docs)
- MCP server with 7 tools, auto-sync for stale repos, data hygiene utilities
- 236 tests across all layers

### What Worked
- Hackathon pace: entire MVP shipped in ~18 hours across 2 days
- Layered architecture paid off — each phase built cleanly on the previous
- FTS5 decision was correct: no embedding infrastructure needed, handles keyword queries well
- Pure utility modules (no MCP SDK dependency) made testing trivial
- Regex-based extractors (Elixir, proto) were good enough for v1 without AST complexity

### What Was Inefficient
- Requirements traceability wasn't updated during execution (17/22 left unchecked despite being delivered)
- Summary one-liner extraction didn't work (null for all summaries) — summaries used inconsistent frontmatter
- Phase 1 originally planned 2 plans but FTS was merged into plan 01-01 scope during execution

### Patterns Established
- JSON-only CLI output to stdout, errors to stderr — clean for programmatic consumption
- createServer factory pattern for MCP testability
- Recursive halving strategy for MCP response size constraints (<4KB)
- Per-repo error isolation in indexing pipeline

### Key Lessons
1. FTS5 with application-level tokenization handles 80% of search value without embedding complexity
2. Keeping MCP utility modules free of SDK dependencies makes them independently testable
3. Update requirement traceability tables during phase execution, not after

### Cost Observations
- Model mix: quality profile throughout
- Sessions: ~5 sessions across 2 days
- Notable: 9 plans averaged very fast execution — well-scoped plans with clear boundaries

---

## Milestone: v1.1 — Improved Reindexing

**Shipped:** 2026-03-07
**Phases:** 5 (6-10) | **Plans:** 11 | **Feat Commits:** 19

### What Was Built
- Branch-aware indexing: git plumbing commands for reliable main/master resolution, ignoring local checkout state
- Surgical file-level re-indexing: only changed files re-processed, with automatic full-rebuild fallback above threshold
- Four new extractors: GraphQL SDL, Absinthe macros, gRPC services, Ecto schemas with associations
- Event Catalog metadata integration via filesystem MDX/YAML parsing
- Parallel repo indexing with p-limit concurrency control
- Search type filtering: parent:subtype FTS convention, --type for granular sub-types, --list-types discovery
- 388 tests across 25 test files

### What Worked
- Auto-advance pipeline (discuss -> plan -> execute) ran smoothly for Phase 10 end-to-end
- Regex extraction approach continued to work well for GraphQL SDL, Absinthe, and Ecto macros
- Three-phase pipeline (sequential DB prep, parallel extraction, serial persistence) was clean architecture for parallelism
- TDD approach in plans produced reliable code — all tests passed first time on most tasks
- Line-by-line schema block parsing (depth tracking) solved nested do...end safely

### What Was Inefficient
- Summary one-liner extraction still returns null — summaries use inconsistent frontmatter format (not fixed from v1.0)
- ROADMAP.md got inconsistent during execution — Phase 10 was split into v1.2 by executor agents but STATE.md still tracked v1.1
- Some plan checkboxes in ROADMAP.md weren't marked [x] during execution (Phases 6-7 plans stayed unchecked)

### Patterns Established
- Parent:subtype composite format for FTS entity_type (extensible to future entity kinds)
- resolveTypeFilter with LIKE patterns for both coarse and granular filtering
- UNINDEXED FTS columns for filterable-but-not-searchable metadata
- Surgical threshold heuristic: <=200 files AND <=50% of repo
- p-limit for parallel extraction, serial persistence for SQLite safety

### Key Lessons
1. Keep ROADMAP.md milestone assignments explicit — executor agents can create accidental milestone splits
2. Auto-advance is powerful but milestone-level state needs manual cleanup afterward
3. Regex extractors scale well to new languages/formats when source files are well-structured
4. FTS UNINDEXED columns are underused — great for metadata filtering without polluting MATCH

### Cost Observations
- Model mix: quality profile (opus) for all agents
- Sessions: ~3 sessions across 2 days
- Notable: Phase 10 ran full pipeline (discuss + plan + execute) in a single session via auto-advance

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change |
|-----------|---------|--------|------------|
| v1.0 | 49 | 5 | Initial build — established layered architecture |
| v1.1 | 19 feat | 5 | Indexing infrastructure + extractors + search filtering |

### Cumulative Quality

| Milestone | Tests | LOC | Files |
|-----------|-------|-----|-------|
| v1.0 | 236 | 8,193 | 116 |
| v1.1 | 388 | 13,258 | ~140 |

### Top Lessons (Verified Across Milestones)

1. Regex extraction scales surprisingly well for well-structured source files (validated v1.0 Elixir/proto, v1.1 GraphQL/Ecto/Absinthe)
2. FTS5 with application-level tokenization handles keyword search effectively without embeddings (confirmed v1.0, extended v1.1 with type filtering)
3. Pure utility modules without framework dependencies make testing trivial (confirmed v1.0 MCP-free utils, v1.1 parallel extraction with dbSnapshot)
4. Keep ROADMAP.md state in sync during execution — cleanup is more expensive than maintenance
