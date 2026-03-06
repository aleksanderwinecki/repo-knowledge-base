---
phase: 05-mcp-server
plan: 01
subsystem: mcp
tags: [mcp, formatting, sync, hygiene, vitest]

requires:
  - phase: 04-cli-knowledge
    provides: "learned_facts table, clearRepoEntities, indexSingleRepo, getCurrentCommit"
provides:
  - "formatResponse: size-constrained MCP response builder (<4KB)"
  - "checkAndSyncRepos: staleness detection with 3-repo re-index cap"
  - "detectDeletedRepos, pruneDeletedRepos: orphaned repo cleanup"
  - "flagStaleFacts: stale fact detection without deletion"
affects: [05-02-PLAN]

tech-stack:
  added: []
  patterns: [mcp-utility-module, recursive-size-reduction, mock-based-sync-testing]

key-files:
  created:
    - src/mcp/format.ts
    - src/mcp/sync.ts
    - src/mcp/hygiene.ts
    - tests/mcp/format.test.ts
    - tests/mcp/sync.test.ts
    - tests/mcp/hygiene.test.ts
  modified: []

key-decisions:
  - "No MCP SDK dependency in utility modules -- pure data/DB operations for easy testing"
  - "Recursive halving strategy for response sizing instead of binary search"
  - "String field truncation as last resort when single item exceeds 4KB"

patterns-established:
  - "MCP utility modules: pure functions tested independently from MCP wiring"
  - "vi.mock for external dependencies (git, pipeline) in sync tests"
  - "Real temp-dir SQLite databases for hygiene tests (matching project convention)"

requirements-completed: [MCP-02, MCP-03, MCP-04]

duration: 3min
completed: 2026-03-06
---

# Phase 5 Plan 1: MCP Utility Modules Summary

**Three tested utility modules (format, sync, hygiene) providing <4KB response enforcement, stale-repo auto-sync with 3-repo cap, and deleted-repo detection/pruning**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-06T09:09:05Z
- **Completed:** 2026-03-06T09:12:15Z
- **Tasks:** 2
- **Files created:** 6

## Accomplishments
- formatResponse enforces <4KB JSON output via recursive item halving and string truncation
- checkAndSyncRepos detects stale repos by comparing HEAD SHA to stored commit, caps re-indexing at 3 per query
- detectDeletedRepos and pruneDeletedRepos find and clean up repos whose disk path no longer exists
- flagStaleFacts returns learned facts older than N days without deleting them
- 21 new tests passing, full suite at 218 (up from 197, zero regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Response formatting module with 4KB enforcement** - `0437596` (feat)
2. **Task 2: Auto-sync and data hygiene modules** - `46c162b` (feat)

## Files Created/Modified
- `src/mcp/format.ts` - Response formatting with McpResponse type, recursive <4KB enforcement
- `src/mcp/sync.ts` - Staleness detection and capped re-indexing (MAX_SYNC_PER_QUERY=3)
- `src/mcp/hygiene.ts` - Deleted repo detection, entity pruning via clearRepoEntities, stale fact flagging
- `tests/mcp/format.test.ts` - 8 tests: sizing, truncation, empty input, custom summary, valid JSON
- `tests/mcp/sync.test.ts` - 6 tests: no-stale, re-index, cap at 3, skip missing path/DB, result shape
- `tests/mcp/hygiene.test.ts` - 7 tests: detect deleted, detect none, prune entities, idempotent, stale facts, no deletion, default 90 days

## Decisions Made
- No MCP SDK dependency in utility modules -- keeps them testable as pure data/DB operations
- Recursive halving for response sizing: simpler than binary search, converges fast for typical payloads
- String field truncation as last resort (only when a single item exceeds 4KB)

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All three utility modules ready for import by MCP tool handlers in Plan 02
- Exports: formatResponse, checkAndSyncRepos, detectDeletedRepos, pruneDeletedRepos, flagStaleFacts
- No blockers for MCP SDK wiring

## Self-Check: PASSED

- All 6 files exist on disk
- Commits 0437596 and 46c162b verified in git log
- 218 tests passing (21 new, 0 regressions)

---
*Phase: 05-mcp-server*
*Completed: 2026-03-06*
