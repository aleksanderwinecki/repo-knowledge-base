---
phase: 11-safety-net
plan: 02
subsystem: testing
tags: [fts5, golden-tests, snapshot-tests, vitest, search-quality]

# Dependency graph
requires:
  - phase: none
    provides: existing search/entity/knowledge functions
provides:
  - Shared seed data module (tests/fixtures/seed.ts) for 2-repo test scenarios
  - 15 FTS golden query tests locking search quality across all code paths
  - 8 CLI output shape snapshot tests locking JSON structure of all data-producing functions
affects: [12-db-performance, 14-core-dedup, 13-search-ux]

# Tech tracking
tech-stack:
  added: []
  patterns: [golden-test-pattern, exact-key-set-assertions, shared-seed-data]

key-files:
  created:
    - tests/fixtures/seed.ts
    - tests/search/golden.test.ts
    - tests/cli/snapshots.test.ts
  modified: []

key-decisions:
  - "Golden tests reflect actual tokenizer behavior: FTS5 operators (OR/NOT) lowercased by tokenizer, prefix * stripped"
  - "forgetFact returns boolean (not {deleted, id} object) per actual implementation"
  - "Snapshot tests assert both toMatchObject shape AND exact key sets to catch additions/removals"

patterns-established:
  - "Golden test pattern: assert names/presence/absence, never exact relevance scores"
  - "Shared seed module: seedTestData(db) provides consistent 2-repo dataset"
  - "Shape snapshot pattern: toMatchObject + Object.keys().sort() equality"

requirements-completed: [SAFE-02, SAFE-03]

# Metrics
duration: 5min
completed: 2026-03-07
---

# Phase 11 Plan 02: FTS Golden & CLI Snapshot Tests Summary

**15 FTS golden query tests + 8 CLI output shape snapshots locking search quality and JSON structure for safe refactoring**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-07T15:45:45Z
- **Completed:** 2026-03-07T15:50:37Z
- **Tasks:** 3
- **Files created:** 3

## Accomplishments
- Shared seed data module with 2 repos, 5 modules, 1 event, 1 service, 2 learned facts
- 15 golden query tests covering: basic MATCH, phrase, AND, OR, NOT, prefix, type filters (granular + coarse), entity exact match, entity FTS fallback, repo filter, empty results, syntax error fallback, learned fact search, service search
- 8 CLI output shape tests covering: searchText, findEntity, listAvailableTypes, queryDependencies, status, learnFact, listFacts, forgetFact
- Full test suite green (427 tests, 0 regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create shared seed data module** - `716e725` (feat)
2. **Task 2: FTS golden query tests** - `9f12005` (test)
3. **Task 3: CLI output shape snapshot tests** - `e8df2bb` (test)

## Files Created/Modified
- `tests/fixtures/seed.ts` - Shared 2-repo seed data (booking-service, payments-service)
- `tests/search/golden.test.ts` - 15 FTS golden query tests exercising all search code paths
- `tests/cli/snapshots.test.ts` - 8 CLI output shape snapshot tests with exact key assertions

## Decisions Made
- Golden tests document actual tokenizer behavior: FTS5 operators OR/NOT are lowercased by tokenizer and lose their operator semantics; prefix `*` is stripped. Tests lock this behavior rather than pretending operators work.
- `forgetFact` returns `boolean`, not `{deleted, id}` as plan's interface spec suggested. Tests adapted to match real implementation.
- Each snapshot test asserts both shape (via `toMatchObject`) and exact key set (via `Object.keys().sort()`) to catch field additions and removals, not just missing fields.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] FTS5 operator tests adjusted to match tokenizer reality**
- **Found during:** Task 2 (FTS golden query tests)
- **Issue:** Plan specified OR/NOT/prefix queries as exercising FTS5 operator code paths, but the tokenizer lowercases all input (turning `OR` into `or`, stripping `*`), so these operators have no effect
- **Fix:** Rewrote tests 4 (OR), 5 (NOT), and 8 (prefix) to document actual system behavior: OR degrades to separate queries, NOT becomes implicit AND of 3 terms, prefix is stripped
- **Files modified:** tests/search/golden.test.ts
- **Verification:** All 15 golden tests pass
- **Committed in:** 9f12005 (Task 2 commit)

**2. [Rule 1 - Bug] forgetFact return type corrected**
- **Found during:** Task 3 (CLI snapshot tests)
- **Issue:** Plan interface spec showed `forgetFact` returning `{deleted: boolean, id: number}` but actual implementation returns plain `boolean`
- **Fix:** Snapshot test asserts `boolean` return type matching actual implementation
- **Files modified:** tests/cli/snapshots.test.ts
- **Verification:** All 8 snapshot tests pass
- **Committed in:** e8df2bb (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs in plan spec vs reality)
**Impact on plan:** Both fixes ensure tests reflect actual system behavior. No scope creep.

## Issues Encountered
None beyond the deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Safety net (Plans 01 + 02) complete: contract tests + golden tests + CLI snapshots
- Phase 12 (DB performance) and Phase 14 (core dedup) can proceed with confidence that search quality and output shapes are regression-tested
- Notable finding: FTS5 operators don't actually work due to tokenizer -- Phase 13 (search UX) may want to address this

## Self-Check: PASSED

- tests/fixtures/seed.ts: FOUND
- tests/search/golden.test.ts: FOUND
- tests/cli/snapshots.test.ts: FOUND
- Commit 716e725: FOUND
- Commit 9f12005: FOUND
- Commit e8df2bb: FOUND

---
*Phase: 11-safety-net*
*Completed: 2026-03-07*
