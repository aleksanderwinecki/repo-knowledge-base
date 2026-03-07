# Phase 11: Safety Net - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Three categories of regression tests that protect subsequent refactoring phases (12-15): MCP tool contract tests, FTS golden tests, and CLI output snapshot tests. No functional changes to production code — only new test files.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

User delegated all implementation decisions to Claude. The following are the areas discussed with recommended approaches:

**Contract test depth:** Balance between top-level key assertions and full shape checks. Verify both input schemas (zod parameter names) and output shapes. Single contract test file with describe blocks per tool. Intentional breakage model — contract tests fail loudly, updated in the same PR that changes the contract.

**Golden query set:** Pattern-coverage approach (~10-15 queries exercising all FTS code paths: single word, phrase, AND/OR/NOT, type-filtered, prefix, entity lookup, repo filter, no-results, special chars). Ordered top-N name assertions to catch ranking regressions without being fragile to score values. Inline persistRepoData seeding matching existing text.test.ts pattern.

**Snapshot strategy:** Claude picks between vitest inline snapshots, file snapshots, or custom assertions. All JSON-producing CLI commands covered (search, deps, status, learn, learned, forget). Direct handler calls rather than spawning CLI processes — matches MCP test pattern.

**Test data approach:** Claude decides shared seed module vs independent fixtures, 2-3 repo dataset, include 1-2 knowledge facts for coverage.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tests/mcp/tools.test.ts`: `callTool()` helper accesses `_registeredTools` on McpServer, `parseResponse()` extracts JSON — directly reusable for contract tests
- `tests/search/text.test.ts`: `persistRepoData()` seeding pattern with booking-service + payments-service — proven pattern for golden tests
- `createServer()` factory in `src/mcp/server.ts`: wires all 8 tools, already used by tests
- `tokenizeForFts()` in `src/db/tokenizer.ts`: used by tools.test.ts for FTS-compatible seeding
- `output()` and `outputError()` in `src/cli/output.ts`: JSON output helpers that CLI tests can spy on

### Established Patterns
- vitest with `beforeEach`/`afterEach` for temp DB lifecycle (tmpDir + openDatabase/closeDatabase)
- vi.mock for git/pipeline modules to isolate from real repos
- McpServer instantiation in tests without stdio transport
- `persistRepoData()` for realistic multi-repo test data

### Integration Points
- 8 MCP tools registered via `register*Tool(server, db)` in `src/mcp/tools/`
- CLI commands in `src/cli/commands/` — search, deps, status, learn, learned, forget, docs, index-cmd
- Search functions: `searchText()` in `src/search/text.ts`, entity search in `src/search/entity.ts`
- Knowledge store: `src/knowledge/store.ts` for learn/forget operations

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User wants these tests to be safety nets for phases 12-15, not comprehensive feature tests.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 11-safety-net*
*Context gathered: 2026-03-07*
