# Phase 13: MCP Layer Dedup - Research

**Researched:** 2026-03-07
**Domain:** MCP tool implementation deduplication (TypeScript refactoring)
**Confidence:** HIGH

## Summary

Phase 13 is a pure code-dedup refactor across 8 MCP tool files in `src/mcp/tools/`. The codebase has already been read thoroughly -- all duplication patterns are identified and the extraction targets are clear. This is not a library-selection or architecture-discovery problem; it's a mechanical extraction of 5 well-defined helpers.

The most important sequencing insight: MCP-03 (response format consistency) interacts with the Phase 11 contract tests. The `kb_learn`, `kb_forget`, `kb_status`, and `kb_cleanup` tools currently return `{ summary, data }` (2 keys), while `kb_search`, `kb_entity`, and `kb_deps` return `{ summary, data, total, truncated }` (4 keys). The `kb_list_types` tool returns raw type data with **no** wrapper shape. The contract tests **pin the current shapes** -- so MCP-03 must either (a) update the contract tests to match the new unified shape, or (b) keep backward-compatible shapes. Given the success criteria says "consistent McpResponse shape", the contract tests must be updated as part of this work.

**Primary recommendation:** Extract helpers bottom-up: DB path first (isolated), then error handler HOF (widest blast radius but simplest), then response formatting consistency, then auto-sync helper, and finally EntityType unification. Run the full test suite after each extraction.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- user delegated all implementation decisions to Claude.

### Claude's Discretion
All 5 requirements (MCP-01 through MCP-05) are at Claude's discretion for implementation approach. Recommended approaches are documented in CONTEXT.md and should be followed as they are sensible.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| MCP-01 | Error handling extracted to `wrapToolHandler` HOF, eliminating 48 lines of duplication across 8 tools | All 8 tools have identical try/catch + error formatting; extract to single HOF in `src/mcp/handler.ts` |
| MCP-02 | Auto-sync pattern extracted to `withAutoSync` helper, eliminating 36 lines across 3 tools | search, entity, deps all duplicate query-sync-requery pattern; extractable to `src/mcp/sync.ts` |
| MCP-03 | Consistent McpResponse format across all MCP tools | 3 tools use `formatResponse()`, 4 build `{ summary, data }` manually, 1 uses raw JSON; unify all to McpResponse shape |
| MCP-04 | DB path resolution deduplicated (shared utility) | `src/cli/db.ts:getDbPath()` and `src/mcp/server.ts:main()` duplicate identical logic; extract to shared module |
| MCP-05 | `learned_fact` added to EntityType union, FTS indexing unified through `db/fts.ts` | `store.ts` bypasses `indexEntity()`/`removeEntity()` with raw FTS SQL; add type and route through standard path |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ES2022 target | Language | Project standard |
| @modelcontextprotocol/sdk | ^1.27.1 | MCP server framework | Already in use, tool registration API |
| better-sqlite3 | ^12.0.0 | SQLite database | Already in use |
| vitest | (dev) | Test framework | Already in use, 437 tests |
| zod | (via MCP SDK) | Schema validation | Already in use for tool param schemas |

### Supporting
No new libraries needed. This is pure refactoring.

## Architecture Patterns

### Current File Structure (relevant to phase)
```
src/
  mcp/
    format.ts          # formatResponse() + McpResponse<T> type
    sync.ts            # checkAndSyncRepos()
    hygiene.ts         # detectDeletedRepos, pruneDeletedRepos, flagStaleFacts
    server.ts          # createServer(), main() entry point
    tools/
      search.ts        # uses formatResponse + checkAndSyncRepos
      entity.ts        # uses formatResponse + checkAndSyncRepos
      deps.ts          # uses formatResponse + checkAndSyncRepos
      learn.ts         # manual { summary, data } JSON
      forget.ts        # manual { summary, data } JSON
      status.ts        # manual { summary, data } JSON
      cleanup.ts       # manual { summary, data } JSON
      list-types.ts    # raw JSON.stringify(types, null, 2)
  cli/
    db.ts              # getDbPath() -- the canonical DB path resolver
  knowledge/
    store.ts           # learnFact/forgetFact -- bypasses fts.ts
    types.ts           # LearnedFact interface
  types/
    entities.ts        # EntityType union (currently missing 'learned_fact')
  db/
    fts.ts             # indexEntity(), removeEntity(), COARSE_TYPES set
```

### Pattern 1: wrapToolHandler HOF (MCP-01)

**What:** A higher-order function that wraps any MCP tool callback with standardized try/catch error handling.

**Signature:**
```typescript
// Source: Derived from current duplication pattern in all 8 tool files
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

type ToolHandler<Args> = (args: Args) => Promise<CallToolResult>;

export function wrapToolHandler<Args>(
  toolName: string,
  handler: (args: Args) => Promise<string>,
): ToolHandler<Args> {
  return async (args: Args): Promise<CallToolResult> => {
    try {
      const text = await handler(args);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error in ${toolName}: ${message}` }],
        isError: true,
      };
    }
  };
}
```

**Key insight:** The inner handler returns a `string` (the JSON text), and the wrapper adds the MCP `content` envelope + error handling. This separates business logic from MCP transport concerns.

**Where to put it:** `src/mcp/handler.ts` (new file).

**Contract test consideration:** The error message format changes from tool-specific prefixes (e.g., "Error searching:", "Error finding entity:") to a uniform "Error in kb_search:" pattern. The existing contract tests check `r.content[0].text).toContain('Error')` which is generic enough to survive this change. However, `tools.test.ts` line 137 checks `toContain('Error')` which will still pass.

### Pattern 2: withAutoSync Helper (MCP-02)

**What:** Encapsulates the query-sync-requery pattern used by 3 read tools.

**Signature:**
```typescript
// Source: Derived from duplicated pattern in search.ts, entity.ts, deps.ts
export function withAutoSync<T extends { repoName: string }>(
  db: Database.Database,
  queryFn: () => T[],
  extractRepoNames: (results: T[]) => string[],
): T[] {
  let results = queryFn();
  const repoNames = extractRepoNames(results);
  const syncResult = checkAndSyncRepos(db, repoNames);
  if (syncResult.synced.length > 0) {
    results = queryFn();
  }
  return results;
}
```

**Where to put it:** Add to existing `src/mcp/sync.ts` -- it's the natural home since `checkAndSyncRepos` is already there.

**Deps tool complication:** The deps tool is slightly different -- it returns a single `result` object (not an array), and repo name extraction pulls from both `result.entity.repoName` and `result.dependencies.map(d => d.repoName)`. The helper either needs a more generic shape or deps gets a specialized variant. Recommendation: make `withAutoSync` accept a generic `queryFn: () => T` and `extractRepoNames: (result: T) => string[]` rather than assuming arrays.

### Pattern 3: Response Format Unification (MCP-03)

**Current state by tool:**

| Tool | Current Shape | Uses formatResponse? |
|------|--------------|---------------------|
| kb_search | `{ summary, data[], total, truncated }` | Yes |
| kb_entity | `{ summary, data[], total, truncated }` | Yes |
| kb_deps | `{ summary, data[], total, truncated }` (empty case manually built) | Partially |
| kb_learn | `{ summary, data: object }` | No |
| kb_forget | `{ summary, data: object }` | No |
| kb_status | `{ summary, data: object }` | No |
| kb_cleanup | `{ summary, data: object }` | No |
| kb_list_types | Raw `{ [type]: [{subType, count}] }` | No |

**Decision:** Unify learn/forget/status/cleanup to include `total` and `truncated` fields. For single-object responses, wrap in array format: `{ summary, data: [theObject], total: 1, truncated: false }`.

**CRITICAL: Contract test updates required.** The Phase 11 contract tests in `tests/mcp/contracts.test.ts` pin the *current* shapes:
- `kb_learn` (line 256): expects `['data', 'summary']` (2 keys)
- `kb_forget` (line 277): expects `['data', 'summary']` (2 keys)
- `kb_status` (line 297): expects `['data', 'summary']` (2 keys)
- `kb_cleanup` (line 334): expects `['data', 'summary']` (2 keys)
- `kb_list_types` (line 341): expects NO summary/total/truncated keys

These contract tests must be updated to expect the new unified 4-key shape `['data', 'summary', 'total', 'truncated']`. The `kb_list_types` tool is a special case -- it currently returns a raw type map. To unify, wrap it: `{ summary: "N entity types available", data: [...], total: N, truncated: false }`.

**Also update `tools.test.ts`:** Lines checking `{ summary, data }` structure for learn/forget tools need updating.

**The `formatResponse()` function** in `format.ts` is designed for *arrays of items*. For single-object tools (learn, forget, status, cleanup), either:
1. Wrap single results in arrays and use `formatResponse()`
2. Add a simpler `formatSingleResponse()` helper that builds the 4-key shape without the recursive halving logic (which only matters for large arrays)

Recommendation: Option 2 -- add `formatSingleResponse<T>(item: T, summary: string): string` alongside `formatResponse()`. The recursive halving is irrelevant for single objects. This keeps the API clean.

### Pattern 4: DB Path Resolution (MCP-04)

**What:** Extract `getDbPath()` from `src/cli/db.ts` to a shared location importable by both CLI and MCP server.

**Current duplication:**
- `src/cli/db.ts:14-18`: `process.env.KB_DB_PATH ?? path.join(os.homedir(), '.kb', 'knowledge.db')`
- `src/mcp/server.ts:41`: identical expression inline

**Where to put it:** `src/db/path.ts` (new file) -- keeps it in the `db/` module which is the natural home for database utilities. Both `cli/db.ts` and `mcp/server.ts` import from here.

### Pattern 5: EntityType + FTS Unification (MCP-05)

**What:** Add `'learned_fact'` to the `EntityType` union and route FTS operations through `indexEntity()`/`removeEntity()`.

**Changes required:**
1. `src/types/entities.ts` line 65: Add `'learned_fact'` to the union
2. `src/knowledge/store.ts:learnFact()`: Replace raw FTS INSERT with `indexEntity(db, { type: 'learned_fact', id, name: processedContent, description: processedContent })`
3. `src/knowledge/store.ts:forgetFact()`: Replace raw FTS DELETE with `removeEntity(db, 'learned_fact', id)`
4. `src/db/fts.ts` COARSE_TYPES already includes `'learned_fact'` (line 15) -- no change needed there

**Composite type format:** `indexEntity()` stores types in `parent:subtype` format. For learned facts, this would become `'learned_fact:learned_fact'`. Currently the raw INSERT stores bare `'learned_fact'`. This is a **behavioral change** that affects:
- `forgetFact()` DELETE query: currently `entity_type = 'learned_fact'` -- after change, `removeEntity()` uses `entity_type LIKE 'learned_fact:%'` pattern
- `text.ts:hydrateLearnedFact()` line 121: `parseCompositeType('learned_fact')` returns `{ entityType: 'learned_fact', subType: 'learned_fact' }` (the legacy no-colon path) vs `parseCompositeType('learned_fact:learned_fact')` returns the same result. So `parseCompositeType` handles both formats correctly.
- `store.test.ts` line 75: Searches FTS with `entity_type = 'learned_fact'` -- this will **break** because the stored value becomes `'learned_fact:learned_fact'`. Must update to `entity_type LIKE 'learned_fact:%'` or update the expected value.

**Migration concern:** Existing databases have FTS rows with bare `'learned_fact'` entity_type. After the change, new facts get `'learned_fact:learned_fact'`. The `removeEntity()` LIKE pattern `'learned_fact:%'` will NOT match bare `'learned_fact'` (no colon). Options:
1. Write a one-time migration to update existing FTS rows from `'learned_fact'` to `'learned_fact:learned_fact'`
2. Adjust `removeEntity()` to also handle the bare format -- but that pollutes the general function
3. Add a migration step in the schema migrations

Recommendation: Option 1 -- add logic in the learn/forget path that handles both formats during transition, OR add a lightweight migration. Since FTS tables cannot be ALTERed in place, use DELETE + INSERT approach: `DELETE FROM knowledge_fts WHERE entity_type = 'learned_fact'; INSERT INTO knowledge_fts SELECT name, description, 'learned_fact:learned_fact', entity_id FROM knowledge_fts WHERE ...` -- wait, you can't self-reference during migration like this easily.

Simpler approach: In `indexEntity()`, the delete step already uses `LIKE 'learned_fact:%'`. Just also add a cleanup of bare `'learned_fact'` entries. Actually, the simplest fix: when calling `indexEntity()` for a learned fact, the function does `DELETE ... WHERE entity_type LIKE 'learned_fact:%'` then `INSERT ... 'learned_fact:learned_fact'`. Old bare `'learned_fact'` entries would NOT be matched by the LIKE. So we need a one-time cleanup.

**Best approach:** In `learnFact()`, since `indexEntity()` does delete-then-insert (upsert), new facts are fine. The issue is only with `forgetFact()` needing to clean up old-format entries. Fix: have `forgetFact()` call `removeEntity()` AND also do a fallback `DELETE ... WHERE entity_type = 'learned_fact' AND entity_id = ?` to catch legacy rows. Or, even better, run a schema migration (V6) that normalizes all bare `learned_fact` to `learned_fact:learned_fact` in the FTS table. This is the cleanest approach.

### Anti-Patterns to Avoid

- **Don't break the `server.tool()` registration API.** Each tool file must still export `register*Tool(server, db)` and call `server.tool(name, description, schema, callback)`. The HOF wraps the callback, not the registration.
- **Don't make the HOF too generic.** The wrapper should handle exactly the try/catch + MCP envelope pattern. Don't try to also handle auto-sync or response formatting in the same HOF -- keep them composable.
- **Don't forget `db.transaction()` in `forgetFact`.** The current implementation wraps FTS delete + table delete in a transaction. When switching to `removeEntity()`, make sure the transaction boundary is preserved.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FTS tokenization | Custom tokenizer for learned facts | `tokenizeForFts()` via `indexEntity()` | Already standardized in db/tokenizer.ts |
| Error serialization | Custom error formatting per tool | `wrapToolHandler()` HOF | Exact same pattern 8 times |
| Response size enforcement | Manual JSON.stringify + length checks | `formatResponse()` / `formatSingleResponse()` | 4KB recursive halving already battle-tested |

## Common Pitfalls

### Pitfall 1: Contract Test Breakage
**What goes wrong:** Changing response shapes without updating contract tests causes red tests
**Why it happens:** Phase 11 tests deliberately pin exact key sets with `Object.keys(parsed).sort().toEqual([...])`
**How to avoid:** Update contract tests IN THE SAME COMMIT as the response shape changes. Run `npm test` after every change.
**Warning signs:** Any `toEqual` assertion on `Object.keys` in `contracts.test.ts`

### Pitfall 2: FTS Entity Type Format Mismatch
**What goes wrong:** Old `'learned_fact'` entries in FTS don't match new `'learned_fact:learned_fact'` LIKE patterns
**Why it happens:** `removeEntity()` uses `LIKE 'learned_fact:%'` which doesn't match bare `'learned_fact'`
**How to avoid:** Either (a) add a V6 migration to normalize existing FTS entries, or (b) have `forgetFact()` also clean up the legacy format
**Warning signs:** `forgetFact()` returns true (table row deleted) but FTS entry remains (orphaned)

### Pitfall 3: Transaction Boundary in forgetFact
**What goes wrong:** FTS delete and table delete not in same transaction after refactor
**Why it happens:** `removeEntity()` doesn't wrap in a transaction -- caller is responsible
**How to avoid:** Keep the `db.transaction()` wrapper in `forgetFact()` and call `removeEntity()` inside it
**Warning signs:** Partial deletes on error (FTS cleaned but row remains, or vice versa)

### Pitfall 4: Async vs Sync in Tool Handlers
**What goes wrong:** Tool callbacks are declared `async` but all DB operations are synchronous (better-sqlite3 is sync)
**Why it happens:** MCP SDK expects `Promise<CallToolResult>` return type
**How to avoid:** The HOF wrapper can use `async` for the outer function. Inner handlers can be sync -- just have the wrapper `await` the handler call (works fine with sync functions returning non-promises).
**Warning signs:** None -- this is cosmetic, but be aware.

### Pitfall 5: kb_list_types Shape Change
**What goes wrong:** Changing `kb_list_types` from raw type map to McpResponse shape breaks consumers
**Why it happens:** This tool currently returns the most different shape of all 8 tools
**How to avoid:** When wrapping in McpResponse shape, put the type entries in the `data` array. Update contract test which explicitly checks `parsed` does NOT have `summary`/`total`/`truncated`.
**Warning signs:** Contract test `kb_list_types: plain object` assertion

## Code Examples

### Example: wrapToolHandler usage in a tool file

```typescript
// src/mcp/tools/learn.ts (after refactor)
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { learnFact } from '../../knowledge/store.js';
import { wrapToolHandler } from '../handler.js';
import { formatSingleResponse } from '../format.js';

export function registerLearnTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_learn',
    'Store a new fact in the knowledge base for future reference',
    {
      content: z.string().describe('The fact to remember'),
      repo: z.string().optional().describe('Associate with a specific repo'),
    },
    wrapToolHandler('kb_learn', ({ content, repo }) => {
      const fact = learnFact(db, content, repo);
      return formatSingleResponse(
        fact,
        `Learned: "${content.length > 60 ? content.slice(0, 60) + '...' : content}" (id: ${fact.id})`,
      );
    }),
  );
}
```

### Example: withAutoSync usage

```typescript
// src/mcp/tools/search.ts (after refactor) -- relevant excerpt
const results = withAutoSync(
  db,
  () => searchText(db, query, { limit: limit ?? 10, repoFilter: repo, entityTypeFilter: type }),
  (items) => [...new Set(items.map((r) => r.repoName))],
);
```

### Example: formatSingleResponse

```typescript
// Added to src/mcp/format.ts
export function formatSingleResponse<T>(item: T, summary: string): string {
  const response: McpResponse<T> = {
    summary,
    data: [item],
    total: 1,
    truncated: false,
  };
  return JSON.stringify(response);
}
```

### Example: EntityType after MCP-05

```typescript
// src/types/entities.ts
export type EntityType = 'repo' | 'file' | 'module' | 'service' | 'event' | 'learned_fact';
```

### Example: learnFact using indexEntity

```typescript
// src/knowledge/store.ts (after refactor) -- relevant excerpt
import { indexEntity, removeEntity } from '../db/fts.js';

// In learnFact():
indexEntity(db, {
  type: 'learned_fact',
  id,
  name: content,      // indexEntity calls tokenizeForFts internally
  description: content,
});

// In forgetFact() -- inside transaction:
removeEntity(db, 'learned_fact', id);
// Also clean up legacy bare format:
db.prepare("DELETE FROM knowledge_fts WHERE entity_type = 'learned_fact' AND entity_id = ?").run(id);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline try/catch per tool | HOF wrapper | This phase | -48 lines duplication |
| Inline sync-requery per tool | `withAutoSync` helper | This phase | -36 lines duplication |
| Mixed response shapes | Uniform McpResponse | This phase | Consistent API surface |
| Duplicated DB path logic | Shared `resolveDbPath()` | This phase | Single source of truth |
| Bypass `indexEntity()` for facts | Route through standard FTS path | This phase | Unified FTS indexing |

## Open Questions

1. **kb_list_types response shape change**
   - What we know: Currently returns raw `{ [type]: [...] }` without McpResponse wrapping
   - What's unclear: Whether MCP consumers depend on the current raw shape
   - Recommendation: Wrap in McpResponse (the contract test is the authority, and we'll update it). The raw type data goes into `data` array as type-group entries.

2. **V6 migration for legacy FTS entries**
   - What we know: Existing `'learned_fact'` entries need normalization to `'learned_fact:learned_fact'`
   - What's unclear: Whether a formal migration is necessary or a cleanup in the refactored code suffices
   - Recommendation: Add a V6 migration that runs `UPDATE knowledge_fts SET entity_type = 'learned_fact:learned_fact' WHERE entity_type = 'learned_fact'`. FTS5 tables support UPDATE on UNINDEXED columns. Verify this works -- if not, use DELETE+INSERT approach.

3. **FTS5 UPDATE on UNINDEXED columns**
   - What we know: `entity_type` is UNINDEXED in the FTS5 table definition
   - What's unclear: Whether `UPDATE knowledge_fts SET entity_type = ... WHERE entity_type = ...` works on FTS5 UNINDEXED columns
   - Recommendation: Test this in the migration. If UPDATE doesn't work on FTS5, use `DELETE FROM knowledge_fts WHERE entity_type = 'learned_fact'` followed by re-insertion. Since learned facts also exist in the `learned_facts` table, we can re-derive the FTS entries.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (latest via npm) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/mcp/ tests/knowledge/store.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MCP-01 | wrapToolHandler eliminates error boilerplate | unit | `npx vitest run tests/mcp/contracts.test.ts -x` | Yes (existing) |
| MCP-02 | withAutoSync deduplicates sync pattern | unit | `npx vitest run tests/mcp/tools.test.ts -x` | Yes (existing) |
| MCP-03 | Consistent McpResponse shape | unit | `npx vitest run tests/mcp/contracts.test.ts -x` | Yes (needs update) |
| MCP-04 | DB path shared utility | unit | `npx vitest run tests/mcp/server.test.ts -x` | Yes (existing) |
| MCP-05 | learned_fact in EntityType + FTS via indexEntity | unit | `npx vitest run tests/knowledge/store.test.ts -x` | Yes (needs update) |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/mcp/ tests/knowledge/store.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/mcp/contracts.test.ts` -- update expected shapes for learn/forget/status/cleanup/list-types (MCP-03)
- [ ] `tests/knowledge/store.test.ts` -- update FTS entity_type assertions from `'learned_fact'` to `'learned_fact:learned_fact'` (MCP-05)
- [ ] No new test files needed -- existing tests cover all behaviors, just need shape updates

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis of all 8 tool files, format.ts, sync.ts, server.ts, store.ts, fts.ts, entities.ts
- Phase 11 contract tests (`tests/mcp/contracts.test.ts`) -- verified exact assertion patterns
- Phase 11 tool tests (`tests/mcp/tools.test.ts`) -- verified behavioral test patterns

### Secondary (MEDIUM confidence)
- MCP SDK types from `@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts` -- CallToolResult shape verified
- FTS5 UNINDEXED column behavior -- needs empirical verification for UPDATE operations

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, pure refactoring of existing code
- Architecture: HIGH - all duplication patterns identified from direct code reading, extraction points clear
- Pitfalls: HIGH - contract test interactions mapped precisely, FTS migration concern identified with mitigation strategies

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable -- internal refactoring, no external dependency concerns)
