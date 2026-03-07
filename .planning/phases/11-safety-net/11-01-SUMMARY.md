---
phase: 11-safety-net
plan: 01
subsystem: testing
tags: [mcp, contract-tests, vitest, zod, schema-introspection]

# Dependency graph
requires: []
provides:
  - MCP tool contract tests (input schemas + output shapes) for all 8 tools
  - Safety net preventing accidental API surface breakage during refactoring
affects: [13-mcp-dedup]

# Tech tracking
tech-stack:
  added: []
  patterns: [Zod schema introspection via _registeredTools for contract assertions, sorted Object.keys equality for exact shape pinning]

key-files:
  created: [tests/mcp/contracts.test.ts]
  modified: []

key-decisions:
  - "Used sorted Object.keys equality (not toHaveProperty) so additions AND removals are caught"
  - "kb_forget data shape has only { deleted } -- no id field in response data despite plan suggestion"
  - "Nested shape verification for kb_status (counts + staleness) and kb_learn (fact fields)"

patterns-established:
  - "Contract test pattern: introspect _registeredTools.inputSchema.def.shape for param names/types"
  - "Output shape pattern: exact sorted key set comparison with Object.keys().sort() + toEqual"

requirements-completed: [SAFE-01]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 11 Plan 01: MCP Tool Contract Tests Summary

**16 contract tests pinning input schemas and output shapes for all 8 MCP tools via Zod introspection and exact key-set assertions**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T15:45:44Z
- **Completed:** 2026-03-07T15:48:27Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- 8 input schema contract tests verifying exact parameter names, types (string/number/optional), and count per tool
- 8 output shape contract tests verifying exact response key sets, value types, and nested structure
- Tests use exact key enumeration (sorted equality) so both additions and removals are caught
- Full test suite remains green (2 pre-existing failures in golden.test.ts unrelated to this work)

## Task Commits

Each task was committed atomically:

1. **Task 1: MCP input schema contract tests for all 8 tools** - `0776155` (test)
2. **Task 2: MCP output shape contract tests for all 8 tools** - `4ebc5bf` (test)

## Files Created/Modified
- `tests/mcp/contracts.test.ts` - 365-line contract test file with 16 tests covering all 8 MCP tools

## Decisions Made
- Used `Object.keys().sort()` + `toEqual` instead of `toHaveProperty` for exact shape matching -- catches both additions and removals
- Verified kb_forget returns `{ deleted }` only (not `{ deleted, id }` as plan hinted) -- matches actual source code
- Used separate `beforeEach` data seeding in output shape block (not shared with input schema tests) for isolation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Contract tests are in place for all 8 MCP tools
- Phase 13 (MCP dedup) can now refactor tool internals with confidence that any public surface changes will be caught
- Pre-existing golden.test.ts failures (2 tests) are unrelated and should be tracked separately

## Self-Check: PASSED

- [x] tests/mcp/contracts.test.ts exists (365 lines, >= 200 minimum)
- [x] Commit 0776155 exists (Task 1)
- [x] Commit 4ebc5bf exists (Task 2)
- [x] 16 tests pass (8 input schema + 8 output shape)

---
*Phase: 11-safety-net*
*Completed: 2026-03-07*
