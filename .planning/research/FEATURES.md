# Feature Landscape: Refactoring & Optimization Patterns

**Domain:** Code hardening for Node.js/TypeScript CLI + MCP tool with SQLite backend
**Researched:** 2026-03-07
**Codebase:** 5,739 src LOC across 46 files, 388 tests

## Table Stakes

Refactoring items that any maintainable codebase of this size should have. Missing any of these will bite you during the next feature build.

### TS-01: MCP Tool Error Handling Boilerplate Extraction

| Attribute | Detail |
|-----------|--------|
| Why Expected | Every MCP tool (8 files) has identical try/catch with `error instanceof Error ? error.message : String(error)` and identical `{ content: [{ type: 'text' as const, text }], isError: true }` return shape |
| Complexity | Low |
| Depends On | `src/mcp/tools/*.ts` (all 8 files) |
| Current LOC duplication | ~48 lines (6 per file x 8 files) |

**What to do:** Extract a `wrapToolHandler(fn): ToolHandler` higher-order function in `src/mcp/format.ts` (or new `src/mcp/errors.ts`). Each tool file shrinks by 6-8 lines and error format is guaranteed consistent.

```typescript
// Before (repeated 8 times):
async (args) => {
  try {
    // ...tool logic
    return { content: [{ type: 'text' as const, text }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { content: [{ type: 'text' as const, text: `Error ...: ${message}` }], isError: true };
  }
}

// After:
wrapToolHandler('searching', async (args) => {
  // ...tool logic only
  return text;
})
```

### TS-02: MCP Auto-Sync Pattern Deduplication

| Attribute | Detail |
|-----------|--------|
| Why Expected | Three MCP tools (search, entity, deps) repeat the same "extract repo names -> checkAndSyncRepos -> re-run if synced" pattern with ~12 lines each |
| Complexity | Low |
| Depends On | `src/mcp/tools/search.ts`, `entity.ts`, `deps.ts`, `src/mcp/sync.ts` |
| Current LOC duplication | ~36 lines |

**What to do:** Extract `withAutoSync<T>(db, repoNames: string[], query: () => T): T` into `src/mcp/sync.ts`. Takes a query function, runs it, checks sync, re-runs if needed.

### TS-03: DB Path Resolution Deduplication

| Attribute | Detail |
|-----------|--------|
| Why Expected | `getDbPath()` logic is duplicated between `src/cli/db.ts` (L14-19) and `src/mcp/server.ts` (L41). Same `process.env.KB_DB_PATH ?? path.join(os.homedir(), '.kb', 'knowledge.db')` |
| Complexity | Low |
| Depends On | `src/cli/db.ts`, `src/mcp/server.ts` |

**What to do:** Either import `getDbPath` from `cli/db.ts` into the MCP server, or (better) move `getDbPath` to `src/db/database.ts` since it's database infrastructure, not CLI-specific.

### TS-04: `pipeline.ts` Massive Code Duplication Between `indexSingleRepo` and `extractRepoData`

| Attribute | Detail |
|-----------|--------|
| Why Expected | `indexSingleRepo` (lines 448-637, ~190 lines) and `extractRepoData` (lines 83-221, ~140 lines) contain **nearly identical** extraction logic: same module mapping, same GraphQL mapping, same Absinthe mapping, same surgical mode detection. This is the single largest duplication in the codebase. |
| Complexity | Medium |
| Depends On | `src/indexer/pipeline.ts` |
| Current LOC duplication | ~130 lines of direct copy-paste |

**What to do:** Extract shared extraction into a pure function like `runExtractors(repoPath, branch)` that returns `{ elixirModules, protoDefinitions, graphqlDefinitions, allModules, services }`. Both `indexSingleRepo` and `extractRepoData` call it. The surgical/full mode decision and DB snapshot handling remain in their respective functions.

Specific duplicated blocks:
- Service mapping from proto (lines 123-129 vs 502-508)
- GraphQL module mapping (lines 132-139 vs 511-518)
- Elixir module mapping (lines 142-149 vs 521-528)
- Absinthe module mapping (lines 152-159 vs 531-538)
- Event mapping from proto messages (lines 174-180, 201-207 vs 554-558, 595-600)

### TS-05: Entity Hydration Pattern in `search/text.ts`

| Attribute | Detail |
|-----------|--------|
| Why Expected | Five `hydrate*` functions (hydrateRepo, hydrateModule, hydrateEvent, hydrateService, hydrateLearnedFact) follow an identical pattern: query DB, null-check, construct TextSearchResult. Same structure, different SQL. |
| Complexity | Medium |
| Depends On | `src/search/text.ts` |
| Current LOC | ~135 lines for 5 functions |

**What to do:** Extract a generic `hydrateEntity<T>(db, sql, id, mapper): TextSearchResult | null` that handles the query + null-check. Each hydrate function becomes a config object (SQL string + field mapping). Reduces 135 lines to ~50.

### TS-06: Entity Query Duplication Between `entity.ts` Functions

| Attribute | Detail |
|-----------|--------|
| Why Expected | `getEntitiesByExactName` (lines 193-257) and `getEntityById` (lines 259-311) in `search/entity.ts` contain near-identical switch statements with the same SQL JOINs per entity type. Four cases each, same SQL structure. |
| Complexity | Medium |
| Depends On | `src/search/entity.ts` |
| Current LOC duplication | ~120 lines (two switch statements) |

**What to do:** Create an `entityQueryConfig` map that defines `{ table, joinSql, columns, descriptionColumn, filePathColumn }` per entity type. Both functions use the config to build queries dynamically. This also makes adding new entity types a single config entry instead of updating two switch statements.

### TS-07: FTS Query Fallback Duplication

| Attribute | Detail |
|-----------|--------|
| Why Expected | The "try FTS MATCH, catch -> try phrase match, catch -> empty" pattern is duplicated in `search/text.ts` (L89-102) and `search/entity.ts` (L144-155). Same retry logic, same phrase escaping. |
| Complexity | Low |
| Depends On | `src/search/text.ts`, `src/search/entity.ts` |

**What to do:** Extract `executeFtsWithFallback(db, sql, params, processedQuery): rows[]` to `src/db/fts.ts`. Both search modules call it.

### TS-08: `clearRepoEntities` Repetitive FTS Cleanup Loop

| Attribute | Detail |
|-----------|--------|
| Why Expected | `clearRepoEntities` in `writer.ts` (L84-122) queries then loops over modules, events, and services with identical `removeEntity` calls. Three separate query+loop blocks doing the same thing. |
| Complexity | Low |
| Depends On | `src/indexer/writer.ts` |

**What to do:** Extract `clearEntitiesByType(db, tableName, entityType, repoId)` helper, or use batch SQL: `DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id IN (SELECT id FROM modules WHERE repo_id = ?)`. The batch approach also avoids N+1 query/delete for repos with many entities.

### TS-09: Inconsistent MCP Response Formats

| Attribute | Detail |
|-----------|--------|
| Why Expected | MCP tools use three different response formats: (a) `formatResponse()` wrapper with `{ summary, data, total, truncated }` shape (search, entity, deps), (b) ad-hoc `JSON.stringify({ summary, data })` (learn, forget, cleanup, status), (c) bare `JSON.stringify(types)` (list-types). AI consumers benefit from consistent shape. |
| Complexity | Low |
| Depends On | All `src/mcp/tools/*.ts` |

**What to do:** All tools should return the `McpResponse` shape from `format.ts`. For single-item results like learn/forget, use `formatResponse([result], summaryFn, 1)`. For status, wrap in `formatResponse`. This ensures every MCP response has `summary`, `data`, `total`, `truncated`.

### TS-10: Prepared Statement Caching Opportunity

| Attribute | Detail |
|-----------|--------|
| Why Expected | `db.prepare()` is called inline throughout the codebase -- in loops inside `clearRepoEntities`, `clearRepoFiles`, `findLinkedRepos`, and `getRelationships`. Each call creates a new prepared statement object. better-sqlite3 internally caches these, but the pattern is noisy and masks intent. |
| Complexity | Low |
| Depends On | Systemic across `src/indexer/writer.ts`, `src/search/entity.ts`, `src/search/dependencies.ts` |

**What to do:** Move frequent prepared statements to function-level `const` declarations (hoist out of loops). The `status.ts` MCP tool is the worst offender: 7 separate `db.prepare('SELECT COUNT(*) ...')` calls that could become a single multi-table count query. Note: better-sqlite3 does cache `prepare()` calls internally, so this is readability-first, performance-second.

## Differentiators

Not expected for a tool of this maturity, but would meaningfully improve quality or developer experience.

### DF-01: `git.ts` Duplication Between `getChangedFiles` and `getChangedFilesSinceBranch`

| Attribute | Detail |
|-----------|--------|
| Value Proposition | `getChangedFiles` (L25-71) and `getChangedFilesSinceBranch` (L217-264) are functionally identical except for the git diff target (`HEAD` vs branch name). 47 lines duplicated. `getChangedFiles` may be dead code now that branch-aware variants exist. |
| Complexity | Low |
| Depends On | `src/indexer/git.ts` |

**What to do:** Check whether `getChangedFiles` (HEAD-based) is still called anywhere. If not, remove it. If yes, make it delegate to `getChangedFilesSinceBranch(repoPath, sinceCommit, 'HEAD')`. Extract the shared diff-output parsing into a `parseDiffNameStatus(output)` helper.

### DF-02: `metadata.ts` Filesystem/Branch Variant Duplication

| Attribute | Detail |
|-----------|--------|
| Value Proposition | `extractDescription` / `extractDescriptionFromBranch`, `detectTechStack` / `detectTechStackFromBranch`, `detectKeyFiles` / `detectKeyFilesFromBranch` are 3 pairs of functions with identical logic but different I/O sources (fs vs git). ~175 lines that could be ~100 with a strategy pattern. |
| Complexity | Medium |
| Depends On | `src/indexer/metadata.ts`, `src/indexer/git.ts` |

**What to do:** Create a `FileReader` interface: `{ readFile(path): string | null, fileExists(path): boolean, listFiles(): string[] }`. Implement `FsFileReader` and `GitBranchFileReader`. All three detection functions take a `FileReader` parameter. Cuts 6 functions to 3.

### DF-03: Type-Safe Entity Type Registry

| Attribute | Detail |
|-----------|--------|
| Value Proposition | Entity types are scattered across 6+ locations: `EntityType` union in `types/entities.ts`, `COARSE_TYPES` Set in `fts.ts`, `MODULE_SUB_TYPES` and `SERVICE_SUB_TYPES` Sets in `entity.ts`, `tableMap` in `resolveEntityName`, hydrate switch in `text.ts`, query switch in `entity.ts`. Adding a new entity type requires touching all of them. |
| Complexity | Medium |
| Depends On | `src/types/entities.ts`, `src/db/fts.ts`, `src/search/entity.ts`, `src/search/text.ts` |

**What to do:** Create a centralized `EntityRegistry` (a typed config object, not a class) that maps entity type -> `{ tableName, nameColumn, descriptionColumn, joinSql, filePathExpression, subTypes }`. All the scattered switches and Sets derive from this single source of truth.

### DF-04: `dependencies.ts` Upstream/Downstream Symmetry Extraction

| Attribute | Detail |
|-----------|--------|
| Value Proposition | `findLinkedRepos` has mirrored upstream/downstream branches (L112-142 vs L142-176) with identical structure but swapped produces/consumes relationship types. ~64 lines that could be ~35. |
| Complexity | Low |
| Depends On | `src/search/dependencies.ts` |

**What to do:** Parameterize by `{ sourceRelType, targetRelType }` -- upstream uses `{ consumes_event, produces_event }`, downstream uses the reverse. One code path handles both directions.

### DF-05: `learned_fact` Not in EntityType Union

| Attribute | Detail |
|-----------|--------|
| Value Proposition | `learned_fact` is stored in FTS as an entity_type string but is NOT in the `EntityType` union. This forces unsafe casts like `'learned_fact' as EntityType` in text.ts L253 and bypasses `indexEntity()` in store.ts L29-31 (writes directly to FTS with raw SQL). |
| Complexity | Low |
| Depends On | `src/types/entities.ts`, `src/knowledge/store.ts`, `src/search/text.ts` |

**What to do:** Add `'learned_fact'` to the `EntityType` union. Update `learnFact()` to use `indexEntity()` instead of raw FTS INSERT. This eliminates the unsafe cast and ensures consistent FTS composite format (`learned_fact:learned_fact`).

### DF-06: MCP Status Tool Inline SQL / CLI-MCP Status Divergence

| Attribute | Detail |
|-----------|--------|
| Value Proposition | `status.ts` MCP tool has 7 individual `SELECT COUNT(*)` queries plus a staleness check loop -- all inline, untestable. CLI status command (`cli/commands/status.ts`) has its own count logic with a different shape. The two status outputs are inconsistent. |
| Complexity | Medium |
| Depends On | `src/mcp/tools/status.ts`, `src/cli/commands/status.ts` |

**What to do:** Extract `getKbStats(db): KbStats` to a shared module (e.g., `src/db/stats.ts`). Both CLI and MCP status call it. Replace 7 separate COUNT queries with a single multi-table query or a reusable helper. Staleness checking logic already partially exists in `mcp/sync.ts` and `mcp/hygiene.ts` -- consolidate.

### DF-07: `writer.ts` Module/Event Insert Duplication Between `persistRepoData` and `persistSurgicalData`

| Attribute | Detail |
|-----------|--------|
| Value Proposition | Both persist functions prepare identical INSERT statements for files, modules, events, and services. The module FTS description building logic (Ecto table name enrichment) is copy-pasted between them. ~70 lines duplicated. |
| Complexity | Medium |
| Depends On | `src/indexer/writer.ts` |

**What to do:** Extract `insertModulesWithFts(db, repoId, modules)`, `insertEventsWithFts(db, repoId, events)`, `insertServicesWithFts(db, repoId, services)` as shared helpers. Both persist paths call these shared functions. The Ecto table name FTS enrichment logic lives in one place.

### DF-08: Edge Insertion Function Sharing in `pipeline.ts`

| Attribute | Detail |
|-----------|--------|
| Value Proposition | `insertEventEdges`, `insertGrpcClientEdges`, `insertEctoAssociationEdges` (lines 645-787) all prepare the same `INSERT INTO edges` statement independently. They also share the "look up same-repo then any-repo" entity resolution pattern. |
| Complexity | Low |
| Depends On | `src/indexer/pipeline.ts` |

**What to do:** Extract a shared `resolveEntity(db, table, name, repoId): id | null` helper for the two-step "same repo first, then global" lookup pattern. Share the edge INSERT prepared statement.

## Anti-Features

Refactoring work that looks tempting but should NOT be done for this project.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| ORM/query builder layer | better-sqlite3's raw SQL with `.prepare()` is the right abstraction for this project size. An ORM adds complexity without value for 46 files. | Keep raw SQL. The entity registry config (DF-03) gives most of the DRY benefit without the abstraction cost. |
| Abstract base class for MCP tools | 8 tool files don't warrant a class hierarchy. Composition (TS-01 wrapper + TS-02 auto-sync) handles it better. | Use HOF wrappers, not inheritance. |
| Plugin architecture for extractors | Current 6 extractors are stable and hardcoded. A plugin system adds indirection for no user benefit. | Keep extractors as direct imports. Add new ones as new files + pipeline imports. |
| Dependency injection container | The codebase passes `db` as a function parameter everywhere -- this IS dependency injection, just the simple kind. A DI container over-engineers a CLI tool. | Keep parameter passing. The `withDb` pattern in CLI is already clean. |
| Monorepo/workspace split | 5.7K LOC doesn't warrant package boundaries. The current `src/` directory structure (db, indexer, search, mcp, cli, knowledge) already provides good module boundaries. | Keep as single package. |
| Generic extractor result type | Elixir, proto, and GraphQL extractors return very different shapes. Forcing a common interface would lose type safety and require runtime type guards everywhere. | Keep specific types per extractor. The mapping to `ModuleData`/`EventData`/`ServiceData` in pipeline.ts is the right unification point. |
| Async refactor for better-sqlite3 calls | better-sqlite3 is synchronous by design. Wrapping sync calls in `Promise.resolve()` or `setImmediate()` adds overhead without enabling true parallelism. The DB is the serialization point. | Keep synchronous DB operations. Only extraction (filesystem/git I/O) benefits from async. |

## Feature Dependencies

```
TS-01 (error wrapper)     -- standalone, no dependencies
TS-02 (auto-sync)         -- standalone, no dependencies
TS-03 (db path)           -- standalone, no dependencies
TS-04 (pipeline extract)  -- standalone (largest impact)
TS-05 (hydration)         -- benefits from DF-03 (entity registry) but not required
TS-06 (entity queries)    -- benefits from DF-03 (entity registry) but not required
TS-07 (FTS fallback)      -- standalone
TS-08 (clear entities)    -- standalone
TS-09 (response format)   -- easier after TS-01 (error wrapper exists)
TS-10 (prepared stmts)    -- standalone

DF-01 (git dedup)         -- standalone
DF-02 (metadata strategy) -- standalone
DF-03 (entity registry)   -- enables cleaner TS-05, TS-06, DF-05
DF-04 (deps symmetry)     -- standalone
DF-05 (learned_fact type) -- part of DF-03 effort or standalone
DF-06 (status shared)     -- standalone
DF-07 (writer inserts)    -- standalone
DF-08 (edge inserts)      -- standalone
```

## MVP Recommendation

Prioritize these in order of impact-to-effort ratio:

1. **TS-04: Pipeline extraction dedup** -- Largest single duplication (~130 lines). High risk of bugs when only one copy gets updated. Do this first.
2. **TS-01: MCP error wrapper** -- Low effort, touches all 8 MCP tools. Creates the foundation for TS-09.
3. **TS-02: MCP auto-sync dedup** -- Low effort, pairs naturally with TS-01.
4. **TS-07: FTS fallback dedup** -- Quick win, shared by two search modules.
5. **TS-03: DB path dedup** -- Trivial, 5-minute fix.
6. **DF-01: git.ts dedup** -- Likely includes dead code removal. Quick win.
7. **DF-07: Writer insert dedup** -- Moderate effort, reduces two-location bug risk in persistence layer.
8. **TS-09: Response format consistency** -- After TS-01 is done, this becomes easy.
9. **DF-05: learned_fact in EntityType** -- Small fix with outsized type-safety improvement.

**Defer to later milestones:**
- **DF-02 (metadata strategy pattern)**: Works fine as-is, refactor only if adding a third I/O source.
- **DF-03 (entity registry)**: High value but medium complexity. Better suited for when a new entity type is actually being added.
- **DF-06 (shared status)**: The CLI and MCP status diverge intentionally (MCP adds staleness). Unify only when the divergence becomes a maintenance burden.

## Complexity Budget Summary

| Category | Count | Estimated Total Effort |
|----------|-------|----------------------|
| Table Stakes (Low) | 6 items | ~4-6 hours |
| Table Stakes (Medium) | 4 items | ~6-8 hours |
| Differentiators (Low) | 4 items | ~3-4 hours |
| Differentiators (Medium) | 4 items | ~6-8 hours |
| **Total** | **18 items** | **~19-26 hours** |

The table stakes items alone would eliminate approximately 350-400 lines of duplication and establish patterns that prevent future duplication in the same areas.

## Sources

- Direct codebase analysis of all 46 source files (HIGH confidence -- every file read in full)
- Line-by-line comparison of duplicated patterns with specific line numbers cited
- better-sqlite3 prepared statement caching behavior (training data, MEDIUM confidence)
- MCP SDK tool handler type signatures (from codebase `@modelcontextprotocol/sdk` imports, HIGH confidence)
