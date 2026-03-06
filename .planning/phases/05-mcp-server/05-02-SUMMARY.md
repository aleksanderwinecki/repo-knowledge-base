---
phase: 05-mcp-server
plan: 02
subsystem: mcp
tags: [mcp, mcp-sdk, zod, stdio, vitest, json-rpc]

requires:
  - phase: 05-mcp-server/01
    provides: "formatResponse, checkAndSyncRepos, detectDeletedRepos, pruneDeletedRepos, flagStaleFacts"
  - phase: 04-cli-knowledge
    provides: "searchText, findEntity, queryDependencies, learnFact, forgetFact, openDatabase"
provides:
  - "kb-mcp: fully functional MCP server binary with 7 tools via stdio transport"
  - "createServer factory for test-friendly server instantiation"
  - "kb_search, kb_entity, kb_deps with auto-sync on stale repos"
  - "kb_learn, kb_forget for fact management"
  - "kb_status for DB statistics and staleness overview"
  - "kb_cleanup for deleted repo detection/pruning and stale fact flagging"
affects: []

tech-stack:
  added: ["@modelcontextprotocol/sdk", "zod"]
  patterns: [mcp-tool-registration, stdio-transport, zod-input-validation, tool-handler-testing-via-internals]

key-files:
  created:
    - src/mcp/server.ts
    - src/mcp/tools/search.ts
    - src/mcp/tools/entity.ts
    - src/mcp/tools/deps.ts
    - src/mcp/tools/learn.ts
    - src/mcp/tools/forget.ts
    - src/mcp/tools/status.ts
    - src/mcp/tools/cleanup.ts
    - tests/mcp/tools.test.ts
    - tests/mcp/server.test.ts
  modified:
    - package.json

key-decisions:
  - "createServer factory exported from server.ts for testability -- avoids importing side-effecting main()"
  - "Tool handlers tested via _registeredTools[name].handler() -- avoids needing stdio transport in tests"
  - "Read tools auto-sync then re-query if stale repos found -- ensures fresh data at cost of one extra query"
  - "kb_status limits staleness check to first 20 repos -- avoids timeouts on large knowledge bases"

patterns-established:
  - "MCP tool pattern: thin wrapper calling existing API, try/catch, formatResponse, isError on failure"
  - "Tool handler testing via McpServer._registeredTools internal map"
  - "Tokenized FTS insertion in tests to match searchText query processing"

requirements-completed: [MCP-01, MCP-02, MCP-05]

duration: 6min
completed: 2026-03-06
---

# Phase 5 Plan 2: MCP Server Wiring Summary

**Working kb-mcp binary with 7 MCP tools (search, entity, deps, learn, forget, status, cleanup) over stdio, installable via npm link**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-06T09:14:25Z
- **Completed:** 2026-03-06T09:20:46Z
- **Tasks:** 3
- **Files created:** 10
- **Files modified:** 1

## Accomplishments
- 7 MCP tools registered and callable: kb_search, kb_entity, kb_deps, kb_learn, kb_forget, kb_status, kb_cleanup
- Read tools (search, entity, deps) auto-sync stale repos before returning results
- kb_cleanup integrates full hygiene pipeline: detect deleted repos, optional pruning, stale fact flagging
- All responses are JSON under 4KB via formatResponse, errors use isError: true
- kb-mcp binary available globally after npm link, with proper shebang for direct execution
- 236 total tests passing (18 new MCP tests, 0 regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install MCP SDK + create server entry point + 7 tool files** - `606e9b5` (feat)
2. **Task 2: Tests for MCP tool handlers** - `c364497` (test)
3. **Task 3: Build verification and installation wiring** - verification only, no code changes

## Files Created/Modified
- `src/mcp/server.ts` - MCP server entry point with shebang, DB lifecycle, createServer factory
- `src/mcp/tools/search.ts` - kb_search: full-text search with auto-sync
- `src/mcp/tools/entity.ts` - kb_entity: entity card lookup with auto-sync
- `src/mcp/tools/deps.ts` - kb_deps: dependency graph queries with auto-sync
- `src/mcp/tools/learn.ts` - kb_learn: store new facts
- `src/mcp/tools/forget.ts` - kb_forget: delete facts by ID
- `src/mcp/tools/status.ts` - kb_status: DB statistics and staleness overview
- `src/mcp/tools/cleanup.ts` - kb_cleanup: detect/prune deleted repos, flag stale facts
- `tests/mcp/tools.test.ts` - 15 tests for all 7 tool handlers
- `tests/mcp/server.test.ts` - 3 tests for server factory and tool registration
- `package.json` - Added kb-mcp bin entry, @modelcontextprotocol/sdk and zod dependencies

## Decisions Made
- Exported createServer factory from server.ts for testability instead of importing side-effecting main()
- Tool handlers tested via _registeredTools[name].handler() internal map -- no stdio transport needed
- Read tools auto-sync then re-query when stale repos detected -- one extra query for data freshness
- kb_status caps staleness check at 20 repos to avoid timeouts on large DBs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript TS4023 export error in server.ts**
- **Found during:** Task 1 (server entry point creation)
- **Issue:** Top-level `const db` with `typeof db` in createServer parameter caused TS4023 because the exported function couldn't name the external Database type
- **Fix:** Restructured server.ts to move DB initialization into main() and use explicit `Database.Database` type import for createServer parameter
- **Files modified:** src/mcp/server.ts
- **Verification:** npm run build succeeds cleanly
- **Committed in:** 606e9b5 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed FTS tokenization mismatch in tool tests**
- **Found during:** Task 2 (test writing)
- **Issue:** Test insertModule helper inserted raw names into FTS, but searchText tokenizes queries via tokenizeForFts -- CamelCase names like "SyncTarget" wouldn't match query "sync target"
- **Fix:** Applied tokenizeForFts to names and summaries before FTS insertion in test helper
- **Files modified:** tests/mcp/tools.test.ts
- **Verification:** All 18 MCP tests pass including sync verification
- **Committed in:** c364497 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes were necessary for correctness. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required. Run `npm link` to make `kb-mcp` available globally.

## Next Phase Readiness
- This is the final plan in the project. The MCP server is fully functional.
- Users can add to Claude Code config: `{"mcpServers": {"kb": {"command": "kb-mcp"}}}`
- All 5 phases complete: schema, indexer, search, CLI+knowledge, MCP server

## Self-Check: PASSED

- All 10 created files exist on disk
- Commits 606e9b5 and c364497 verified in git log
- 236 tests passing (18 new, 0 regressions)
- dist/mcp/server.js has shebang and is executable
- kb-mcp binary available at /Users/aleksander.winecki/.nvm/versions/node/v22.20.0/bin/kb-mcp

---
*Phase: 05-mcp-server*
*Completed: 2026-03-06*
