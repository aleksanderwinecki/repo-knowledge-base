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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change |
|-----------|---------|--------|------------|
| v1.0 | 49 | 5 | Initial build — established layered architecture |

### Cumulative Quality

| Milestone | Tests | LOC | Files |
|-----------|-------|-----|-------|
| v1.0 | 236 | 8,193 | 116 |

### Top Lessons (Verified Across Milestones)

1. (First milestone — lessons to be verified in v1.1+)
