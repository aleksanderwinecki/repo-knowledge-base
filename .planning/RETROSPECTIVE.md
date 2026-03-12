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

## Milestone: v2.1 — Cleanup & Tightening

**Shipped:** 2026-03-09
**Phases:** 2 (21-22) | **Plans:** 4 | **Commits:** 11

### What Was Built
- Complete removal of embedding infrastructure: sqlite-vec, @huggingface/transformers, vec0 table, semantic/hybrid search, kb_semantic MCP tool
- Simplified search layer to FTS5-only (sync, no degradation logic)
- Implicit force for `kb index --repo` (skip staleness check)
- Symlink-aware repo discovery in scanner
- All project metadata (PROJECT.md, CLAUDE.md, README.md) updated to reflect current reality
- 506 tests across 32 test files

### What Worked
- Auto-advance pipeline (plan → execute) ran Phase 22 end-to-end in a single session
- Parallel execution of Wave 1 plans (22-01 code fixes + 22-02 docs update) with no conflicts
- Verifier caught the test count drift (22-01 added 3 tests after 22-02 set count to 503) — quick inline fix
- TDD for scanner symlink support caught edge cases (broken symlinks) that would have been missed

### What Was Inefficient
- Parallel plan execution caused metadata drift: 22-02 wrote test count before 22-01 added tests. Minor but required manual fixup.
- README.md was missed by Phase 22 plans entirely — caught by manual review after execution
- Summary one-liner extraction still broken (null for all summaries)

### Patterns Established
- Cleanup milestones are fast: 4 plans, ~15 min total execution
- `options.repos?.length` as implicit force guard — simple, no new flags needed
- `isSymbolicLink()` + `statSync()` fallback for safe symlink resolution

### Key Lessons
1. When removing a subsystem, check ALL documentation surfaces (README was missed despite CLAUDE.md and PROJECT.md being covered)
2. Parallel plan execution with shared metadata (test counts) needs ordering awareness or a reconciliation step
3. Cleanup milestones that reduce LOC and complexity are high-value — the codebase is more maintainable after v2.1 than before

### Cost Observations
- Model mix: quality profile (opus) for all agents
- Sessions: 1 session, ~30 min total
- Notable: Entire milestone (plan + execute + verify + archive) completed in a single context window

---

## Milestone: v4.2 — Search Quality

**Shipped:** 2026-03-12
**Phases:** 4 (34-37) | **Plans:** 6 | **Duration:** 2 days

### What Was Built
- OR-default FTS queries with BM25 ranking and AND→OR→prefix progressive relaxation
- nextAction hints on every search result mapping entity types to optimal follow-up MCP tools
- FTS descriptions enriched with repo name for cross-repo disambiguation, event: context prefix for proto fields
- Ecto module attribute resolution (~w(...)a and [:atom] forms), cast/4 extraction, Set-based pipeline nullability
- Event consumer tracking in kb_field_impact: inferred/confirmed confidence tiers with via chains
- Fixed Kafka extractor: @topic (DB-outbox) + @topic_name (Kafkaesque) both now detected
- 863 tests, 51 files changed, +6270/-274 LOC

### What Worked
- TDD discipline: RED→GREEN commits on every task, no skipped test phases
- Phase scoping: 4 well-bounded phases, each delivering a discrete capability
- Query-time bridging approach: no schema changes needed for consumer detection, same-repo co-occurrence was sufficient
- Bug found in real usage (0 consumers for `capacity` field) led to meaningful extractor fix before archiving
- All plans shipped in <10 minutes each — tight scope, clear deliverables

### What Was Inefficient
- Kafka extractor gap (missing @topic pattern) was found after execution completed, not during planning
- ECT-02 ended up checked by fixing the extractor — the requirement was written for a different concern but the fix satisfied the intent

### Patterns Established
- Tokenize-then-join: always tokenize individual terms before joining with FTS operators (prevents lowercase operator destruction)
- Consumer confidence tiers: `inferred` (topic subscription only) vs `confirmed` (topic + ecto field match)
- Via chains on consumers: show WHY a service appears as a consumer (topic + event)
- FTS description formula: `[repo name] [summary/type context]` — repo name always first for disambiguation

### Key Lessons
1. Test features against real data before closing a phase — the 0-consumers bug surfaced only when manually testing with `capacity` field
2. Regex extractor gaps are most valuable to fix right before a milestone archive, when the context is fresh
3. Small scope wins: 4 phases averaging 2-4 days combined delivery feels sustainable for quality milestones
4. `Map<repoId, T>` for dedup with in-place upgrades is a cleaner pattern than Set + object patch

### Cost Observations
- Model mix: quality profile (opus) for all agents
- Sessions: ~3 sessions across 2 days
- Notable: Phase 37 was discovered-and-fixed during the archiving session — bug surfaced by real query, fixed same session

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change |
|-----------|---------|--------|------------|
| v1.0 | 49 | 5 | Initial build — established layered architecture |
| v1.1 | 19 feat | 5 | Indexing infrastructure + extractors + search filtering |
| v1.2 | 45 | 5 | Hardening — safety nets, perf tuning, dedup, strict TS |
| v2.0 | ~30 | 5 | Topology extraction, semantic search, targeted reindex |
| v2.1 | 11 | 2 | Cleanup — removed embeddings, fixed UX, updated docs |
| v4.2 | 15 | 4 | Search quality — OR default, consumer tracking, Ecto depth |

### Cumulative Quality

| Milestone | Tests | LOC | Net Change |
|-----------|-------|-----|------------|
| v1.0 | 236 | 8,193 | +8,193 |
| v1.1 | 388 | 13,258 | +5,065 |
| v1.2 | 435 | 14,249 | +991 (mostly dedup savings) |
| v2.0 | ~560 | ~9,000 | +4,700 (topology + embeddings) |
| v2.1 | 506 | 6,796 | -2,108 (cleanup milestone) |
| v4.2 | 863 | ~10,000 | +6,270 (search quality + field depth) |

### Top Lessons (Verified Across Milestones)

1. Regex extraction scales surprisingly well for well-structured source files (validated v1.0 Elixir/proto, v1.1 GraphQL/Ecto/Absinthe, v2.0 gRPC/HTTP/Kafka)
2. FTS5 with application-level tokenization handles keyword search effectively — embeddings proved impractical at scale (confirmed v1.0, extended v1.1, validated by v2.1 removal)
3. Pure utility modules without framework dependencies make testing trivial (confirmed across all milestones)
4. Keep ROADMAP.md state in sync during execution — cleanup is more expensive than maintenance
5. Check ALL documentation surfaces after subsystem removal (README missed in v2.1 despite CLAUDE.md/PROJECT.md being covered)
6. Cleanup milestones that reduce complexity are high-value — less code to maintain, faster onboarding for AI agents
