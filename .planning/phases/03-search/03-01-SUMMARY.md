---
phase: 03-search
plan: 01
status: complete
started: "2026-03-05"
completed: "2026-03-05"
---

# Plan 03-01: FTS5 text search and structured entity/dependency queries

## What Was Built

Complete search query layer over the existing SQLite knowledge base:
- `searchText()`: Full-text search via FTS5 with two-step hydration (FTS match then entity-specific JOINs). Supports FTS5 syntax, repo/type filters, graceful error handling.
- `findEntity()`: Structured entity card queries with exact name match + FTS fallback. Includes relationship data from edges table (both incoming and outgoing).
- `queryDependencies()`: BFS graph traversal over edges table. Follows event produce/consume chains between repos. Configurable depth (1, 2, ..., 'all') with cycle detection via visited set.

## Key Files

### Created
- `src/search/types.ts` — All shared types (TextSearchResult, EntityCard, DependencyResult, etc.)
- `src/search/text.ts` — searchText() implementation
- `src/search/entity.ts` — findEntity() implementation
- `src/search/dependencies.ts` — queryDependencies() implementation
- `src/search/index.ts` — Re-exports
- `tests/search/text.test.ts` — 13 tests
- `tests/search/entity.test.ts` — 10 tests
- `tests/search/dependencies.test.ts` — 10 tests

### Modified
- `src/index.ts` — Added search module exports

## Test Results

- 33 new tests added
- 157 total tests passing (no regressions)
- TypeScript compiles cleanly

## Design Decisions

- **Two-step hydration for text search:** FTS5 match first (fast), then type-switch hydration per result. Avoids complex polymorphic JOINs.
- **Repo as service proxy:** Dependencies use repo entities since edges link repos to events (not services to events). This matches the microservice convention where repo name equals service name.
- **BFS over recursive CTE:** Used iterative BFS in TypeScript rather than recursive CTE because the edge semantics require 2-edge-per-hop traversal (repo -> event -> repo). Cleaner logic with visited set for cycle detection.
- **Graceful FTS5 error handling:** On syntax error, retries with phrase-quoted query. On second failure, returns empty array.

## Self-Check: PASSED

- [x] searchText returns results with repo name, file path, snippet
- [x] findEntity returns entity cards with relationship data
- [x] queryDependencies returns upstream/downstream with mechanisms
- [x] Multi-hop traversal with cycle detection works
- [x] All filters (repo, entity type, relationship, direction, depth) work
- [x] Full test suite green (157 tests)
