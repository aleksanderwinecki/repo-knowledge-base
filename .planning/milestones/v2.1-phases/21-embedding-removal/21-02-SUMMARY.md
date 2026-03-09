---
phase: 21-embedding-removal
plan: 02
subsystem: testing
tags: [vitest, fts5, test-cleanup, documentation]

# Dependency graph
requires:
  - phase: 21-embedding-removal plan 01
    provides: removed embedding source files, semantic/hybrid search, vec module, V8 migration
provides:
  - All embedding-related test files removed
  - Remaining tests updated for FTS5-only codebase
  - CLAUDE.md and skill/SKILL.md reflect FTS5-only search
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [FTS5-only search testing]

key-files:
  created: []
  modified:
    - tests/mcp/tools.test.ts
    - tests/mcp/server.test.ts
    - tests/cli/search.test.ts
    - tests/db/schema.test.ts
    - tests/knowledge/store.test.ts
    - CLAUDE.md
    - skill/SKILL.md

key-decisions:
  - "embedded_schema references in Elixir indexer are domain-specific (Ecto), not embedding infrastructure -- left as-is"

patterns-established: []

requirements-completed: [CLEAN-06]

# Metrics
duration: 4min
completed: 2026-03-09
---

# Phase 21 Plan 02: Test & Doc Cleanup Summary

**Removed 6 embedding test files (1359 lines), updated 5 test files for FTS5-only assertions, and cleaned embedding references from CLAUDE.md and skill/SKILL.md**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-09T10:17:19Z
- **Completed:** 2026-03-09T10:21:55Z
- **Tasks:** 2
- **Files modified:** 13 (6 deleted, 7 modified)

## Accomplishments
- Deleted all embedding-specific test files: tests/embeddings/ directory (3 files), tests/db/vec.test.ts, tests/search/hybrid.test.ts, tests/search/semantic.test.ts
- Updated tools.test.ts (removed kb_semantic block and hybrid/semantic mocks), server.test.ts (9 tools instead of 10), search.test.ts (FTS5 default tests replacing hybrid/semantic), schema.test.ts (removed V8 migration tests)
- Updated CLAUDE.md and skill/SKILL.md to reflect FTS5-only search with accurate test count (503)

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete embedding test files and update remaining tests** - `a02cc5c` (feat)
2. **Task 2: Update documentation to reflect FTS5-only search** - `3273579` (docs)

## Files Created/Modified
- `tests/embeddings/integration.test.ts` - Deleted (embedding integration tests)
- `tests/embeddings/pipeline.test.ts` - Deleted (embedding pipeline tests)
- `tests/embeddings/text.test.ts` - Deleted (embedding text generation tests)
- `tests/db/vec.test.ts` - Deleted (sqlite-vec extension tests)
- `tests/search/hybrid.test.ts` - Deleted (hybrid search tests)
- `tests/search/semantic.test.ts` - Deleted (semantic search tests)
- `tests/mcp/tools.test.ts` - Removed kb_semantic block, hybrid/semantic mocks, embeddings field from IndexStats
- `tests/mcp/server.test.ts` - Updated expected tools from 10 to 9, removed kb_semantic
- `tests/cli/search.test.ts` - Replaced --semantic/hybrid tests with FTS5 default tests
- `tests/db/schema.test.ts` - Removed V8 migration tests, updated SCHEMA_VERSION assertion to 7
- `tests/knowledge/store.test.ts` - Updated SCHEMA_VERSION assertion from 8 to 7
- `CLAUDE.md` - Removed --semantic, --embed references; updated test count to 503
- `skill/SKILL.md` - Removed --semantic search refinement option

## Decisions Made
- `embedded_schema` references in Elixir indexer (src/indexer/elixir.ts) are Ecto-specific domain terminology, not embedding infrastructure -- left untouched

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed SCHEMA_VERSION assertion in store.test.ts**
- **Found during:** Task 1
- **Issue:** tests/knowledge/store.test.ts also asserted SCHEMA_VERSION === 8, not listed in plan
- **Fix:** Updated assertion from 8 to 7
- **Files modified:** tests/knowledge/store.test.ts
- **Verification:** npm test passes (503 tests)
- **Committed in:** a02cc5c (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for test suite to pass. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Embedding removal is complete across source, tests, and documentation
- Zero references to semantic search, hybrid search, sqlite-vec, or transformers.js remain
- 503 tests pass, build succeeds

---
*Phase: 21-embedding-removal*
*Completed: 2026-03-09*
