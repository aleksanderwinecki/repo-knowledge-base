---
phase: 17-topology-query-layer
plan: 02
subsystem: cli-mcp
tags: [topology, dependencies, mechanism-filter, cli, mcp, zod, commander]

# Dependency graph
requires:
  - phase: 17-topology-query-layer-01
    provides: Generalized BFS dependency query engine with VALID_MECHANISMS export and mechanism filtering
provides:
  - CLI --mechanism flag for filtering deps by communication type (grpc, http, gateway, kafka, event)
  - MCP kb_deps tool mechanism parameter with zod enum validation
  - Confidence field exposed as structured data in MCP responses
  - JSON error output for invalid mechanism values
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [mechanism-flag-wiring, zod-enum-from-const-array]

key-files:
  created: []
  modified:
    - src/cli/commands/deps.ts
    - src/mcp/tools/deps.ts
    - tests/mcp/contracts.test.ts

key-decisions:
  - "Manual mechanism validation with outputError() in CLI rather than commander .choices() to keep JSON error format consistent"
  - "Cast VALID_MECHANISMS to [string, ...string[]] tuple type for zod .enum() compatibility"

patterns-established:
  - "Const array to zod enum: z.enum(CONST_ARRAY as [string, ...string[]]) for shared validation between CLI and MCP"

requirements-completed: [TOPO-05, TOPO-06]

# Metrics
duration: 2min
completed: 2026-03-08
---

# Phase 17 Plan 02: CLI/MCP Mechanism Wiring Summary

**CLI --mechanism flag and MCP mechanism param wired to dependency query engine with validation and confidence in output**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-08T12:10:54Z
- **Completed:** 2026-03-08T12:12:43Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- CLI `kb deps` command now accepts `--mechanism <type>` flag to filter by communication mechanism
- Invalid mechanism values produce clear JSON error listing valid options via outputError()
- MCP `kb_deps` tool accepts optional `mechanism` parameter validated by zod enum
- Confidence field automatically included in MCP responses as structured data on each DependencyNode
- All 484 tests pass including updated MCP contract test

## Task Commits

Each task was committed atomically:

1. **Task 1: Add --mechanism flag to CLI deps command** - `a04be2b` (feat)
2. **Task 2: Add mechanism param to MCP deps tool** - `028e231` (feat)

## Files Created/Modified
- `src/cli/commands/deps.ts` - Added --mechanism option, VALID_MECHANISMS validation, mechanism passthrough to queryDependencies
- `src/mcp/tools/deps.ts` - Added mechanism zod enum param, passthrough to both queryDependencies calls
- `tests/mcp/contracts.test.ts` - Updated kb_deps schema contract to include mechanism parameter

## Decisions Made
- Used manual validation with outputError() in CLI rather than commander's .choices() to maintain consistent JSON error format across all CLI commands
- Cast VALID_MECHANISMS string array to `[string, ...string[]]` tuple type for zod's .enum() which requires non-empty tuple

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated MCP contract test for new mechanism parameter**
- **Found during:** Task 2 (MCP deps tool)
- **Issue:** Contract test expected exactly 4 params for kb_deps, but mechanism is now a 5th
- **Fix:** Updated assertion to include 'mechanism' in expected params array and bumped count to 5
- **Files modified:** tests/mcp/contracts.test.ts
- **Verification:** All 59 MCP tests pass
- **Committed in:** 028e231

---

**Total deviations:** 1 auto-fixed (1 bug in test assertion)
**Impact on plan:** Test correction only. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 17 complete: dependency query engine generalized and exposed via CLI and MCP
- All topology edge types (gRPC, HTTP, gateway, Kafka, events) queryable with mechanism filtering
- Ready for Phase 18: Embedding Storage (sqlite-vec)

## Self-Check: PASSED

All files verified on disk and commits verified in git log.

---
*Phase: 17-topology-query-layer*
*Completed: 2026-03-08*
