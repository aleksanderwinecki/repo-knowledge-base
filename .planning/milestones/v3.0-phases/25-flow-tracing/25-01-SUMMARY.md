---
phase: 25-flow-tracing
plan: 01
subsystem: search
tags: [graph, bfs, shortest-path, trace, arrow-chain]

# Dependency graph
requires:
  - phase: 23-graph-module
    provides: buildGraph, shortestPath, GraphHop, ServiceGraph
provides:
  - traceRoute function with input validation and response formatting
  - TraceResult and TraceHop types (clean response contract)
  - Arrow-chain path_summary builder
  - Barrel re-exports from src/search/index.ts
affects: [25-02 MCP & CLI wiring, future trace features]

# Tech tracking
tech-stack:
  added: []
  patterns: [arrow-chain path summary, conditional via field for event/kafka hops]

key-files:
  created:
    - src/search/trace.ts
    - tests/search/trace.test.ts
  modified:
    - src/search/index.ts

key-decisions:
  - "Non-null assertion with ! for hops[0] after length guard (TS strict mode)"
  - "via field conditionally included only for event/kafka mechanisms with non-null value"

patterns-established:
  - "Arrow-chain summary: A -[mechanism]-> B -[mechanism: via]-> C"
  - "Upfront validation of both from/to services, single error with all missing names"

requirements-completed: [TRACE-01, TRACE-02, TRACE-03, TRACE-04]

# Metrics
duration: 3min
completed: 2026-03-09
---

# Phase 25 Plan 01: Core Trace Module Summary

**traceRoute() function wrapping shortestPath with arrow-chain summaries, dual-service validation, and via-conditional hop formatting**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-09T15:28:58Z
- **Completed:** 2026-03-09T15:32:32Z
- **Tasks:** 3 (TDD RED + GREEN + TS fix)
- **Files modified:** 3

## Accomplishments
- traceRoute() with complete input validation (both services checked upfront, same-service shortcut)
- Arrow-chain path_summary with via only for event/kafka hops (grpc/http/gateway omit via entirely)
- Three distinct error types: single missing service, both missing, no path
- 21 unit tests covering all behaviors from the plan's behavior spec
- Zero confidence fields in response (TRACE-04 simplification)
- Full test suite green: 631/631 tests, zero regressions

## Task Commits

Each task was committed atomically:

1. **TDD RED: Failing tests** - `3333195` (test)
2. **TDD GREEN: Implementation + barrel exports** - `cc35ef2` (feat)
3. **TS strict-mode fix** - `624df87` (fix)

_TDD plan with RED/GREEN commits plus one auto-fix for TypeScript strict mode._

## Files Created/Modified
- `src/search/trace.ts` - traceRoute function, TraceHop/TraceResult types, buildPathSummary helper (112 lines)
- `tests/search/trace.test.ts` - 21 unit tests covering response shape, arrow chain, via field, same-service, errors, confidence absence (380 lines)
- `src/search/index.ts` - Added barrel re-exports for traceRoute, TraceResult, TraceHop

## Decisions Made
- Used non-null assertion (!) for hops[0] after length guard -- TypeScript doesn't narrow array index access even with length check
- via field conditionally included using explicit property assignment (not spread) to ensure it's truly omitted from the object when not applicable

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test using invalid Chai matcher toStartWith**
- **Found during:** TDD GREEN phase
- **Issue:** Test used `expect(e.message).toStartWith()` which doesn't exist in vitest/chai
- **Fix:** Changed to `expect(e.message).toMatch(/^Services not found:/)`
- **Files modified:** tests/search/trace.test.ts
- **Verification:** All 21 tests pass
- **Committed in:** cc35ef2 (GREEN commit)

**2. [Rule 1 - Bug] Fixed TypeScript strict-mode error in buildPathSummary**
- **Found during:** Build verification after GREEN phase
- **Issue:** `hops[0].from` flagged as possibly undefined by TypeScript strict mode (TS2532)
- **Fix:** Added non-null assertion `hops[0]!.from` after the `hops.length === 0` early return guard
- **Files modified:** src/search/trace.ts
- **Verification:** `npm run build` compiles cleanly, all tests still pass
- **Committed in:** 624df87

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- traceRoute is exported and ready for MCP and CLI wiring in plan 25-02
- TraceResult/TraceHop types available for direct consumption by tool handlers
- No compact formatter needed (trace responses are inherently small)

## Self-Check: PASSED

All files and commits verified:
- src/search/trace.ts: FOUND
- tests/search/trace.test.ts: FOUND
- .planning/phases/25-flow-tracing/25-01-SUMMARY.md: FOUND
- Commit 3333195 (RED): FOUND
- Commit cc35ef2 (GREEN): FOUND
- Commit 624df87 (fix): FOUND

---
*Phase: 25-flow-tracing*
*Completed: 2026-03-09*
