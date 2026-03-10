# Roadmap: Repo Knowledge Base

## Milestones

- v1.0 MVP -- Phases 1-5 (shipped 2026-03-06)
- v1.1 Improved Reindexing -- Phases 6-10 (shipped 2026-03-07)
- v1.2 Hardening & Quick Wins -- Phases 11-15 (shipped 2026-03-07)
- v2.0 Design-Time Intelligence -- Phases 16-20 (shipped 2026-03-09)
- v2.1 Cleanup & Tightening -- Phases 21-22 (shipped 2026-03-09)
- v3.0 Graph Intelligence -- Phases 23-26 (shipped 2026-03-10)
- v3.1 Indexing UX -- Phases 27-28 (shipped 2026-03-10)
- v4.0 Data Contract Intelligence -- Phases 29-31 (shipped 2026-03-10)
- v4.1 Indexing Performance -- Phases 32-33 (in progress)

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

<details>
<summary>v1.2 Hardening & Quick Wins (Phases 11-15) -- SHIPPED 2026-03-07</summary>

- [x] Phase 11: Safety Net (2/2 plans) -- completed 2026-03-07
- [x] Phase 12: Database Performance (3/3 plans) -- completed 2026-03-07
- [x] Phase 13: MCP Layer Dedup (2/2 plans) -- completed 2026-03-07
- [x] Phase 14: Core Layer Dedup (3/3 plans) -- completed 2026-03-07
- [x] Phase 15: TypeScript Hardening (2/2 plans) -- completed 2026-03-07

</details>

<details>
<summary>v2.0 Design-Time Intelligence (Phases 16-20) -- SHIPPED 2026-03-09</summary>

- [x] Phase 16: Topology Extraction (3/3 plans) -- completed 2026-03-08
- [x] Phase 17: Topology Query Layer (2/2 plans) -- completed 2026-03-08
- [x] Phase 18: Embedding Infrastructure (2/2 plans) -- completed 2026-03-08
- [x] Phase 19: Semantic Search (2/2 plans) -- completed 2026-03-08
- [x] Phase 20: Targeted Repo Reindex (2/2 plans) -- completed 2026-03-09

</details>

<details>
<summary>v2.1 Cleanup & Tightening (Phases 21-22) -- SHIPPED 2026-03-09</summary>

- [x] Phase 21: Embedding Removal (2/2 plans) -- completed 2026-03-09
- [x] Phase 22: Fixes & Metadata (2/2 plans) -- completed 2026-03-09

</details>

<details>
<summary>v3.0 Graph Intelligence (Phases 23-26) -- SHIPPED 2026-03-10</summary>

- [x] Phase 23: Graph Infrastructure (2/2 plans) -- completed 2026-03-09
- [x] Phase 24: Blast Radius (3/3 plans) -- completed 2026-03-09
- [x] Phase 25: Flow Tracing (2/2 plans) -- completed 2026-03-09
- [x] Phase 26: Service Explanation (2/2 plans) -- completed 2026-03-09

</details>

<details>
<summary>v3.1 Indexing UX (Phases 27-28) -- SHIPPED 2026-03-10</summary>

- [x] Phase 27: Progress Reporting & Error Grouping (2/2 plans) -- completed 2026-03-10
- [x] Phase 28: Output Control & Summary (2/2 plans) -- completed 2026-03-10

</details>

<details>
<summary>v4.0 Data Contract Intelligence (Phases 29-31) -- SHIPPED 2026-03-10</summary>

- [x] Phase 29: Field Extraction & Schema (2/2 plans) -- completed 2026-03-10
- [x] Phase 30: Field Search & Shared Concepts (2/2 plans) -- completed 2026-03-10
- [x] Phase 31: Field Edges & Field Impact (2/2 plans) -- completed 2026-03-10

</details>

### v4.1 Indexing Performance (In Progress)

- [ ] **Phase 32: Schema Drop & Rebuild** - Replace incremental migrations with drop+rebuild, preserve learned facts
- [ ] **Phase 33: Filesystem Reads** - Replace git child process spawning with direct filesystem reads

## Phase Details

### Phase 32: Schema Drop & Rebuild
**Goal**: Schema version mismatches handled by clean drop+rebuild instead of incremental migrations
**Depends on**: Phase 31
**Requirements**: SCH-01, SCH-02, SCH-03
**Success Criteria** (what must be TRUE):
  1. When schema version changes, the DB is dropped and recreated with the current schema -- no migration chain to maintain
  2. A single `createSchema()` function creates all tables at the current version -- no migration functions exist
  3. User's learned facts survive a schema rebuild (exported before drop, re-imported after)
**Plans**: TBD

### Phase 33: Filesystem Reads
**Goal**: Extractors read from the working tree filesystem instead of spawning git child processes
**Depends on**: Phase 32
**Requirements**: FS-01, FS-02, FS-03, FS-04, COR-01, COR-02, COR-03
**Success Criteria** (what must be TRUE):
  1. Running `kb index` produces identical results with no `execSync('git show')` or `execSync('git ls-tree')` calls anywhere in the codebase
  2. Extractor functions accept a repo path -- no `branch` parameter in any extractor signature
  3. `kb index --repo foo --refresh` still fetches and resets to remote default branch before indexing
  4. Incremental indexing (skip unchanged repos via HEAD comparison) still works correctly
  5. All existing tests pass after the refactor
**Plans**: TBD

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-5 | v1.0 | 9/9 | Complete | 2026-03-06 |
| 6-10 | v1.1 | 11/11 | Complete | 2026-03-07 |
| 11-15 | v1.2 | 12/12 | Complete | 2026-03-07 |
| 16-20 | v2.0 | 11/11 | Complete | 2026-03-09 |
| 21-22 | v2.1 | 4/4 | Complete | 2026-03-09 |
| 23-26 | v3.0 | 9/9 | Complete | 2026-03-10 |
| 27-28 | v3.1 | 4/4 | Complete | 2026-03-10 |
| 29-31 | v4.0 | 6/6 | Complete | 2026-03-10 |
| 32. Schema Drop & Rebuild | v4.1 | 0/0 | Not started | - |
| 33. Filesystem Reads | v4.1 | 0/0 | Not started | - |
