---
phase: 34-search-query-layer
plan: 02
subsystem: search
tags: [mcp, nextAction, search-ux, ai-agent-hints]

requires:
  - phase: 34-search-query-layer
    provides: "OR-default search with progressive relaxation (plan 01)"
provides:
  - "nextAction field on TextSearchResult with tool name and args"
  - "getNextAction() mapping function for entity type -> MCP tool"
  - "MCP kb_search JSON responses include nextAction in every data item"
affects: [mcp-tools, search-results, ai-agent-workflows]

tech-stack:
  added: []
  patterns: ["nextAction hints on search results for AI agent follow-up"]

key-files:
  created:
    - tests/mcp/tools/search.test.ts
  modified:
    - src/search/types.ts
    - src/search/text.ts
    - tests/search/text.test.ts
    - tests/cli/snapshots.test.ts

key-decisions:
  - "nextAction is non-optional on TextSearchResult -- every result always has a follow-up hint"
  - "nextAction includes both tool name and args.name for immediately actionable hints"

patterns-established:
  - "NEXT_ACTION_MAP: static mapping from EntityType to MCP tool name, with kb_entity as default"

requirements-completed: [ENRICH-01, ENRICH-02]

duration: 3min
completed: 2026-03-11
---

# Phase 34 Plan 02: nextAction Hints Summary

**nextAction field on search results mapping entity types to follow-up MCP tools (kb_field_impact, kb_explain, kb_entity, kb_search)**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-11T13:13:05Z
- **Completed:** 2026-03-11T13:15:59Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- NextAction interface and non-optional field added to TextSearchResult
- getNextAction() maps all 7 entity types to the most useful follow-up MCP tool
- MCP kb_search JSON automatically includes nextAction via formatResponse passthrough
- 15 new tests (12 unit + 3 integration), 814 total suite green

## Task Commits

Each task was committed atomically:

1. **Task 1: Add nextAction to TextSearchResult (TDD RED)** - `848e03c` (test)
2. **Task 1: Implement getNextAction and wire into hydration (TDD GREEN)** - `83bb20b` (feat)
3. **Task 2: Wire nextAction through MCP kb_search response** - `8e4a7bf` (feat)

_Note: Task 1 used TDD with separate RED/GREEN commits._

## Files Created/Modified
- `src/search/types.ts` - Added NextAction interface and field on TextSearchResult
- `src/search/text.ts` - Added getNextAction() mapping and nextAction population in hydration loop
- `tests/search/text.test.ts` - 12 new tests for getNextAction mapping and searchText integration
- `tests/mcp/tools/search.test.ts` - 3 new integration tests for MCP response shape
- `tests/cli/snapshots.test.ts` - Updated key set snapshot to include nextAction

## Decisions Made
- nextAction is non-optional: every search result always has a follow-up hint (no undefined checks for consumers)
- args.name uses the entity name from hydration, making hints immediately actionable without extra lookups

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated snapshot test for new nextAction field**
- **Found during:** Task 2 (full regression)
- **Issue:** tests/cli/snapshots.test.ts checks exact key set of TextSearchResult, was missing nextAction
- **Fix:** Added 'nextAction' to expected key array
- **Files modified:** tests/cli/snapshots.test.ts
- **Verification:** Full suite 814/814 green
- **Committed in:** 8e4a7bf (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Snapshot test was a direct consequence of adding the new field. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 34 (Search Query Layer) is fully complete
- Both plans delivered: OR-default search with progressive relaxation (01) and nextAction hints (02)
- Ready for next phase in v4.2 Search Quality milestone

## Self-Check: PASSED

All 6 files verified present. All 3 commits verified in git log. 814/814 tests green.

---
*Phase: 34-search-query-layer*
*Completed: 2026-03-11*
