---
phase: 20-targeted-repo-reindex-with-git-refresh
plan: 02
subsystem: mcp
tags: [mcp, reindex, git-refresh, zod, tool-registration]

# Dependency graph
requires:
  - phase: 20-targeted-repo-reindex-with-git-refresh
    provides: "indexAllRepos with repos[] filter and refresh option"
provides:
  - "kb_reindex MCP tool for AI agents to trigger targeted repo reindexing"
  - "10-tool MCP server (was 9)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["MCP tool with runtime validation guard for direct-call compatibility"]

key-files:
  created: ["src/mcp/tools/reindex.ts"]
  modified: ["src/mcp/server.ts", "tests/mcp/tools.test.ts", "tests/mcp/server.test.ts"]

key-decisions:
  - "refresh defaults to true in handler (not just zod) for direct-call compatibility"
  - "Handler-level empty repos guard alongside zod .min(1) for defense-in-depth"
  - "force: true always set since explicit reindex implies skip staleness check"

patterns-established:
  - "Runtime param defaults in handler body when zod defaults may be bypassed by direct tool.handler() calls"

requirements-completed: [RIDX-05]

# Metrics
duration: 3min
completed: 2026-03-09
---

# Phase 20 Plan 02: MCP Reindex Tool Summary

**kb_reindex MCP tool enabling AI agents to trigger targeted repo reindexing with git refresh, defaulting refresh=true**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-09T09:13:01Z
- **Completed:** 2026-03-09T09:16:01Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 4

## Accomplishments
- kb_reindex MCP tool registered in server (10 tools total)
- Tool accepts { repos: string[], refresh?: boolean } with refresh defaulting to true
- Returns JSON with summary, per-repo results array, and total count
- All 561 tests pass, clean TypeScript build

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: kb_reindex failing tests** - `d4ae161` (test)
2. **Task 1 GREEN: kb_reindex implementation** - `6113b8b` (feat)

_TDD task with RED/GREEN commits._

## Files Created/Modified
- `src/mcp/tools/reindex.ts` - registerReindexTool function calling indexAllRepos with force/repos/refresh
- `src/mcp/server.ts` - Wire registerReindexTool as 10th tool in createServer
- `tests/mcp/tools.test.ts` - 5 tests: empty repos error, reindex with refresh, default refresh, explicit refresh=false, error count in summary
- `tests/mcp/server.test.ts` - Updated tool count assertion from 9 to 10

## Decisions Made
- refresh defaults to true in handler body (not relying solely on zod .default()) for compatibility with direct handler calls that bypass schema parsing
- Handler throws on empty repos array as defense-in-depth alongside zod .min(1)
- force: true always set because explicit reindex means skip staleness checks

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added runtime refresh default and empty repos guard**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test helper callTool() invokes handler directly, bypassing zod schema parsing. This meant zod .default(true) for refresh and .min(1) for repos were not applied.
- **Fix:** Added `refresh ?? true` default and `repos.length === 0` guard in handler body
- **Files modified:** src/mcp/tools/reindex.ts
- **Verification:** All 5 reindex tests pass including empty repos error and default refresh
- **Committed in:** 6113b8b (GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Defense-in-depth improvement. Handler works correctly both via MCP SDK (zod parses) and via direct calls (handler validates).

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 20 complete: targeted repo reindex with git refresh fully wired for CLI (20-01) and MCP (20-02)
- AI agents can now call kb_reindex to proactively refresh stale repos

## Self-Check: PASSED

- src/mcp/tools/reindex.ts: FOUND
- 20-02-SUMMARY.md: FOUND
- Commit d4ae161 (RED): FOUND
- Commit 6113b8b (GREEN): FOUND

---
*Phase: 20-targeted-repo-reindex-with-git-refresh*
*Completed: 2026-03-09*
