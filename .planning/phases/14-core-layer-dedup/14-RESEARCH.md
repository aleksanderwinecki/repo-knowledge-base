# Phase 14: Core Layer Dedup - Research

**Researched:** 2026-03-07
**Domain:** TypeScript refactoring -- deduplicate indexing pipeline, search hydration, FTS fallback, and writer persistence code
**Confidence:** HIGH

## Summary

This phase is pure internal refactoring of 4 source files (`pipeline.ts`, `writer.ts`, `text.ts`, `entity.ts`) plus `db/fts.ts` as the shared utility target. The duplication is extensive and concrete: `indexSingleRepo()` is a 190-line copy of `extractRepoData()` + `persistExtractedData()` combined; both search modules independently implement FTS query-with-phrase-fallback; `text.ts` hydration functions and `entity.ts` lookup functions query the same tables with the same JOINs producing different output shapes; and `writer.ts` duplicates module/event/service insertion+FTS between `persistRepoData()` and `persistSurgicalData()`.

The safety net from Phase 11 (contract tests, golden FTS tests, CLI snapshot tests) plus the 437-test suite provide strong regression coverage. The refactoring is mechanical -- extract shared functions, have both callers invoke them -- with no behavioral changes expected.

**Primary recommendation:** Work in dependency order: (1) FTS fallback helper into `db/fts.ts`, (2) writer insert helpers, (3) entity hydration/dispatch consolidation, (4) pipeline unification. Each step is independently testable and the existing test suite catches regressions.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- user delegated all implementation decisions to Claude's discretion.

### Claude's Discretion
All implementation approaches are delegated, including:
- Pipeline extraction unification strategy (CORE-01)
- FTS indexing paths (CORE-02 -- already done)
- Entity hydration consolidation approach (CORE-03)
- Entity query dispatch dedup approach (CORE-04)
- FTS query fallback sharing strategy (CORE-05)
- clearRepoEntities optimization (CORE-06)
- Writer insert helper extraction (CORE-07)
- Edge operations consolidation (CORE-08)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CORE-01 | Pipeline extraction logic deduplicated between indexSingleRepo and extractRepoData (~130 lines) | Pipeline unification analysis below; indexSingleRepo calls extractRepoData + persistExtractedData |
| CORE-02 | FTS indexing paths unified -- knowledge/store.ts uses db/fts.ts indexEntity() | **PRE-SATISFIED** by Phase 13 MCP-05. Verified: store.ts imports and uses indexEntity()/removeEntity() |
| CORE-03 | Entity hydration pattern consolidated across search modules | Hydration consolidation analysis below; shared EntityInfo shape + per-module mappers |
| CORE-04 | Entity query switch statement deduplicated | Query dispatch analysis below; shared query map used by both getEntitiesByExactName and createEntityByIdLookup |
| CORE-05 | FTS query fallback logic shared between text.ts and entity.ts | FTS fallback analysis below; extract executeFtsWithFallback to db/fts.ts |
| CORE-06 | clearRepoEntities batch cleanup optimized | Cleanup consolidation analysis below; shared select-then-delete-fts helper |
| CORE-07 | Writer insert helpers extracted for shared persistence patterns | Writer helper analysis below; insertModuleWithFts/insertEventWithFts/insertServiceWithFts |
| CORE-08 | Edge operations consolidated | Naturally follows from CORE-01; single call path once pipeline is unified |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 5.x | Language | Project standard |
| better-sqlite3 | ^12.0.0 | SQLite driver | Synchronous, already in use |
| vitest | (devDep) | Test runner | 437 tests, established patterns |

### Supporting
No new dependencies needed. This is pure refactoring of existing code.

## Architecture Patterns

### Current File Structure (unchanged by this phase)
```
src/
  indexer/
    pipeline.ts      # extractRepoData, persistExtractedData, indexSingleRepo, indexAllRepos, edge functions
    writer.ts         # persistRepoData, persistSurgicalData, clearRepoEntities, clearRepoFiles, clearRepoEdges
  search/
    text.ts           # searchText, executeFtsQuery, hydrateResult + 5 hydrate* functions
    entity.ts         # findEntity, findExact, findByFts, createEntityByIdLookup, getEntitiesByExactName
  db/
    fts.ts            # indexEntity, removeEntity, resolveTypeFilter, parseCompositeType, search
  knowledge/
    store.ts          # learnFact, listFacts, forgetFact (already uses db/fts.ts)
  types/
    entities.ts       # EntityType union, interfaces
```

### Pattern 1: Pipeline Unification (CORE-01 + CORE-08)

**What:** `indexSingleRepo()` (lines 460-649, ~190 lines) duplicates nearly all of `extractRepoData()` (lines 83-221) + `persistExtractedData()` (lines 227-286). The only difference is how the `dbSnapshot` is constructed.

**Current state:**
- `indexAllRepos()` -> snapshots DB in Phase 1 -> calls `extractRepoData()` in Phase 2 -> calls `persistExtractedData()` in Phase 3
- `indexSingleRepo()` -> does its own DB query -> reimplements all extraction inline -> reimplements all persistence inline

**Refactoring approach:**
1. `indexSingleRepo()` constructs its own `DbSnapshot` (it already does this at line 479-484)
2. Calls `extractRepoData(repoPath, options, branch, dbSnapshot)` -- the existing function
3. Calls `persistExtractedData(db, extractedData)` -- the existing function
4. The edge insertion calls (`insertEventEdges`, `insertGrpcClientEdges`, `insertEctoAssociationEdges`) are already inside `persistExtractedData()` -- unification eliminates the duplicate edge calls from `indexSingleRepo()`

**Key difference to handle:** `indexSingleRepo()` calls `detectEventRelationships()` only for surgical mode at line 586, while `extractRepoData()` always calls it at line 165. This is actually a bug in `indexSingleRepo()` -- it calls `detectEventRelationships` in the surgical branch but also calls it again in the full-mode branch (line 615). The `extractRepoData` function handles this correctly. Unification fixes this.

**Result:** `indexSingleRepo()` shrinks from ~190 lines to ~25 lines.

### Pattern 2: FTS Query Fallback (CORE-05)

**What:** Both `text.ts:executeFtsQuery()` (lines 59-103) and `entity.ts:findByFts()` (lines 271-283) implement the same try/catch/phrase-retry pattern.

**Duplication:**
```typescript
// text.ts pattern (lines 89-102):
try {
  return db.prepare(sql).all(...params) as FtsMatch[];
} catch {
  try {
    const phraseQuery = `"${processedQuery.replace(/"/g, '')}"`;
    // ... rebuild params with phraseQuery ...
    return db.prepare(sql).all(...fallbackParams) as FtsMatch[];
  } catch {
    return [];
  }
}

// entity.ts pattern (lines 271-283) -- identical structure
```

**Extract to `db/fts.ts`:**
```typescript
export function executeFtsWithFallback<T>(
  db: Database.Database,
  sql: string,
  processedQuery: string,
  buildParams: (query: string) => (string | number)[],
): T[] {
  try {
    return db.prepare(sql).all(...buildParams(processedQuery)) as T[];
  } catch {
    try {
      const phraseQuery = `"${processedQuery.replace(/"/g, '')}"`;
      return db.prepare(sql).all(...buildParams(phraseQuery)) as T[];
    } catch {
      return [];
    }
  }
}
```

Both callers pass their SQL template and a `buildParams` function. The helper handles retry logic.

### Pattern 3: Writer Insert Helpers (CORE-07)

**What:** `persistRepoData()` (lines 200-234 for modules, 237-259 for events, 262-291 for services) and `persistSurgicalData()` (lines 369-396 for modules, 399-414 for events, 417-453 for services) duplicate the same insert+FTS patterns.

**Module insertion duplication (both do):**
1. `insertFile.get(repoId, mod.filePath, null)` to get/create file record
2. `insertModule.run(repoId, fileId, mod.name, mod.type, mod.summary, ...)` to insert module
3. Build FTS description with tableName enrichment
4. `indexEntity(db, { type: 'module', id, name, description, subType })` for FTS

**Extract:**
```typescript
function insertModuleWithFts(db: Database.Database, repoId: number, mod: ModuleData, insertFile: Statement, insertModule: Statement): void
function insertEventWithFts(db: Database.Database, repoId: number, evt: EventData, insertFile: Statement, insertEvent: Statement): void
function insertServiceWithFts(db: Database.Database, repoId: number, svc: ServiceData, insertService: Statement): void
```

Both `persistRepoData()` and `persistSurgicalData()` call these helpers.

### Pattern 4: Entity Hydration Consolidation (CORE-03 + CORE-04)

**What:** `text.ts` has 5 `hydrate*()` functions that query entity tables and return `TextSearchResult`. `entity.ts` has `createEntityByIdLookup()` with a switch that queries the same tables returning `EntityInfo`. The SQL queries are nearly identical.

**Comparison of queries (module example):**

| text.ts hydrateModule | entity.ts createEntityByIdLookup module |
|---|---|
| `SELECT m.name, m.summary, r.name as repo_name, r.path as repo_path, f.path as file_path FROM modules m JOIN repos r ON m.repo_id = r.id LEFT JOIN files f ON m.file_id = f.id WHERE m.id = ?` | `SELECT m.id, m.name, m.summary, r.name as repo_name, f.path as file_path FROM modules m JOIN repos r ON m.repo_id = r.id LEFT JOIN files f ON m.file_id = f.id WHERE m.id = ?` |

The only differences: text.ts includes `r.path as repo_path`, entity.ts includes `m.id`. Both could use a superset query.

**Consolidation approach:**
1. Create a shared `EntityHydrator` in a new utility (or in `db/fts.ts` / a new `search/hydrate.ts`)
2. The hydrator returns a common superset shape (includes id, name, description, repoName, repoPath, filePath)
3. `text.ts` maps hydrated result -> `TextSearchResult` (adding snippet, relevance, subType)
4. `entity.ts` maps hydrated result -> `EntityInfo` (already a subset)

**Dispatch consolidation (CORE-04):**

Three separate switches exist:
1. `text.ts:hydrateResult()` -- dispatches on entityType to call hydrate*()
2. `entity.ts:getEntitiesByExactName()` -- dispatches on type to build SQL
3. `entity.ts:createEntityByIdLookup()` -- dispatches on type to run prepared stmts

With a shared hydrator, switches 1 and 3 merge into the hydrator's internal dispatch. Switch 2 (`getEntitiesByExactName`) is different -- it queries by name, not by ID -- so it stays separate but can use a similar registry pattern.

### Pattern 5: clearRepoEntities Consolidation (CORE-06)

**What:** `clearRepoEntities()` uses inline FTS DELETE (`deleteFts.run('module:%', mod.id)`) in loops. This is the same operation as `removeEntity()` from `db/fts.ts` but inlined for performance (avoids `db.prepare()` per call since statements are hoisted).

**Current state is already optimized from Phase 12** -- prepared statements are hoisted above loops. The remaining consolidation is to extract the select-ids-then-delete-FTS pattern into a helper:

```typescript
function clearEntityFts(
  selectStmt: Statement,
  deleteFtsStmt: Statement,
  ftsPrefix: string,
  repoId: number,
): void {
  const entities = selectStmt.all(repoId) as { id: number }[];
  for (const entity of entities) {
    deleteFtsStmt.run(ftsPrefix, entity.id);
  }
}
```

This reduces the three blocks (modules, events, services) in `clearRepoEntities()` to three calls.

### Anti-Patterns to Avoid
- **Don't create an over-abstract entity registry:** A full config-driven registry (DEF-01) is deferred to v2. Keep the refactoring as simple function extraction, not architectural overhaul.
- **Don't change public API signatures:** `indexSingleRepo`, `searchText`, `findEntity` are public APIs. Internal refactoring only.
- **Don't change the transaction boundaries:** `persistRepoData` wraps everything in a single transaction. Keep that invariant.
- **Don't break prepared statement hoisting:** Phase 12 hoisted statements for performance. Extracted helpers must accept pre-prepared statements as parameters, not call `db.prepare()` internally in hot loops.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| FTS query retry | Duplicated try/catch in each search module | Shared `executeFtsWithFallback()` in `db/fts.ts` | Two callers already identical; third could emerge |
| Entity hydration SQL | Different queries for same data | Shared hydration with superset query | 8 near-identical SQL statements across 2 files |
| Module/Event/Service insertion | Duplicated insert+FTS logic | Extracted `insert*WithFts()` helpers | 6 duplicated blocks across persistRepoData and persistSurgicalData |

**Key insight:** Every piece of duplication in this phase is "the same logic split across two callers." There are no judgment calls about which approach is better -- the implementations are literally copy-pasted with minor variations.

## Common Pitfalls

### Pitfall 1: Breaking the Transaction Boundary
**What goes wrong:** Extracting insert helpers and accidentally running them outside the transaction in `persistRepoData()`
**Why it happens:** The `db.transaction()` wrapper is easy to miss when moving code
**How to avoid:** Extracted helpers must be pure functions called *within* the existing transaction closures. They should NOT create their own transactions.
**Warning signs:** Test failures in writer.test.ts showing partial data on error

### Pitfall 2: Prepared Statement Lifetime
**What goes wrong:** Extracting a helper that calls `db.prepare()` internally, then that helper is called in a loop -- recreating prepared statements per iteration (the exact thing Phase 12 fixed)
**How to avoid:** Pass pre-prepared statements INTO helpers. The caller hoists `db.prepare()` once; the helper just calls `.run()` or `.get()` on the passed statement.
**Warning signs:** Performance regression visible in `--timing` output

### Pitfall 3: indexSingleRepo Async vs Sync
**What goes wrong:** `extractRepoData()` is `async` (returns `Promise<ExtractedRepoData>`) but `indexSingleRepo()` is synchronous. After unification, `indexSingleRepo()` would need to be `async` too.
**Why it happens:** `extractRepoData` is async because it's used with `p-limit` in `indexAllRepos`. Internally it's synchronous (better-sqlite3 + execSync git ops).
**How to avoid:** Make `indexSingleRepo()` async, or alternatively, create a sync version of the extraction (`extractRepoDataSync`). Since `extractRepoData` does no actual async work (the `async` is just for p-limit's promise interface), the cleanest approach is to make it sync and wrap it in `limit()` in `indexAllRepos`. OR keep it async and make `indexSingleRepo` async.
**Recommendation:** Make `indexSingleRepo()` async. The callers (CLI handlers, tests) can await it. This is the minimal-change path. Check if any callers treat it as sync.

### Pitfall 4: Lost Ecto Module Edge from indexSingleRepo Surgical
**What goes wrong:** `indexSingleRepo()` surgical mode has `insertEctoAssociationEdges` at line 593 and `extractRepoData()` also includes `eventRelationships` from line 165. If the two paths compute `eventRelationships` at different points, unification could lose the edge insertion.
**How to avoid:** Verify that `extractRepoData()` always computes `eventRelationships` (line 165) and returns them in the result, and `persistExtractedData()` always inserts edges (lines 244-250, 270-276). It does -- this is safe.
**Warning signs:** Pipeline test failures for edge insertion

### Pitfall 5: hydrate* Functions Not Just By ID
**What goes wrong:** Attempting to merge `getEntitiesByExactName()` (queries by name with optional filters) into the same hydrator as `createEntityByIdLookup()` (queries by id). These are fundamentally different query patterns.
**How to avoid:** Only consolidate the by-ID hydration (text.ts hydrate* + entity.ts createEntityByIdLookup). Leave `getEntitiesByExactName()` as its own dispatch -- it has different WHERE clauses (name =, optional type =, optional repo =).
**Warning signs:** Forcing a "one query to rule them all" pattern that becomes complex

## Code Examples

### FTS Fallback Helper (CORE-05)
```typescript
// In db/fts.ts -- new export
export function executeFtsWithFallback<T>(
  db: Database.Database,
  sql: string,
  processedQuery: string,
  buildParams: (query: string) => (string | number)[],
): T[] {
  try {
    return db.prepare(sql).all(...buildParams(processedQuery)) as T[];
  } catch {
    try {
      const phraseQuery = `"${processedQuery.replace(/"/g, '')}"`;
      return db.prepare(sql).all(...buildParams(phraseQuery)) as T[];
    } catch {
      return [];
    }
  }
}
```

### Writer Insert Helper (CORE-07)
```typescript
// In writer.ts -- internal helper
function insertModuleWithFts(
  insertFileStmt: Database.Statement,
  insertModuleStmt: Database.Statement,
  repoId: number,
  mod: ModuleData,
): void {
  const fileRow = insertFileStmt.get(repoId, mod.filePath, null) as { id: number } | undefined;
  const fileId = fileRow?.id ?? null;
  const modInfo = insertModuleStmt.run(repoId, fileId, mod.name, mod.type, mod.summary, mod.tableName ?? null, mod.schemaFields ?? null);

  let ftsDescription = mod.summary;
  if (mod.tableName) {
    ftsDescription = mod.summary
      ? `${mod.summary} table:${mod.tableName}`
      : `Ecto schema table: ${mod.tableName}`;
  }

  indexEntity(db, {
    type: 'module' as EntityType,
    id: Number(modInfo.lastInsertRowid),
    name: mod.name,
    description: ftsDescription,
    subType: mod.type ?? 'module',
  });
}
```

### Pipeline Unification (CORE-01)
```typescript
// indexSingleRepo becomes roughly:
export async function indexSingleRepo(
  db: Database.Database,
  repoPath: string,
  options: IndexOptions,
  branch?: string,
): Promise<IndexStats & { mode: 'full' | 'surgical' }> {
  if (!branch) {
    branch = resolveDefaultBranch(repoPath) ?? undefined;
    if (!branch) throw new Error('No main or master branch found');
  }

  // Build snapshot from DB (same query as before)
  const existingRow = db
    .prepare('SELECT id, last_indexed_commit FROM repos WHERE name = ?')
    .get(path.basename(repoPath)) as { id: number; last_indexed_commit: string | null } | undefined;

  const dbSnapshot: DbSnapshot = {
    repoId: existingRow?.id,
    lastCommit: existingRow?.last_indexed_commit ?? null,
  };

  // Reuse the shared extraction and persistence
  const extracted = await extractRepoData(repoPath, options, branch, dbSnapshot);
  return persistExtractedData(db, extracted);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Inline FTS insertion in knowledge/store.ts | Unified via db/fts.ts indexEntity() | Phase 13 (MCP-05) | CORE-02 pre-satisfied |
| Inline prepared statements in loops | Hoisted prepared statements | Phase 12 (PERF-02) | Must preserve in extracted helpers |
| No safety net | Contract tests + golden tests + CLI snapshots | Phase 11 (SAFE-01/02/03) | Full regression coverage for this refactoring |

## Open Questions

1. **Should `indexSingleRepo()` become async?**
   - What we know: `extractRepoData()` is async (for p-limit compatibility). `indexSingleRepo()` is currently sync. Making it async changes the public API signature.
   - What's unclear: Whether any callers depend on synchronous return (CLI uses it in async context already).
   - Recommendation: Check callers. If all callers are already in async context, make it async. Otherwise, create a shared sync extraction core that both functions use, with `extractRepoData` wrapping it in a Promise.

2. **How far to consolidate entity hydration (CORE-03/CORE-04)?**
   - What we know: text.ts and entity.ts query the same tables with nearly identical SQL. The output types differ (TextSearchResult vs EntityInfo).
   - What's unclear: Whether the performance cost of a superset query (fetching columns not needed by one caller) matters at all.
   - Recommendation: Create shared prepared-statement-based hydrator returning EntityInfo (the simpler type). text.ts maps EntityInfo -> TextSearchResult by adding snippet, relevance, subType from the FTS match. The extra columns (repoPath) are cheap -- one extra column in an already-small result set.

3. **Should edge functions move from pipeline.ts to writer.ts?**
   - What we know: Edge functions (`insertEventEdges`, `insertGrpcClientEdges`, `insertEctoAssociationEdges`) are persistence operations but live in pipeline.ts.
   - What's unclear: Whether moving them improves clarity or just churns imports.
   - Recommendation: Keep them in pipeline.ts for now. The CONTEXT.md mentions this as a consideration but not a requirement. Moving them is pure cosmetic and risks git blame noise. CORE-08 is satisfied by having a single call path (from `persistExtractedData`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (latest via devDep) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` (same -- 437 tests in ~15s) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORE-01 | indexSingleRepo produces same results as extractRepoData+persistExtractedData | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "indexSingleRepo"` | Yes (1517 lines) |
| CORE-02 | FTS indexing via db/fts.ts (pre-satisfied) | unit | `npx vitest run tests/knowledge/ tests/db/fts.test.ts` | Yes |
| CORE-03 | Entity hydration consistency across search modules | integration | `npx vitest run tests/search/text.test.ts tests/search/entity.test.ts` | Yes |
| CORE-04 | Entity query dispatch dedup | integration | `npx vitest run tests/search/entity.test.ts` | Yes |
| CORE-05 | FTS fallback shared between text and entity | unit | `npx vitest run tests/search/text.test.ts tests/search/entity.test.ts tests/db/fts.test.ts` | Yes (new helper test needed in fts.test.ts) |
| CORE-06 | clearRepoEntities cleanup | unit | `npx vitest run tests/indexer/writer.test.ts -t "clearRepoEntities"` | Yes |
| CORE-07 | Writer insert helpers | unit | `npx vitest run tests/indexer/writer.test.ts` | Yes |
| CORE-08 | Edge operations single call path | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "edge"` | Yes |

### Regression Guards (Phase 11)
| Guard | Command | What it catches |
|-------|---------|-----------------|
| MCP contract tests | `npx vitest run tests/mcp/contracts.test.ts` | Tool schema/response shape changes |
| FTS golden tests | `npx vitest run tests/search/golden.test.ts` | Search quality regressions |
| CLI snapshot tests | `npx vitest run tests/cli/snapshots.test.ts` | Output format changes |

### Sampling Rate
- **Per task commit:** `npx vitest run` (full suite, ~15s)
- **Per wave merge:** Same -- suite is fast enough to run every time
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/db/fts.test.ts` -- add test for new `executeFtsWithFallback()` helper (CORE-05)

All other test coverage already exists. The existing pipeline, writer, text, and entity tests cover the behaviors being refactored. No new test files needed beyond extending fts.test.ts.

## Sources

### Primary (HIGH confidence)
- Direct source code analysis of `src/indexer/pipeline.ts` (800 lines), `src/indexer/writer.ts` (461 lines), `src/search/text.ts` (263 lines), `src/search/entity.ts` (389 lines), `src/db/fts.ts` (186 lines)
- Direct source code analysis of `src/knowledge/store.ts` (89 lines) -- confirmed CORE-02 pre-satisfied
- Test suite execution: 437 tests passing across 28 test files
- Phase 11/12/13 completion artifacts in `.planning/STATE.md`

### Secondary (MEDIUM confidence)
- CONTEXT.md analysis of duplication patterns (line counts, specific code ranges)

### Tertiary (LOW confidence)
- None. All findings are from direct code reading.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, pure refactoring of existing code
- Architecture: HIGH - all duplication verified by direct source code comparison
- Pitfalls: HIGH - based on actual code patterns observed (async/sync, transaction boundaries, prepared statement hoisting)

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable -- no external dependencies involved)
