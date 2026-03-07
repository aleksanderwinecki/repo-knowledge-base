# Phase 14: Core Layer Dedup - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Consolidate duplicated core indexing, search, and persistence code so that changes to extraction pipelines, FTS indexing, entity queries, FTS fallback, batch cleanup, writer operations, and edge insertion only need to happen in one place. No new features — pure deduplication of core layer code.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

User delegated all implementation decisions to Claude. The following areas have been analyzed with recommended approaches:

**Pipeline extraction unification (CORE-01):**
- `indexSingleRepo()` (~190 lines) duplicates `extractRepoData()` nearly verbatim — both do metadata extraction, mode detection, extractor runs, module/event/service mapping, and surgical filtering
- Refactor `indexSingleRepo()` to call `extractRepoData()` then `persistExtractedData()` instead of reimplementing inline
- `indexSingleRepo` needs a small adapter: it creates its own `dbSnapshot` from a direct DB query, whereas `indexAllRepos` snapshots during the prep phase
- The edge insertion calls (`insertEventEdges`, `insertGrpcClientEdges`, `insertEctoAssociationEdges`) are already in `persistExtractedData()` — unifying the pipeline naturally consolidates these too

**FTS indexing paths (CORE-02):**
- ALREADY DONE by Phase 13 (MCP-05): `knowledge/store.ts` now routes through `db/fts.ts indexEntity()`/`removeEntity()`
- No further work needed — mark as complete when updating REQUIREMENTS.md

**Entity hydration consolidation (CORE-03):**
- `text.ts` has 5 `hydrate*()` functions (hydrateRepo, hydrateModule, hydrateEvent, hydrateService, hydrateLearnedFact) that each query a table and return `TextSearchResult`
- `entity.ts` has `createEntityByIdLookup()` with a switch that queries the same tables returning `EntityInfo`
- The queries are nearly identical — same JOINs, same columns, different output shapes
- Consolidate into a shared hydration layer that both modules use, mapping to their output types

**Entity query dispatch (CORE-04):**
- `entity.ts:getEntitiesByExactName()` has a switch on entity type
- `entity.ts:createEntityByIdLookup()` has another switch
- `text.ts:hydrateResult()` has a switch
- These all dispatch on entity type to do table-specific queries
- Consolidate the dispatch pattern — a single entity registry or lookup map that both search paths use

**FTS query fallback sharing (CORE-05):**
- `text.ts:executeFtsQuery()` (lines 59-103) and `entity.ts:findByFts()` (lines 271-283) both implement: try MATCH → catch → retry as phrase query
- Extract to a shared `executeFtsWithFallback()` helper in `db/fts.ts` that handles the try/catch/phrase-retry pattern
- Both callers pass their SQL template and params; the helper handles retry logic

**clearRepoEntities optimization (CORE-06):**
- Currently uses inline FTS DELETE (`deleteFts.run('module:%', mod.id)`) in a loop per entity type
- Could batch the FTS cleanup or use `removeEntity()` from `db/fts.ts` — but `removeEntity()` has its own prepare overhead
- The inline pattern from Phase 12 is already optimized with hoisted statements; further optimization is to consolidate the select-id-then-delete-fts pattern into a shared helper

**Writer insert helpers (CORE-07):**
- `persistRepoData()` and `persistSurgicalData()` duplicate module insertion logic: insertFile → insertModule → build FTS description → indexEntity
- Same for events: insertFile → insertEvent → indexEntity
- Same for services: insertService → indexEntity
- Extract `insertModuleWithFts()`, `insertEventWithFts()`, `insertServiceWithFts()` helpers that both persist functions call

**Edge operations consolidation (CORE-08):**
- `insertEventEdges`, `insertGrpcClientEdges`, `insertEctoAssociationEdges` are in `pipeline.ts`
- Called from both `indexSingleRepo()` and `persistExtractedData()`
- If CORE-01 unifies the pipeline, this consolidation follows naturally — the edge functions stay in place, just called from one path instead of two
- Consider moving them from `pipeline.ts` to `writer.ts` (they're persistence operations, not extraction)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/indexer/pipeline.ts:extractRepoData()`: async extraction function already used by `indexAllRepos` parallel pipeline — can be reused by `indexSingleRepo`
- `src/indexer/pipeline.ts:persistExtractedData()`: handles both full and surgical persist from `ExtractedRepoData` — already deduplicates the persist path
- `src/db/fts.ts:indexEntity()/removeEntity()`: standard FTS path now used by knowledge store (Phase 13)
- `src/db/fts.ts:resolveTypeFilter()/parseCompositeType()`: shared FTS utilities already used by both search modules
- Phase 11 contract/golden/snapshot tests catch regressions
- Phase 12 hoisted prepared statements in writer.ts, entity.ts, dependencies.ts

### Established Patterns
- Transaction wrapping via `db.transaction()` — used consistently in writer.ts
- Prepared statement hoisting to module-level or function-level
- `createEntityByIdLookup()` / `createRelationshipLookup()` factory pattern for pre-prepared statements
- `ExtractedRepoData` interface as the boundary between extraction and persistence

### Integration Points
- `src/indexer/pipeline.ts`: `extractRepoData()`, `persistExtractedData()`, `indexSingleRepo()`, `indexAllRepos()`, three edge functions
- `src/indexer/writer.ts`: `persistRepoData()`, `persistSurgicalData()`, `clearRepoEntities()`, `clearRepoFiles()`, `clearRepoEdges()`
- `src/search/text.ts`: FTS query execution, hydration functions
- `src/search/entity.ts`: FTS fallback, entity lookup, exact name queries
- `src/db/fts.ts`: `indexEntity()`, `removeEntity()` — shared FTS path

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User delegated all decisions to Claude's judgment, consistent with phases 11-13 in this milestone.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 14-core-layer-dedup*
*Context gathered: 2026-03-07*
