# Pitfalls Research: v1.2 Hardening & Quick Wins

**Domain:** Refactoring and optimizing an existing, working Node.js/TypeScript/SQLite codebase
**Researched:** 2026-03-07
**Confidence:** HIGH (based on direct codebase analysis + industry patterns)

This document covers pitfalls specific to *refactoring existing working code* -- a fundamentally different risk profile from building new features. The v1.1 pitfalls document covered feature-building risks. This one covers the ways you break things when trying to make them better.

---

## Critical Pitfalls

### Pitfall 1: Consolidating `indexSingleRepo` and `extractRepoData` Breaks Both Code Paths

**What goes wrong:**
The pipeline.ts file (787 lines) has two nearly-identical extraction flows: `extractRepoData` (used by `indexAllRepos` for parallel extraction) and `indexSingleRepo` (used by MCP auto-sync and direct calls). A refactorer sees ~300 lines of duplication and extracts a shared helper. But the two functions have subtly different DB interaction patterns: `extractRepoData` takes a `DbSnapshot` and does zero DB access (designed for parallel execution), while `indexSingleRepo` reads from DB inline (`db.prepare('SELECT id, last_indexed_commit FROM repos WHERE name = ?')`). Merging them either introduces DB access into the parallel path (breaking the extract-then-persist architecture) or removes inline DB reads from the sync path (changing behavior when the DB state changes between snapshot and persist).

**Why it happens:**
This is the most tempting refactoring target in the codebase. The code looks duplicated. But the duplication is *intentional* -- it exists because the v1.1 parallel pipeline specifically separated DB reads from extraction. The "duplication" is actually two implementations of the same logic with different DB isolation guarantees.

**How to avoid:**
1. If consolidating, the shared helper MUST be pure (no DB access). It should accept pre-fetched data and return extracted results, exactly like `extractRepoData` already does.
2. `indexSingleRepo` can call the shared helper but must handle its own DB reads before and writes after.
3. Write a test that runs `indexSingleRepo` and `indexAllRepos` against the same repo and asserts identical output. This catches behavioral divergence.
4. Better yet: leave the duplication alone. 300 lines of duplicated-but-clear code is safer than 200 lines of abstracted-but-fragile code. Add a code comment explaining why.

**Warning signs:**
- PR introduces a function called something like `extractCore` or `sharedExtraction` that takes both a DB and snapshot parameters
- Test count drops after the refactor (tests for one path got lost)
- The word "should" appears in the refactoring rationale ("these *should* behave the same")

**Phase to address:** Code review phase. Flag pipeline.ts duplication as intentional -- document it, don't consolidate it.

---

### Pitfall 2: Changing MCP Tool Parameter Shapes Silently Breaks All Consumers

**What goes wrong:**
During refactoring, you rename a parameter (e.g., `repo` to `repoName` for consistency), change a type (e.g., `limit: z.number()` to `limit: z.string()` then parse), or restructure the response JSON shape. The MCP tool still works in tests, but every AI agent using `kb_search`, `kb_entity`, `kb_deps`, etc. through Claude Code starts getting errors or unexpected results. There's no compilation error, no test failure -- just silent breakage at the integration boundary.

**Why it happens:**
The 8 MCP tools (`kb_search`, `kb_entity`, `kb_deps`, `kb_learn`, `kb_forget`, `kb_status`, `kb_cleanup`, `kb_list_types`) are the primary API surface. Their parameter names and response shapes are learned by AI agents from the tool descriptions registered via `server.tool()`. The Zod schemas in each tool file define the contract. But there's no consumer-side test -- the tests in `tests/mcp/tools.test.ts` call tool handlers directly, bypassing the schema validation that MCP clients rely on. A refactoring that changes the registered schema without updating all consumers (Claude Code configs, skill files, CLAUDE.md documentation) creates a silent break.

**How to avoid:**
1. Treat MCP tool schemas as a public API with semver guarantees. Parameter names (`query`, `limit`, `repo`, `type`) and response JSON structure (`{ summary, data, total, truncated }`) are frozen for v1.x.
2. Create a contract test file (`tests/mcp/contracts.test.ts`) that asserts the exact parameter names and types for each tool. This test should fail if any schema changes.
3. If a parameter must change, add the new parameter alongside the old one and deprecate, don't rename.
4. The `formatResponse` output shape (`McpResponse<T>` with `summary`, `data`, `total`, `truncated`) is consumed by AI agents that parse the JSON. Changing field names here breaks every session.

**Warning signs:**
- A refactoring PR touches files in `src/mcp/tools/` and changes Zod schema definitions
- Parameter names change in tool registration calls
- The `McpResponse` interface in `format.ts` gets renamed or restructured
- CLAUDE.md or skill files aren't updated in the same PR

**Phase to address:** First phase -- establish contract tests before any refactoring begins.

---

### Pitfall 3: Renaming Exported Symbols Breaks the Public API Without TypeScript Errors

**What goes wrong:**
`src/index.ts` exports 40+ symbols that form the library's public API. During refactoring, you rename an internal type (e.g., `TextSearchResult` to `SearchResult` for brevity, or `EdgeData` to `Edge` to match the entity type). TypeScript catches all internal usages, so the refactor appears clean. But external consumers who `import { TextSearchResult } from 'repo-knowledge-base'` get a build failure that you never see because no test covers external consumption.

**Why it happens:**
The project is both a CLI tool and a library (it has `"main": "dist/index.js"` and `"types": "dist/index.d.ts"` in package.json). The exports in `src/index.ts` are a public contract. TypeScript's type checker only validates internal consistency -- it can't know about downstream consumers. The test suite uses internal imports (`../../src/search/text.js`), not the public API path.

**How to avoid:**
1. Add a "public API snapshot" test that imports from the package root and asserts all expected exports exist. Something like: `import * as kb from '../../src/index.js'; expect(kb.searchText).toBeDefined(); expect(kb.TextSearchResult).toBeDefined();`
2. Before renaming any exported type or function, grep for its name in `~/.claude/` and any skill directories to check for external usage.
3. If renaming is necessary, re-export the old name as a deprecated alias: `export { NewName as OldName }`.

**Warning signs:**
- Refactoring touches `src/index.ts` export list
- Type names change in `src/types/entities.ts` or `src/search/types.ts`
- `npm run build` succeeds but `npm link` consumers fail

**Phase to address:** First phase -- add API snapshot test before any refactoring begins.

---

### Pitfall 4: SQLite Schema Migration v5 That Requires Table Rebuild

**What goes wrong:**
During hardening, you discover that a column should have a different type, a NOT NULL constraint is missing, or a column should be dropped. SQLite does not support `ALTER TABLE DROP COLUMN` before 3.35.0 (better-sqlite3 bundles its own SQLite, version varies), `ALTER TABLE RENAME COLUMN` has limitations, and `ALTER TABLE` cannot add constraints to existing columns. The "correct" migration is a table rebuild: create new table, copy data, drop old, rename. This is destructive, slow on large databases, and easy to get wrong (foreign key references, FTS entries pointing to old IDs, triggers, indexes all need rebuilding).

**Why it happens:**
The hardening milestone naturally surfaces schema imperfections. "This column should be NOT NULL" or "this index is missing" are exactly the kinds of things you notice during review. The current migration system (`src/db/migrations.ts`) uses sequential numbered migrations with `ALTER TABLE ADD COLUMN` -- which is safe. But a table rebuild migration is a fundamentally different operation that the current migration infrastructure doesn't handle.

**How to avoid:**
1. For v1.2, restrict schema changes to `ALTER TABLE ADD COLUMN` and `CREATE INDEX IF NOT EXISTS`. These are safe, idempotent, and non-destructive.
2. If a table rebuild is truly necessary, defer it to v2.0 where the migration can be tested against production-scale data.
3. Never add NOT NULL to an existing column via migration. Instead, add a CHECK constraint on new inserts and handle NULLs in application code.
4. Test every migration against a populated database, not just empty. The `openDatabase` function creates and migrates in one step -- test with a real `~/.kb/knowledge.db` copy.

**Warning signs:**
- Migration function contains `CREATE TABLE ... AS SELECT` or `DROP TABLE` for an existing table
- Migration adds NOT NULL without a DEFAULT
- Better-sqlite3 throws "UNIQUE constraint failed" or "NOT NULL constraint failed" during migration on existing data

**Phase to address:** Any phase that touches `db/migrations.ts`. Gate rule: no table rebuilds in v1.2.

---

### Pitfall 5: Refactoring FTS Indexing Logic Causes Silent Search Quality Regression

**What goes wrong:**
You refactor the FTS indexing in `db/fts.ts` -- maybe consolidating `indexEntity`/`removeEntity`, changing the tokenization in `tokenizer.ts`, or optimizing the `search()` function. The tests pass because they use the same tokenizer for both indexing and querying. But the production database was indexed with the OLD tokenizer. After the refactoring, new entities are indexed with the new logic, but existing entities still have old tokenization. Searches partially work (new entities match) but miss all previously-indexed content until a full re-index.

**Why it happens:**
FTS5's `knowledge_fts` table stores pre-tokenized text. The `tokenizeForFts()` function in `db/tokenizer.ts` processes both the indexed content and the query. If you change how tokenization works (e.g., handling CamelCase differently, changing stopword behavior, modifying the unicode61 tokenizer parameters), the query tokenization no longer matches the stored tokenization for old entries.

**How to avoid:**
1. If `tokenizeForFts()` changes in any way, the migration MUST include a full FTS rebuild: `DELETE FROM knowledge_fts` + `kb index --force`.
2. Better: don't change `tokenizeForFts()` during hardening. If the tokenization needs improvement, that's a feature (SEM-01/SEM-02 semantic search), not a quick win.
3. If optimizing the `search()` function in `db/fts.ts`, keep the FTS5 MATCH query syntax identical. The `ORDER BY rank` and BM25 scoring are handled by SQLite internally -- don't try to add custom relevance scoring on top.
4. Write a "golden test": index a fixed set of entities, run a fixed set of queries, assert exact result sets. This catches any tokenization drift.

**Warning signs:**
- Changes to `tokenizer.ts` without a corresponding `kb index --force` note
- Search tests pass but manual testing returns different results than before
- The FTS query in `search()` or `executeFtsQuery()` changes syntax

**Phase to address:** Any phase that touches `db/tokenizer.ts` or `db/fts.ts`. Gate rule: tokenizer changes require FTS rebuild plan.

---

## Moderate Pitfalls

### Pitfall 6: Test Refactoring That Silently Reduces Coverage

**What goes wrong:**
You see 25 test files with 388 tests and decide to "clean up" tests -- removing "redundant" assertions, consolidating similar test cases into parameterized tests, or extracting test helpers. The test count drops from 388 to 350, but you rationalize it as "removed duplication." In reality, the "redundant" tests were covering different edge cases with similar setup. The consolidated parameterized test misses the edge case that the individual test caught.

**Why it happens:**
Test files often look messy because they cover edge cases that required specific setup. A test that looks like it's testing the same thing as another test might actually be testing a different code path (e.g., one tests `searchText` with a repo filter, another without -- they look similar but exercise different SQL queries). Test cleanup feels productive but reducing assertion count is never a win.

**How to avoid:**
1. Never reduce test count during a refactoring milestone. Tests can be MOVED and REORGANIZED but the total assertion count should stay the same or increase.
2. Before touching a test file, run `vitest run --reporter=verbose` and record the test names. After refactoring, diff the test names -- any removed test needs explicit justification.
3. If consolidating into parameterized tests, the parameter list must cover at least as many cases as the original individual tests.
4. Add coverage tracking: `vitest run --coverage` before and after. Line coverage should not decrease.

**Warning signs:**
- Test file changes remove `it()` blocks without adding new ones
- Test helpers abstract away assertions (the helper calls `expect()` but the test doesn't)
- "Cleaned up redundant tests" in commit message

**Phase to address:** Every phase. Rule: test count is monotonically increasing.

---

### Pitfall 7: CLI Output Format Changes Break Downstream Piping

**What goes wrong:**
The CLI outputs JSON (`"All output is JSON"` per CLAUDE.md). During refactoring, you change the JSON structure -- maybe renaming `repoName` to `repo` in search results, restructuring nested objects, or changing array ordering. The CLI still works for interactive use, but scripts and AI agent sessions that pipe `kb search "query" | jq '.data[].repoName'` silently get null values or fail.

**Why it happens:**
The CLI and MCP tools share the same underlying functions (`searchText`, `findEntity`, `queryDependencies`) but format output differently. The CLI commands in `src/cli/commands/` format their own JSON. The MCP tools use `formatResponse` from `src/mcp/format.ts`. Changing the underlying function's return type changes both outputs. And unlike MCP tools (which have Zod schemas), CLI output has no formal schema -- just convention.

**How to avoid:**
1. Treat CLI JSON output as a public API. Document the JSON shapes somewhere (or add a snapshot test).
2. Add integration tests for CLI commands that assert specific JSON structure: `const output = JSON.parse(execSync('kb search "test"').toString()); expect(output).toHaveProperty('repoName');`
3. If restructuring return types from search/entity/deps functions, add mapping layers in the CLI and MCP commands rather than changing the output format.
4. The `kb docs` command outputs documentation -- don't change its format without updating CLAUDE.md.

**Warning signs:**
- Changes to `src/search/types.ts` interfaces (`TextSearchResult`, `EntityCard`, `DependencyResult`)
- Changes to CLI command files that alter `JSON.stringify` structure
- No CLI integration tests in the PR

**Phase to address:** Any phase that touches search return types or CLI commands.

---

### Pitfall 8: "Quick Win" Performance Optimization That Becomes a Rewrite

**What goes wrong:**
You profile and find that `persistRepoData` is slow because it does N individual `INSERT` statements in a loop. The "quick win" is batching inserts. But batching requires restructuring the transaction, changing how FTS indexing interleaves with row inserts (because `indexEntity` needs the `lastInsertRowid`), and rethinking the `clearRepoEntities` ordering. What started as "add batch inserts" becomes "rewrite the entire persistence layer."

Similarly: you notice `clearRepoEntities` in writer.ts does 4 separate queries to collect IDs before deleting. The "quick win" is a single `DELETE ... WHERE repo_id = ?` with cascading deletes. But the FTS entries need to be removed first (FTS5 virtual tables don't support cascading deletes), and the polymorphic `edges` table has no FK constraints. Now you're redesigning the cleanup flow.

**Why it happens:**
Performance optimizations in database-heavy code rarely stay localized. Each optimization touches the transaction boundary, the FTS synchronization, or the entity lifecycle -- all of which have subtle ordering requirements. The current code is slow-but-correct, and correctness is enforced by the specific ordering of operations.

**How to avoid:**
1. Time-box every optimization to 2 hours. If it's not done in 2 hours, it's not a quick win -- defer it.
2. Before optimizing, write the performance test first: `console.time('persist'); persistRepoData(db, testData); console.timeEnd('persist');` Measure the before, set a target, stop when you hit it.
3. For batch inserts: better-sqlite3 supports prepared statement reuse within transactions (it's already synchronous, so there's no async batching needed). The optimization is `.prepare()` once outside the loop, not restructuring the loop.
4. For `clearRepoEntities`: the current loop-based FTS cleanup is correct if ugly. Replace the loop with `DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id IN (SELECT id FROM modules WHERE repo_id = ?)` -- one statement instead of N, same semantics.

**Warning signs:**
- Optimization PR adds more lines than it removes
- Transaction boundaries change
- FTS operations reorder relative to entity CRUD
- The phrase "while I'm at it" appears in a commit message

**Phase to address:** Performance optimization phase. Hard time-box, explicit scope boundaries per optimization.

---

### Pitfall 9: Extracting Shared Utilities Creates Circular Dependencies

**What goes wrong:**
You notice that `indexer/pipeline.ts` and `indexer/writer.ts` both import from `db/fts.ts`. You decide to extract a shared `entityManager.ts` utility. But the utility needs types from `types/entities.ts`, functions from `db/fts.ts`, and is imported by both `indexer/` and `search/` modules. You've created a module that depends on both the DB layer and the indexer layer, while being depended on by both. Node.js ESM handles circular imports differently than CommonJS -- you may get undefined imports at runtime that TypeScript doesn't catch.

**Why it happens:**
The current module structure has clean dependency direction: `types/` <- `db/` <- `indexer/` and `types/` <- `db/` <- `search/`. CLI and MCP sit on top and import from both. Extracting cross-cutting utilities breaks this layering. TypeScript compiles fine because it resolves types statically, but runtime ESM module initialization order can cause `undefined` when a circular import is encountered.

**How to avoid:**
1. Before extracting a utility, draw the import graph. If the new module would be imported by modules in two different layers AND imports from one of those layers, you have a circular dependency.
2. The current structure is intentional: `db/fts.ts` is the shared utility for FTS operations. It's in `db/` because it only depends on `types/` and `better-sqlite3`. Don't move it.
3. If extracting shared logic, put it in the LOWER layer (closer to `types/`), not between layers.
4. Run `npx madge --circular --extensions ts src/` to detect circular dependencies before committing.

**Warning signs:**
- New file created that imports from both `db/` and `indexer/`
- Runtime error: "Cannot access 'X' before initialization"
- Import statement at the top of a file causes mysterious `undefined`

**Phase to address:** Any structural refactoring phase. Run circular dependency check as part of the build.

---

### Pitfall 10: Changing `better-sqlite3` Pragmas Corrupts WAL State

**What goes wrong:**
During optimization, you tweak SQLite pragmas in `openDatabase()`: maybe setting `PRAGMA synchronous = OFF` for speed, or changing `PRAGMA journal_mode` from WAL to something else, or adding `PRAGMA cache_size`. Some pragma changes are safe. Others corrupt the database or change durability guarantees. Changing `journal_mode` on a database that has active WAL files can cause data loss. Setting `synchronous = OFF` means a crash during write loses data.

**Why it happens:**
The current pragmas in `database.ts` are well-chosen: `journal_mode = WAL` (concurrent reads), `foreign_keys = ON` (referential integrity), `synchronous = NORMAL` (durability with WAL). These are the recommended production settings. "Optimization" of SQLite pragmas is almost always the wrong move for a local tool -- the current settings already balance speed and safety.

**How to avoid:**
1. Don't change the existing pragmas. They're correct.
2. Safe additions: `PRAGMA cache_size = -N` (negative = KB, positive = pages) is safe to tune. Default is 2000 pages (~8MB). For a ~50-repo knowledge base, the default is fine.
3. `PRAGMA mmap_size` can speed up reads on large databases but has no effect for small ones.
4. If you must change a pragma, test with a populated database AND test crash recovery (kill -9 during a write, verify DB integrity on restart).

**Warning signs:**
- Changes to `database.ts` pragma section
- `synchronous = OFF` or `journal_mode = DELETE` in any code
- SQLite ".db-wal" or ".db-shm" files growing unexpectedly

**Phase to address:** Performance optimization phase. Rule: no pragma changes without explicit justification and crash recovery test.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems during refactoring.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `as EntityType` type assertions throughout search/text.ts | Avoids type narrowing boilerplate | Runtime errors if FTS returns unexpected strings; TypeScript can't catch mismatches | Never in new code; refactoring should replace with runtime validation |
| `as { id: number } \| undefined` casts on DB query results | Avoids defining row types | Silent shape mismatches if columns change; no autocomplete | Only in test helpers, not production code |
| Separate `indexSingleRepo` and `extractRepoData` | Correct parallel/serial behavior | 300 lines of duplication; bugs fixed in one may not be fixed in the other | Acceptable -- the duplication is intentional for isolation |
| Loop-based FTS cleanup in `clearRepoEntities` | Simple, correct | O(N) individual DELETE statements per entity | Acceptable for now; optimize with batch DELETE when N > 1000 |
| Polymorphic `edges` table without FK constraints | Flexible graph model | No cascading deletes; dangling edges require manual cleanup | Acceptable for v1.x; consider typed edge tables in v2.0 |

## Integration Gotchas

Common mistakes when refactoring code that connects to external systems.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| MCP SDK (`@modelcontextprotocol/sdk`) | Upgrading SDK version during refactoring; new SDK may change `server.tool()` registration API or response format | Pin SDK version during hardening; upgrade as a separate, dedicated task |
| `better-sqlite3` | Upgrading major version; bundled SQLite version changes can affect FTS5 behavior or pragma semantics | Pin to current `^12.0.0`; if upgrading, re-run full test suite AND test with production database |
| `commander.js` | Renaming commands or options for "consistency"; breaks any scripts that call `kb` | CLI command names and option flags are frozen. Add aliases, don't rename |
| Git plumbing (`execSync`) | Refactoring git calls to use a library (simple-git, isomorphic-git); different error handling, different encoding of paths with special characters | Keep `execSync` + git plumbing commands; they're tested against 50 real repos |
| `p-limit` for concurrency | Replacing with native `Promise.allSettled` for "fewer dependencies"; loses the concurrency limit behavior | Keep p-limit; it does exactly one thing well |

## Performance Traps

Patterns that look like optimizations but degrade performance.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Replacing individual prepared statements with string concatenation for "batch" SQL | `SQLITE_ERROR: syntax error`; SQL injection if entity names contain quotes | Use prepared statements with `.run()` in a loop inside a transaction -- this is already fast in better-sqlite3 | Immediately on any entity with a quote in its name |
| Adding `EXPLAIN QUERY PLAN` logging to diagnose slow queries | Doubles query execution time (EXPLAIN runs the planner); log noise obscures real issues | Profile in a separate session using `sqlite3` CLI, not in production code | At any scale |
| Caching prepared statements in a Map to "avoid re-preparing" | Memory leak if statements are cached per unique SQL string (parameterized queries don't need this) | better-sqlite3 already caches prepared statements internally; no need for application-level caching | When statement count exceeds hundreds |
| Moving FTS `MATCH` queries to `LIKE '%query%'` for "simpler code" | Full table scan instead of index lookup; O(N) instead of O(log N) for every search | Keep FTS5 MATCH; it exists specifically for this | At >10K entities (seconds instead of milliseconds) |
| Adding `VACUUM` to the cleanup/maintenance flow | Blocks ALL reads and writes; rewrites the entire database file; doubles disk usage temporarily | VACUUM is almost never needed for a KB database; WAL + incremental writes keep things compact | At any scale -- VACUUM on a populated DB takes seconds and blocks everything |

## "Looks Done But Isn't" Checklist

Things that appear complete after refactoring but are missing critical verification.

- [ ] **Function rename:** All 40+ exports in `src/index.ts` still resolve -- run `tsc --noEmit` AND check the dist output
- [ ] **Type rename:** All `as` casts in search/text.ts and writer.ts still match actual runtime values -- these bypass type checking
- [ ] **Test refactoring:** Total assertion count is >= 388 (the pre-refactoring count) -- count `expect()` calls, not test count
- [ ] **MCP tool schemas:** All 8 tools still register with the exact same parameter names and types -- run contract test
- [ ] **CLI commands:** `kb search`, `kb deps`, `kb status` all produce parseable JSON with the same field names -- run integration test
- [ ] **FTS consistency:** After refactoring, `kb index --force && kb search "booking"` returns the same results as before -- golden test
- [ ] **Database migration:** `openDatabase` on an existing v1.1 database succeeds without errors -- test with real DB copy
- [ ] **Module boundaries:** `npx madge --circular --extensions ts src/` returns no circular dependencies
- [ ] **Build output:** `npm run build && npm link && kb status` works end-to-end -- catches import path issues in compiled JS

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Broken MCP tool contract | MEDIUM | Revert the tool schema change; update any cached tool descriptions in MCP clients by reconnecting |
| Orphaned FTS entries after refactoring | LOW | `kb index --force` rebuilds everything; 10 minutes for 50 repos |
| Circular dependency at runtime | LOW | Revert the file extraction; restore original module structure |
| Silent search regression from tokenizer change | MEDIUM | Revert tokenizer; `DELETE FROM knowledge_fts`; `kb index --force` to rebuild FTS |
| Database corruption from pragma change | HIGH | Restore from `~/.kb/knowledge.db` backup (if exists); otherwise `rm ~/.kb/knowledge.db && kb index --force` |
| Public API rename breaks consumers | LOW | Re-export old name as alias; notify consumers |
| Test coverage drop | MEDIUM | `git diff` the test files; manually re-add removed assertions; run coverage comparison |
| Quick win that became a rewrite | MEDIUM | `git stash` the work; create a proper milestone for it; return to the quick-win scope |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Pipeline duplication consolidation (#1) | Code review phase | Document intent; don't consolidate unless shared helper is pure |
| MCP tool contract breakage (#2) | Pre-refactoring setup | Contract tests exist and pass; run before and after every change |
| Public API rename (#3) | Pre-refactoring setup | API snapshot test exists; export count stable |
| Schema migration risks (#4) | Database optimization phase | Test migration on copy of production DB; no table rebuilds |
| FTS search quality regression (#5) | Search optimization phase | Golden test with fixed entities/queries; no tokenizer changes without FTS rebuild |
| Test coverage reduction (#6) | Every phase | Assertion count monotonically increasing; coverage report comparison |
| CLI output format changes (#7) | CLI refactoring phase | JSON structure snapshot tests; integration tests for piped output |
| Quick win scope creep (#8) | Performance optimization phase | 2-hour time box per optimization; explicit before/after metrics |
| Circular dependencies (#9) | Structural refactoring phase | `madge --circular` in CI; import graph stays unidirectional |
| Pragma corruption (#10) | Performance optimization phase | No pragma changes; crash recovery test if unavoidable |

## Sources

- Direct codebase analysis of `src/indexer/pipeline.ts`, `src/indexer/writer.ts`, `src/db/fts.ts`, `src/db/database.ts`, `src/db/migrations.ts`, `src/mcp/server.ts`, `src/mcp/tools/search.ts`, `src/index.ts`, `src/types/entities.ts`, `src/search/types.ts` (HIGH confidence)
- [SQLite ALTER TABLE limitations](https://sqlite.org/lang_altertable.html) - Schema migration constraints (HIGH confidence)
- [SQLite FTS5 documentation](https://sqlite.org/fts5.html) - Tokenization consistency requirements (HIGH confidence)
- [SQLite FTS5 performance regression in 3.51.0](https://sqlite.org/forum/info/226c412cdc7ce538e3bc0f6e94cffc230255aa05447d0be4f9f9429c5f7e9a62) - FTS optimization risks (HIGH confidence)
- [better-sqlite3 threading documentation](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/threads.md) - Connection and pragma safety (HIGH confidence)
- [MCP specification 2025-11-25](https://modelcontextprotocol.io/specification/2025-11-25) - Tool contract stability expectations (HIGH confidence)
- [Avoiding scope creep during refactoring](https://andreigridnev.com/blog/2019-01-20-four-tips-to-avoid-scope-creep-during-refactoring/) - Scope management patterns (MEDIUM confidence)
- [Test coverage of impacted code elements for detecting refactoring faults](https://www.sciencedirect.com/science/article/abs/pii/S0164121216000388) - Refactoring-specific test coverage research (MEDIUM confidence)
- [FTS5 performance tuning pitfalls](https://www.slingacademy.com/article/full-text-search-performance-tuning-avoiding-pitfalls-in-sqlite/) - FTS optimization anti-patterns (MEDIUM confidence)

---
*Pitfalls research for: v1.2 Hardening & Quick Wins (refactoring existing working code)*
*Researched: 2026-03-07*
*Supersedes: v1.1 pitfalls from 2026-03-06 (those covered feature-building risks; this covers refactoring risks)*
