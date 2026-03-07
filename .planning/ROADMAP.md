# Roadmap: Repo Knowledge Base

## Milestones

- v1.0 MVP -- Phases 1-5 (shipped 2026-03-06)
- v1.1 Improved Reindexing -- Phases 6-10 (shipped 2026-03-07)
- v1.2 Hardening & Quick Wins -- Phases 11-15 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-5) -- SHIPPED 2026-03-06</summary>

- [x] Phase 1: Storage Foundation (1/1 plans) -- completed 2026-03-05
- [x] Phase 2: Indexing Pipeline (2/2 plans) -- completed 2026-03-05
- [x] Phase 3: Search (1/1 plans) -- completed 2026-03-05
- [x] Phase 4: CLI + MCP + Knowledge (2/2 plans) -- completed 2026-03-05
- [x] Phase 5: MCP Server (2/2 plans) -- completed 2026-03-06

</details>

<details>
<summary>v1.1 Improved Reindexing (Phases 6-10) -- SHIPPED 2026-03-07</summary>

- [x] Phase 6: Branch-Aware Tracking & Schema Migration (2/2 plans) -- completed 2026-03-06
- [x] Phase 7: Surgical File-Level Indexing (2/2 plans) -- completed 2026-03-06
- [x] Phase 8: New Extractors (3/3 plans) -- completed 2026-03-06
- [x] Phase 9: Parallel Execution (2/2 plans) -- completed 2026-03-07
- [x] Phase 10: Search Type Filtering (2/2 plans) -- completed 2026-03-07

</details>

### v1.2 Hardening & Quick Wins (In Progress)

- [x] **Phase 11: Safety Net** - Contract tests, FTS golden tests, and CLI snapshot tests before any refactoring (completed 2026-03-07)
- [x] **Phase 12: Database Performance** - SQLite pragma tuning, prepared statements, indexes, FTS5 optimization, benchmarking (completed 2026-03-07)
- [ ] **Phase 13: MCP Layer Dedup** - Extract shared error handling, auto-sync, response format, and DB path patterns
- [ ] **Phase 14: Core Layer Dedup** - Consolidate pipeline extraction, FTS indexing, entity hydration, writer, and edge operations
- [ ] **Phase 15: TypeScript Hardening** - Enable noUncheckedIndexedAccess, remove dead code, extract shared patterns, fix silent catches

## Phase Details

### Phase 11: Safety Net
**Goal**: Refactoring safety nets exist so that no subsequent phase can silently break MCP contracts, search quality, or CLI output
**Depends on**: Phase 10 (v1.1 complete)
**Requirements**: SAFE-01, SAFE-02, SAFE-03
**Success Criteria** (what must be TRUE):
  1. All 8 MCP tools have contract tests verifying their schema, parameter names, and response shapes -- a parameter rename or missing field fails the test suite
  2. A set of known search queries return expected results against snapshot data -- FTS tokenizer or ranking changes that degrade quality fail the test suite
  3. CLI commands produce JSON output matching snapshot expectations -- silent shape changes in JSON output fail the test suite
**Plans**: 2 plans
Plans:
- [ ] 11-01-PLAN.md — MCP tool contract tests (input schemas + output shapes for all 8 tools)
- [ ] 11-02-PLAN.md — FTS golden query tests + CLI output shape snapshot tests

### Phase 12: Database Performance
**Goal**: Indexing and search are measurably faster through SQLite tuning, statement reuse, proper indexes, and FTS5 optimization
**Depends on**: Phase 11 (safety nets catch any regressions from DB changes)
**Requirements**: PERF-01, PERF-02, PERF-03, PERF-04, PERF-05, PERF-06, PERF-07
**Success Criteria** (what must be TRUE):
  1. SQLite connections open with tuned pragmas (cache_size, temp_store, mmap_size) -- verified by querying pragma values after connection
  2. Hot-loop SQL in fts.ts, writer.ts, entity.ts, dependencies.ts, and status.ts uses hoisted prepared statements -- no db.prepare() calls inside loops
  3. Entity lookups by name hit database indexes instead of table scans -- V5 migration adds indexes on modules, events, and services
  4. FTS5 runs optimize after bulk indexing and WAL checkpoints after index completes -- observable in perf_hooks timing output
  5. Indexing and search operations have perf_hooks instrumentation that reports wall-clock timing for benchmarking before/after
**Plans**: 3 plans
Plans:
- [ ] 12-01-PLAN.md — SQLite pragma tuning, V5 migration (indexes + FTS5 prefix rebuild)
- [ ] 12-02-PLAN.md — Prepared statement hoisting in fts.ts, writer.ts, entity.ts, dependencies.ts
- [ ] 12-03-PLAN.md — FTS5 optimize, WAL checkpoint, and --timing CLI instrumentation

### Phase 13: MCP Layer Dedup
**Goal**: MCP tool implementations share error handling, auto-sync, response formatting, and DB path resolution through extracted helpers
**Depends on**: Phase 11 (MCP contract tests protect against regressions)
**Requirements**: MCP-01, MCP-02, MCP-03, MCP-04, MCP-05
**Success Criteria** (what must be TRUE):
  1. A single wrapToolHandler HOF handles try/catch for all 8 MCP tools -- individual tools contain no duplicated error handling boilerplate
  2. Auto-sync logic lives in one withAutoSync helper -- the 3 tools that trigger auto-sync call this helper instead of inlining the pattern
  3. All MCP tools return a consistent McpResponse shape -- response format does not vary tool-by-tool
  4. DB path resolution is a shared utility called by all tools -- no duplicated path logic across tool files
  5. learned_fact is a member of the EntityType union and FTS indexing for facts goes through db/fts.ts indexEntity -- no separate FTS path in knowledge/store.ts
**Plans**: TBD

### Phase 14: Core Layer Dedup
**Goal**: Core indexing, search, and persistence code is deduplicated so that changes to extraction, FTS indexing, entity queries, or edge operations only need to happen in one place
**Depends on**: Phase 12 (performance baselines established), Phase 13 (MCP layer clean)
**Requirements**: CORE-01, CORE-02, CORE-03, CORE-04, CORE-05, CORE-06, CORE-07, CORE-08
**Success Criteria** (what must be TRUE):
  1. Pipeline extraction logic exists in one shared function -- indexSingleRepo and extractRepoData call the same extraction code, not parallel implementations
  2. All FTS indexing (including knowledge facts) flows through db/fts.ts indexEntity -- knowledge/store.ts does not maintain its own FTS insertion logic
  3. Entity hydration and entity query dispatch each live in one place -- search modules share a single hydration pattern and a single query router
  4. FTS query fallback logic (retry without special characters, broader match) is shared between text.ts and entity.ts
  5. Writer insert helpers, clearRepoEntities batch cleanup, and edge insertion operations (event edges, gRPC client edges, Ecto association edges) are each consolidated into single implementations
**Plans**: TBD

### Phase 15: TypeScript Hardening
**Goal**: TypeScript strictness is tightened and remaining code quality issues (dead code, asymmetric patterns, silent failures) are resolved
**Depends on**: Phase 14 (structural changes settled -- fix once, not twice)
**Requirements**: TS-01, TS-02, TS-03, TS-04
**Success Criteria** (what must be TRUE):
  1. tsconfig.json has noUncheckedIndexedAccess enabled and the project compiles cleanly -- all array/record access sites handle undefined
  2. Dead code in git.ts (HEAD-based getChangedFiles variant, if unused) is removed -- grep confirms no remaining callers
  3. Dependencies upstream/downstream query logic uses a single parameterized function -- the direction (upstream vs downstream) is a parameter, not duplicated code
  4. No silent catch blocks remain -- all catch blocks either log structured error information or explicitly document why silence is intentional
**Plans**: TBD

## Progress

**Execution Order:** 11 -> 12 -> 13 -> 14 -> 15

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Storage Foundation | v1.0 | 1/1 | Complete | 2026-03-05 |
| 2. Indexing Pipeline | v1.0 | 2/2 | Complete | 2026-03-05 |
| 3. Search | v1.0 | 1/1 | Complete | 2026-03-05 |
| 4. CLI + Knowledge | v1.0 | 2/2 | Complete | 2026-03-05 |
| 5. MCP Server | v1.0 | 2/2 | Complete | 2026-03-06 |
| 6. Branch-Aware Tracking | v1.1 | 2/2 | Complete | 2026-03-06 |
| 7. Surgical File-Level Indexing | v1.1 | 2/2 | Complete | 2026-03-06 |
| 8. New Extractors | v1.1 | 3/3 | Complete | 2026-03-06 |
| 9. Parallel Execution | v1.1 | 2/2 | Complete | 2026-03-07 |
| 10. Search Type Filtering | v1.1 | 2/2 | Complete | 2026-03-07 |
| 11. Safety Net | 2/2 | Complete    | 2026-03-07 | - |
| 12. Database Performance | 3/3 | Complete    | 2026-03-07 | - |
| 13. MCP Layer Dedup | v1.2 | 0/? | Not started | - |
| 14. Core Layer Dedup | v1.2 | 0/? | Not started | - |
| 15. TypeScript Hardening | v1.2 | 0/? | Not started | - |
