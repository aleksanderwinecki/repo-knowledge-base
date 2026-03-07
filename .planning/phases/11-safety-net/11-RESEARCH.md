# Phase 11: Safety Net - Research

**Researched:** 2026-03-07
**Domain:** Regression testing -- MCP contract tests, FTS golden tests, CLI snapshot tests
**Confidence:** HIGH

## Summary

Phase 11 creates three categories of regression tests that protect subsequent refactoring phases (12-15) from silently breaking public contracts. No production code changes -- only new test files.

The codebase has mature test infrastructure (vitest 3.x, 388 passing tests, established patterns for temp DB lifecycle, MCP tool invocation, and FTS seeding). The `_registeredTools` private property on McpServer exposes full Zod schemas including parameter names, types, and optionality -- making contract verification straightforward. The `persistRepoData()` helper and `callTool()`/`parseResponse()` helpers in existing tests provide proven seeding and invocation patterns that new tests should reuse directly.

**Primary recommendation:** Three new test files, each following established patterns: `tests/mcp/contracts.test.ts` for SAFE-01, `tests/search/golden.test.ts` for SAFE-02, `tests/cli/snapshots.test.ts` for SAFE-03. Use `persistRepoData()` for seeding, direct function calls (not subprocess spawning) for CLI tests, and vitest inline snapshots for CLI output shape assertions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- user delegated all implementation decisions to Claude.

### Claude's Discretion
- **Contract test depth:** Balance between top-level key assertions and full shape checks. Verify both input schemas (zod parameter names) and output shapes. Single contract test file with describe blocks per tool. Intentional breakage model -- contract tests fail loudly, updated in the same PR that changes the contract.
- **Golden query set:** Pattern-coverage approach (~10-15 queries exercising all FTS code paths: single word, phrase, AND/OR/NOT, type-filtered, prefix, entity lookup, repo filter, no-results, special chars). Ordered top-N name assertions to catch ranking regressions without being fragile to score values. Inline persistRepoData seeding matching existing text.test.ts pattern.
- **Snapshot strategy:** Claude picks between vitest inline snapshots, file snapshots, or custom assertions. All JSON-producing CLI commands covered (search, deps, status, learn, learned, forget). Direct handler calls rather than spawning CLI processes -- matches MCP test pattern.
- **Test data approach:** Claude decides shared seed module vs independent fixtures, 2-3 repo dataset, include 1-2 knowledge facts for coverage.

### Deferred Ideas (OUT OF SCOPE)
None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| SAFE-01 | MCP tool contract tests verify all 8 tool schemas, parameter names, and response shapes | McpServer `_registeredTools` exposes `inputSchema.def.shape` with full Zod schema introspection; `callTool()`/`parseResponse()` helpers proven in tools.test.ts; all 8 tool source files analyzed for exact parameter and response shapes |
| SAFE-02 | FTS golden tests verify search quality for known queries against snapshot data | `persistRepoData()` seeding pattern from text.test.ts; `searchText()` and `findEntity()` APIs with `TextSearchResult` and `EntityCard` return types fully documented; FTS5 query syntax (AND/OR/NOT/phrase/prefix) code paths identified in text.ts |
| SAFE-03 | CLI output format snapshot tests prevent silent JSON shape changes | CLI commands call `searchText()`, `findEntity()`, `queryDependencies()`, `learnFact()`, `listFacts()`, `forgetFact()` directly; `output()` writes JSON to stdout; vitest inline snapshots or `toMatchObject()` for shape assertions on direct function calls |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| vitest | ^3.0.0 | Test runner | Already used project-wide, 388 tests passing |
| better-sqlite3 | ^12.0.0 | In-memory/temp DB for test isolation | Already used in all DB-touching tests |
| zod | ^4.3.6 | Schema definitions on MCP tools | Already used for parameter validation |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @modelcontextprotocol/sdk | ^1.27.1 | McpServer type + `_registeredTools` introspection | Contract tests |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline snapshots | File snapshots (.snap) | Inline is easier to review in PRs and keep colocated with assertions; file snapshots good for very large outputs -- our outputs are small JSON |
| Direct function calls for CLI | Subprocess spawning (execSync) | Direct calls are faster, deterministic, and match existing test patterns; subprocess tests are flakier and slower |

**Installation:**
No new dependencies needed. Everything is already in devDependencies.

## Architecture Patterns

### Recommended Test File Structure
```
tests/
  mcp/
    contracts.test.ts    # SAFE-01: MCP tool contract tests
  search/
    golden.test.ts       # SAFE-02: FTS golden query tests
  cli/
    snapshots.test.ts    # SAFE-03: CLI output snapshot tests
```

### Pattern 1: MCP Contract Tests (SAFE-01)
**What:** Verify all 8 MCP tools have correct parameter schemas AND response shapes.
**When to use:** Any PR that touches `src/mcp/tools/*.ts`.

Two dimensions to test per tool:
1. **Input schema contract** -- parameter names, types, optionality from `_registeredTools[name].inputSchema.def.shape`
2. **Output shape contract** -- response structure from `callTool()` + `parseResponse()`

**Schema introspection approach:**
```typescript
// The _registeredTools property exposes Zod schema details:
const tools = (server as unknown as {
  _registeredTools: Record<string, {
    description: string;
    inputSchema: {
      def: {
        shape: Record<string, {
          def: { type: string };
          type: string;
        }>;
      };
    };
    handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
  }>;
})._registeredTools;

// Extract parameter names from shape
const paramNames = Object.keys(tools['kb_search'].inputSchema.def.shape);
// => ['query', 'limit', 'repo', 'type']
```

**All 8 tool contracts (verified from source):**

| Tool | Parameters | Required | Response Shape |
|------|------------|----------|----------------|
| `kb_search` | `query`, `limit`, `repo`, `type` | `query` | `{ summary, data: [...], total, truncated }` via formatResponse |
| `kb_entity` | `name`, `type`, `repo` | `name` | `{ summary, data: [...], total, truncated }` via formatResponse |
| `kb_deps` | `name`, `direction`, `depth`, `repo` | `name` | `{ summary, data: [...], total, truncated }` via formatResponse OR `{ summary, data: null, total: 0, truncated: false }` for no-deps |
| `kb_learn` | `content`, `repo` | `content` | `{ summary, data: { id, content, repo, createdAt } }` |
| `kb_forget` | `id` | `id` | `{ summary, data: { deleted } }` |
| `kb_status` | (none) | (none) | `{ summary, data: { counts: { repos, modules, events, services, edges, files, learned_facts }, staleness: { checked, total, stale, missing, staleRepos } } }` |
| `kb_cleanup` | `prune`, `max_fact_age_days` | (none) | `{ summary, data: { deletedRepos, pruned, staleFacts } }` |
| `kb_list_types` | (none) | (none) | Grouped type object: `{ [entityType]: [{ subType, count }] }` |

**Note:** `kb_list_types` does NOT use formatResponse -- it returns `JSON.stringify(types, null, 2)` directly. Contract test must account for this different shape.

### Pattern 2: FTS Golden Tests (SAFE-02)
**What:** A fixed dataset with ~10-15 queries that exercise all FTS code paths, asserting ordered result names.
**When to use:** Any PR that touches `src/search/text.ts`, `src/search/entity.ts`, `src/db/fts.ts`, or `src/db/tokenizer.ts`.

**Seeding pattern (from text.test.ts):**
```typescript
// Use persistRepoData() for realistic multi-table data (repos + modules + events + services + FTS)
persistRepoData(db, {
  metadata: { name: 'booking-service', path: '/repos/booking-service', ... },
  modules: [...],
  events: [...],
  services: [...],
});
```

**Query coverage matrix (all FTS code paths in text.ts):**

| # | Query | Code Path | What to Assert |
|---|-------|-----------|----------------|
| 1 | Single word: `"booking"` | Basic FTS MATCH | Returns results, top result name contains "booking" |
| 2 | Phrase: `"booking creation"` | Quoted phrase match | Matches "BookingContext.Commands.CreateBooking" |
| 3 | AND: `"booking AND cancellation"` | FTS5 AND operator | Matches module with both terms |
| 4 | OR: `"booking OR payment"` | FTS5 OR operator | Returns results from both repos |
| 5 | NOT: `"booking NOT cancellation"` | FTS5 NOT operator | Excludes cancellation module |
| 6 | Type-filtered: `"payment"` + `entityTypeFilter: 'schema'` | resolveTypeFilter() granular | Only schema results |
| 7 | Type-filtered: `"booking"` + `entityTypeFilter: 'module'` | resolveTypeFilter() coarse | All module subtypes |
| 8 | Prefix: `"book*"` | FTS5 prefix | Matches booking-related entities |
| 9 | Entity lookup: `findEntity(db, "BookingContext.Commands.CreateBooking")` | Exact match path in entity.ts | Returns entity card with correct type |
| 10 | Entity FTS fallback: `findEntity(db, "payment processor")` | FTS fallback path in entity.ts | Returns PaymentProcessor card |
| 11 | Repo filter: `"booking"` + `repoFilter: 'payments-service'` | Post-hydration repo filter | Only payments-service results |
| 12 | No results: `"zznonexistent"` | Empty return path | Returns [] |
| 13 | Special chars: `"***"` | FTS5 syntax error fallback | Does not throw, returns [] |
| 14 | Learned fact search | learned_fact hydration path | Fact appears in results |
| 15 | Service search: `"gateway"` | Service hydration path | Returns PaymentGateway service |

**Assertion style:** Assert ordered top-N result names, NOT relevance scores. Scores are an implementation detail that changes with BM25 tuning; result ordering is the user-visible contract.

```typescript
// Good: assert names in order
const names = results.map(r => r.name);
expect(names[0]).toBe('BookingContext.Commands.CreateBooking');

// Bad: assert exact scores (fragile)
expect(results[0].relevance).toBe(-4.123);
```

### Pattern 3: CLI Output Snapshot Tests (SAFE-03)
**What:** Assert JSON shapes produced by CLI command handlers using direct function calls.
**When to use:** Any PR that touches `src/cli/commands/*.ts` or `src/cli/output.ts`.

**CLI commands producing JSON output:**

| Command | Underlying Function | Output Shape |
|---------|---------------------|--------------|
| `kb search "q"` | `searchText()` | `TextSearchResult[]` |
| `kb search "n" --entity` | `findEntity()` | `EntityCard[]` |
| `kb search --list-types` | `listAvailableTypes()` | `Record<string, {subType, count}[]>` |
| `kb deps <name>` | `queryDependencies()` | `DependencyResult \| null` |
| `kb status` | Direct SQL counts | `{ database, repos, files, modules, services, events, edges, learnedFacts }` |
| `kb learn <text>` | `learnFact()` | `LearnedFact` (`{ id, content, repo, createdAt }`) |
| `kb learned` | `listFacts()` | `LearnedFact[]` |
| `kb forget <id>` | `forgetFact()` | `{ deleted: true, id }` |

**Testing approach:** Call the underlying functions directly with a temp DB, then verify output shape using `toMatchObject()` or vitest inline snapshots. This matches the MCP test pattern (direct handler calls, no subprocess) and gives deterministic results.

**Why `toMatchObject()` over exact inline snapshots for some fields:**
- `id` values are auto-increment and vary between runs
- `createdAt` timestamps vary
- `relevance` scores are FTS implementation detail
- Use `expect.any(Number)` for these

```typescript
// Shape assertion pattern for CLI search output
const results = searchText(db, 'booking');
expect(results[0]).toMatchObject({
  entityType: expect.any(String),
  subType: expect.any(String),
  entityId: expect.any(Number),
  name: expect.any(String),
  snippet: expect.any(String),
  repoName: expect.any(String),
  repoPath: expect.any(String),
  filePath: expect.toBeOneOf([expect.any(String), null]),
  relevance: expect.any(Number),
});
```

### Anti-Patterns to Avoid
- **Asserting exact relevance scores:** FTS5 BM25 scores are internal -- assert ordering instead
- **Subprocess spawning for CLI tests:** Slow, flaky, requires build step -- use direct function calls
- **Snapshot everything including timestamps:** Use `toMatchObject` with `expect.any()` for volatile fields
- **Coupling contract tests to implementation details:** Test the public contract (param names, response shapes), not internal wiring

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema introspection | Custom Zod schema parser | McpServer `_registeredTools[name].inputSchema.def.shape` | Already exposed, reliable, updated automatically |
| Test data seeding | Raw SQL inserts | `persistRepoData()` from `src/indexer/writer.ts` | Handles FTS indexing, file records, edges -- 50+ lines of setup you'd have to duplicate |
| MCP tool invocation in tests | Custom HTTP/stdio client | `callTool()` pattern from tools.test.ts | Proven, direct, no transport overhead |
| Snapshot comparison | Custom JSON diff | vitest `toMatchObject()` / `toMatchInlineSnapshot()` | Built-in, good error messages, well-understood |

**Key insight:** The existing test infrastructure is excellent. The risk isn't building the wrong abstraction -- it's re-inventing helpers that already exist in `tests/mcp/tools.test.ts` and `tests/search/text.test.ts`.

## Common Pitfalls

### Pitfall 1: FTS Score Fragility
**What goes wrong:** Golden tests assert exact BM25 relevance scores, then break when FTS5 config changes (prefix index, tokenizer).
**Why it happens:** Scores are implementation detail, not user-visible contract.
**How to avoid:** Assert result ordering (names in expected order) and presence/absence, never exact scores.
**Warning signs:** Tests with `expect(result.relevance).toBe(-4.123)`.

### Pitfall 2: Contract Tests That Don't Catch Renames
**What goes wrong:** Contract test checks `toHaveProperty('summary')` but doesn't verify ALL expected keys, so adding/removing a key goes undetected.
**Why it happens:** Using loose assertions instead of exact key enumeration.
**How to avoid:** For contract tests, explicitly enumerate ALL expected keys and assert no extras. Use `Object.keys()` length checks.
**Warning signs:** Tests that only check a subset of response keys.

### Pitfall 3: Shared Mutable State Between Test Suites
**What goes wrong:** Golden tests and contract tests share a seed database, one test modifies it (learn/forget), others see unexpected state.
**Why it happens:** beforeEach/afterEach scope confusion when tests share setup.
**How to avoid:** Each test file gets its own temp DB via `beforeEach`. Contract tests that write (learn/forget) should verify and clean up in the same test.
**Warning signs:** Tests that pass individually but fail when run together.

### Pitfall 4: Overly Strict Snapshots
**What goes wrong:** Inline snapshots break on every run due to volatile fields (timestamps, auto-increment IDs).
**Why it happens:** Snapshotting full objects without masking volatile fields.
**How to avoid:** Use `toMatchObject()` with `expect.any()` for volatile fields; only snapshot stable fields.
**Warning signs:** Needing to `--update` snapshots on every run.

### Pitfall 5: Missing `vi.mock` for git/pipeline
**What goes wrong:** Tests that create McpServer without mocking `src/indexer/git.js` and `src/indexer/pipeline.js` try to access real git repos.
**Why it happens:** The auto-sync feature in search/entity/deps tools calls `getCurrentCommit()` on repos in results.
**How to avoid:** Always mock these modules at the top of any test file that instantiates McpServer with tools. Copy the mock pattern from tools.test.ts.
**Warning signs:** Tests that fail with ENOENT or subprocess errors.

## Code Examples

### Shared Seed Data Module
The golden tests and CLI snapshot tests need the same realistic dataset. A shared seed function avoids duplication.

```typescript
// tests/fixtures/seed.ts
import type Database from 'better-sqlite3';
import { persistRepoData } from '../../src/indexer/writer.js';
import { learnFact } from '../../src/knowledge/store.js';

export function seedTestData(db: Database.Database): void {
  persistRepoData(db, {
    metadata: {
      name: 'booking-service',
      path: '/repos/booking-service',
      description: 'Handles hotel booking and cancellation',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'abc123',
    },
    modules: [
      {
        name: 'BookingContext.Commands.CreateBooking',
        type: 'context',
        filePath: 'lib/booking_context/commands/create_booking.ex',
        summary: 'Handles booking creation and validation logic',
      },
      {
        name: 'BookingContext.Cancellation',
        type: 'module',
        filePath: 'lib/booking_context/cancellation.ex',
        summary: 'Manages booking cancellation workflows and refund calculation',
      },
    ],
    events: [
      {
        name: 'BookingCreated',
        schemaDefinition: 'message BookingCreated { string booking_id = 1; string guest_name = 2; }',
        sourceFile: 'proto/booking.proto',
      },
    ],
  });

  persistRepoData(db, {
    metadata: {
      name: 'payments-service',
      path: '/repos/payments-service',
      description: 'Payment processing and billing',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'def456',
    },
    modules: [
      {
        name: 'PaymentProcessor',
        type: 'module',
        filePath: 'lib/payment_processor.ex',
        summary: 'Processes payments after booking confirmation',
      },
      {
        name: 'Payments.Schema.Transaction',
        type: 'schema',
        filePath: 'lib/payments/schema/transaction.ex',
        summary: 'Ecto schema for payment transactions',
        tableName: 'transactions',
      },
      {
        name: 'Payments.Queries.GetTransaction',
        type: 'graphql_query',
        filePath: 'lib/payments/queries/get_transaction.ex',
        summary: 'GraphQL query resolver for transactions',
      },
    ],
    services: [
      {
        name: 'PaymentGateway',
        description: 'gRPC payment gateway service for processing charges',
        serviceType: 'grpc',
      },
    ],
  });

  // Add learned facts for coverage
  learnFact(db, 'payments-service uses Stripe API for charge processing', 'payments-service');
  learnFact(db, 'booking-service sends BookingCreated events via Kafka');
}
```

### Contract Test: Input Schema Verification
```typescript
// Verify parameter names and types for a tool
it('kb_search has correct input schema', () => {
  const tool = tools['kb_search'];
  const shape = tool.inputSchema.def.shape;
  const paramNames = Object.keys(shape);

  expect(paramNames).toEqual(['query', 'limit', 'repo', 'type']);
  expect(shape.query.type).toBe('string');
  expect(shape.limit.type).toBe('optional');
  expect(shape.repo.type).toBe('optional');
  expect(shape.type.type).toBe('optional');
});
```

### Contract Test: Output Shape Verification
```typescript
// Verify response shape for kb_status (no params needed)
it('kb_status returns correct response shape', async () => {
  const result = await callTool('kb_status');
  const parsed = parseResponse(result);

  // Verify exact key set
  expect(Object.keys(parsed).sort()).toEqual(['data', 'summary']);
  expect(typeof parsed.summary).toBe('string');

  const data = parsed.data as Record<string, unknown>;
  expect(Object.keys(data).sort()).toEqual(['counts', 'staleness']);

  const counts = data.counts as Record<string, unknown>;
  expect(Object.keys(counts).sort()).toEqual([
    'edges', 'events', 'files', 'learned_facts', 'modules', 'repos', 'services',
  ]);
});
```

### Golden Test: Ordered Name Assertion
```typescript
it('single word "booking" returns booking-service entities first', () => {
  const results = searchText(db, 'booking');
  expect(results.length).toBeGreaterThan(0);

  // Top results should be booking-related
  const topNames = results.slice(0, 3).map(r => r.name);
  expect(topNames).toContain('BookingContext.Commands.CreateBooking');
  expect(topNames).toContain('BookingContext.Cancellation');
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod v3 with `.shape` | Zod v4 with `.def.shape` | 2025 | Schema introspection path changed; project uses zod ^4.3.6 |
| `expect.toMatchSnapshot()` | `toMatchObject()` + `expect.any()` | Vitest 1.x+ | More maintainable for JSON with volatile fields |
| McpServer schema export | `_registeredTools` private API | MCP SDK 1.x | No public API for schema introspection; `_registeredTools` is the established pattern in this codebase |

**Deprecated/outdated:**
- Zod v3 `.shape` property: This project uses Zod v4 where schemas expose `.def.shape` instead. The `_registeredTools.inputSchema.def.shape` path is verified working with the project's installed version.

## Open Questions

1. **`_registeredTools` stability across MCP SDK updates**
   - What we know: `_registeredTools` is a private API (underscore-prefixed), used in 2 existing test files
   - What's unclear: Whether MCP SDK upgrades might rename/restructure it
   - Recommendation: Document the dependency in contract test comments; if SDK changes, the contract tests will fail loudly (which is actually the desired behavior -- they're safety nets)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/mcp/contracts.test.ts tests/search/golden.test.ts tests/cli/snapshots.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SAFE-01 | MCP tool schemas + response shapes | unit | `npx vitest run tests/mcp/contracts.test.ts -x` | -- Wave 0 |
| SAFE-02 | FTS golden queries | unit | `npx vitest run tests/search/golden.test.ts -x` | -- Wave 0 |
| SAFE-03 | CLI output snapshots | unit | `npx vitest run tests/cli/snapshots.test.ts -x` | -- Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/mcp/contracts.test.ts tests/search/golden.test.ts tests/cli/snapshots.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/mcp/contracts.test.ts` -- covers SAFE-01
- [ ] `tests/search/golden.test.ts` -- covers SAFE-02
- [ ] `tests/cli/snapshots.test.ts` -- covers SAFE-03
- [ ] `tests/fixtures/seed.ts` -- shared seed data module (optional, could inline)

*(These ARE the deliverables -- this phase is entirely test creation)*

## Sources

### Primary (HIGH confidence)
- **Source code direct inspection** -- all 8 MCP tool files (`src/mcp/tools/*.ts`), search modules (`src/search/*.ts`), CLI commands (`src/cli/commands/*.ts`), types (`src/search/types.ts`, `src/types/entities.ts`)
- **Existing test files** -- `tests/mcp/tools.test.ts` (callTool/parseResponse pattern), `tests/search/text.test.ts` (persistRepoData seeding), `tests/mcp/server.test.ts` (_registeredTools introspection), `tests/cli/knowledge-commands.test.ts` (CLI test pattern)
- **Runtime verification** -- `_registeredTools` structure inspected via Node.js REPL with project's installed MCP SDK v1.27.1 and Zod v4.3.6
- **Test suite execution** -- 388/388 tests passing, 13s duration

### Secondary (MEDIUM confidence)
- **Zod v4 schema introspection** -- `.def.shape` path verified at runtime; documented behavior may differ from Zod's official API surface

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- already in use, verified via test run
- Architecture: HIGH -- patterns lifted directly from existing test files
- Pitfalls: HIGH -- derived from actual codebase analysis (auto-sync mocking, FTS score volatility)
- MCP schema introspection: MEDIUM -- relies on private `_registeredTools` API, but it's already used in 2 test files

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable -- no external dependencies changing)
