---
phase: 13-mcp-layer-dedup
plan: 01
subsystem: mcp
tags: [mcp, refactoring, dedup, error-handling, better-sqlite3]

# Dependency graph
requires:
  - phase: 11-safety-net
    provides: Contract tests and golden tests for safe refactoring
provides:
  - resolveDbPath() shared utility in src/db/path.ts
  - wrapToolHandler HOF in src/mcp/handler.ts for error envelope
  - formatSingleResponse() in src/mcp/format.ts for single-object tools
  - All 8 MCP tools using unified McpResponse shape
affects: [13-02, 13-03]

# Tech tracking
tech-stack:
  added: []
  patterns: [wrapToolHandler HOF, formatSingleResponse for single-object tools, resolveDbPath shared utility]

key-files:
  created:
    - src/db/path.ts
    - src/mcp/handler.ts
  modified:
    - src/mcp/format.ts
    - src/cli/db.ts
    - src/mcp/server.ts
    - src/mcp/tools/search.ts
    - src/mcp/tools/entity.ts
    - src/mcp/tools/deps.ts
    - src/mcp/tools/learn.ts
    - src/mcp/tools/forget.ts
    - src/mcp/tools/status.ts
    - src/mcp/tools/cleanup.ts
    - src/mcp/tools/list-types.ts
    - tests/mcp/contracts.test.ts
    - tests/mcp/tools.test.ts

key-decisions:
  - "wrapToolHandler inner handler is sync (returns string) since better-sqlite3 is synchronous; outer wrapper is async for MCP SDK contract"
  - "formatSingleResponse wraps single objects as data[0] for unified McpResponse shape across all tools"
  - "getDbPath() kept as exported name in cli/db.ts for backward compat, delegating to resolveDbPath()"

patterns-established:
  - "wrapToolHandler HOF: all MCP tool callbacks delegate error handling to src/mcp/handler.ts"
  - "Unified McpResponse: every tool returns {summary, data[], total, truncated} -- no exceptions"
  - "resolveDbPath: single source of truth for DB path in src/db/path.ts"

requirements-completed: [MCP-04, MCP-01, MCP-03]

# Metrics
duration: 7min
completed: 2026-03-07
---

# Phase 13 Plan 01: MCP Layer Dedup Summary

**Extracted shared MCP infrastructure (resolveDbPath, wrapToolHandler HOF, formatSingleResponse) and refactored all 8 tool files to eliminate ~48 lines of duplicated error handling with unified McpResponse shape**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-07T17:18:41Z
- **Completed:** 2026-03-07T17:25:51Z
- **Tasks:** 2
- **Files modified:** 15

## Accomplishments
- Created `src/db/path.ts` with `resolveDbPath()` as single source of truth for DB path resolution, used by both CLI and MCP server
- Created `src/mcp/handler.ts` with `wrapToolHandler` HOF that wraps sync tool handlers with try/catch and MCP CallToolResult envelope
- Added `formatSingleResponse()` to `src/mcp/format.ts` for tools that return a single object (learn, forget, status, cleanup, list-types)
- Refactored all 8 MCP tool files to use `wrapToolHandler`, eliminating all inline try/catch blocks
- Updated contract tests and tools tests to expect unified `{summary, data[], total, truncated}` shape

## Task Commits

Each task was committed atomically:

1. **Task 1: Extract DB path utility and error handling HOF** - `80da5bf` (feat)
2. **Task 2: Refactor all 8 tools to use HOF + unified response** - `44805ce` (refactor)

## Files Created/Modified
- `src/db/path.ts` - Shared resolveDbPath() utility
- `src/mcp/handler.ts` - wrapToolHandler HOF for error handling + MCP envelope
- `src/mcp/format.ts` - Added formatSingleResponse() for single-object tools
- `src/cli/db.ts` - Delegates to resolveDbPath()
- `src/mcp/server.ts` - Uses resolveDbPath() instead of inline path logic
- `src/mcp/tools/*.ts` - All 8 tools refactored to use wrapToolHandler
- `tests/mcp/contracts.test.ts` - Updated to expect unified McpResponse shape
- `tests/mcp/tools.test.ts` - Updated data access patterns for array-wrapped responses

## Decisions Made
- wrapToolHandler inner handler is sync (returns string) because all DB operations use better-sqlite3 which is synchronous; the outer wrapper is async to satisfy MCP SDK contract
- formatSingleResponse wraps single objects as `data[0]` in an array for unified McpResponse shape across all 8 tools
- Kept `getDbPath()` as the exported name in cli/db.ts for backward compat, just delegating to the shared `resolveDbPath()`

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- All 8 MCP tools now use consistent patterns (wrapToolHandler, unified McpResponse)
- Ready for Plan 02 (auto-sync dedup) and Plan 03 (EntityType dedup) to operate on clean tool implementations
- All 437 tests passing

## Self-Check: PASSED

All 15 key files verified present. Both task commits (80da5bf, 44805ce) confirmed in git log. 437 tests passing.

---
*Phase: 13-mcp-layer-dedup*
*Completed: 2026-03-07*
