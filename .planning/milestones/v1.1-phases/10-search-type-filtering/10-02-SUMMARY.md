---
phase: 10-search-type-filtering
plan: 02
subsystem: cli, mcp, search
tags: [commander, zod, mcp-tools, type-filtering, fts5]

# Dependency graph
requires:
  - phase: 10-search-type-filtering plan 01
    provides: resolveTypeFilter, listAvailableTypes, composite entity_type format
provides:
  - CLI --type flag accepts coarse and sub-type values
  - CLI --list-types flag for type discovery
  - MCP kb_search type parameter
  - MCP kb_list_types tool
  - Updated skill docs for type filtering
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - MCP tool with no parameters (empty Zod schema)
    - CLI optional argument with fallback validation

key-files:
  created:
    - src/mcp/tools/list-types.ts
  modified:
    - src/cli/commands/search.ts
    - src/mcp/tools/search.ts
    - src/mcp/tools/entity.ts
    - src/mcp/server.ts
    - src/search/index.ts
    - skill/SKILL.md
    - tests/mcp/tools.test.ts
    - tests/mcp/server.test.ts

key-decisions:
  - "Import listAvailableTypes directly from db/fts.js in CLI rather than through search barrel (shorter path for CLI-only use)"
  - "outputError with MISSING_QUERY code when no query and no --list-types (explicit error vs silent help)"

patterns-established:
  - "MCP tools with no params use empty object {} for Zod schema"

requirements-completed: [TF-07, TF-08]

# Metrics
duration: 4min
completed: 2026-03-07
---

# Phase 10 Plan 02: CLI & MCP Interface Summary

**CLI --type extended for sub-types, --list-types added, MCP kb_search gains type param, new kb_list_types tool created**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-07T12:28:14Z
- **Completed:** 2026-03-07T12:32:07Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Extended CLI --type flag to accept both coarse types (module, event) and granular sub-types (schema, grpc, graphql_query)
- Added CLI --list-types flag that outputs grouped type counts as JSON
- Added type parameter to MCP kb_search tool for filtered search
- Created new MCP kb_list_types tool for type discovery
- Updated skill documentation with sub-type filtering examples

## Task Commits

Each task was committed atomically:

1. **Task 1: CLI --type extension and --list-types flag** - `1281c5f` (feat)
2. **Task 2: MCP tools type parameter and kb_list_types** - `3c3d89c` (feat)

## Files Created/Modified
- `src/cli/commands/search.ts` - Extended --type description, added --list-types flag, made query optional
- `src/mcp/tools/search.ts` - Added type Zod parameter, passes entityTypeFilter to searchText
- `src/mcp/tools/entity.ts` - Updated type description to mention sub-types
- `src/mcp/tools/list-types.ts` - New kb_list_types MCP tool
- `src/mcp/server.ts` - Wired registerListTypesTool (8 tools total)
- `src/search/index.ts` - Re-exported listAvailableTypes from db/fts
- `skill/SKILL.md` - Added sub-type filtering and --list-types documentation
- `tests/mcp/tools.test.ts` - Added type filtering and list-types tests
- `tests/mcp/server.test.ts` - Updated tool count assertion from 7 to 8

## Decisions Made
- Imported listAvailableTypes directly from db/fts.js in CLI (shorter path, no need to go through search barrel for CLI-only use)
- Used outputError with MISSING_QUERY code when query missing and --list-types not set

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed server.test.ts tool count assertion**
- **Found during:** Task 2 (MCP tools type parameter and kb_list_types)
- **Issue:** Test hardcoded expected tool count as 7, but adding kb_list_types makes it 8
- **Fix:** Updated test description and assertion to expect 8 tools, added kb_list_types to expected tools list
- **Files modified:** tests/mcp/server.test.ts
- **Verification:** All 43 MCP tests pass
- **Committed in:** 3c3d89c (Task 2 commit)

**2. [Rule 1 - Bug] Updated insertModule test helper for composite entity_type**
- **Found during:** Task 2 (writing type filtering tests)
- **Issue:** insertModule helper stored entity_type as bare 'module' instead of composite 'module:module' format needed after Plan 01 changes
- **Fix:** Added optional subType parameter to insertModule, defaults to 'module:module' composite format
- **Files modified:** tests/mcp/tools.test.ts
- **Verification:** Type filtering tests correctly find results by sub-type
- **Committed in:** 3c3d89c (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for test correctness after new tool registration. No scope creep.

## Issues Encountered
- vitest version does not support `-x` flag (plan specified it); used `--bail 1` instead

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 10 complete: search type filtering fully surfaced through CLI and MCP
- All 388 tests passing, TypeScript compiles cleanly

## Self-Check: PASSED

All 9 files verified present. Both task commits (1281c5f, 3c3d89c) confirmed in git log.

---
*Phase: 10-search-type-filtering*
*Completed: 2026-03-07*
