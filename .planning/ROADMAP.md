# Roadmap: Repo Knowledge Base

## Milestones

- v1.0 MVP -- Phases 1-5 (shipped 2026-03-06)
- v1.1 Improved Reindexing -- Phases 6-9 (in progress)

## Phases

<details>
<summary>v1.0 MVP (Phases 1-5) -- SHIPPED 2026-03-06</summary>

- [x] Phase 1: Storage Foundation (1/1 plans) -- completed 2026-03-05
- [x] Phase 2: Indexing Pipeline (2/2 plans) -- completed 2026-03-05
- [x] Phase 3: Search (1/1 plans) -- completed 2026-03-05
- [x] Phase 4: CLI + MCP + Knowledge (2/2 plans) -- completed 2026-03-05
- [x] Phase 5: MCP Server (2/2 plans) -- completed 2026-03-06

</details>

### v1.1 Improved Reindexing (In Progress)

**Milestone Goal:** Faster, smarter indexing with branch-aware tracking, surgical file-level updates, parallel execution, and new extractors for GraphQL, gRPC, Ecto, and Event Catalog.

- [ ] **Phase 6: Branch-Aware Tracking & Schema Migration** - Index from default branch regardless of local checkout; migrate schema for new extractors
- [ ] **Phase 7: Surgical File-Level Indexing** - Re-index only changed files instead of wiping and rewriting entire repos
- [ ] **Phase 8: New Extractors** - Extract GraphQL, gRPC, Ecto, and Event Catalog data into the knowledge base
- [ ] **Phase 9: Parallel Execution** - Index multiple repos concurrently for faster full and incremental re-indexing

## Phase Details

### Phase 6: Branch-Aware Tracking & Schema Migration
**Goal**: Repos are always indexed from main/master branch regardless of local checkout state, and the database schema supports all v1.1 extractors
**Depends on**: Phase 5 (v1.0 complete)
**Requirements**: IDX2-01, IDX2-05
**Success Criteria** (what must be TRUE):
  1. Running `kb index` while a repo is checked out on a feature branch still indexes from main/master content
  2. Running `kb index` on a repo in detached HEAD state does not crash -- it resolves the default branch and indexes normally
  3. The database schema has been migrated to v3 with columns/tables needed by all v1.1 extractors, and existing v2 data is preserved
**Plans:** 2 plans
Plans:
- [ ] 06-01-PLAN.md -- Schema v3 migration and branch-aware git utility functions
- [ ] 06-02-PLAN.md -- Pipeline and extractor refactor for branch-aware indexing

### Phase 7: Surgical File-Level Indexing
**Goal**: Incremental re-indexing processes only files that changed since last indexed commit, dramatically reducing re-index time for repos with small changes
**Depends on**: Phase 6 (branch tracking provides accurate commit SHAs for diffing)
**Requirements**: IDX2-02, IDX2-03
**Success Criteria** (what must be TRUE):
  1. When a single file changes in a repo, `kb index` only re-extracts entities from that file -- not the entire repo
  2. When a file is deleted from a repo, `kb index` removes all entities and FTS entries that originated from that file
  3. A full wipe-and-rewrite still works via `kb index --force` as a recovery path
  4. After surgical re-indexing, search results are identical to what a full `--force` re-index would produce (no orphaned or stale entries)
**Plans:** 2 plans
Plans:
- [ ] 07-01-PLAN.md -- Schema v4 migration (file_id on events) and surgical writer functions
- [ ] 07-02-PLAN.md -- Pipeline refactoring for surgical vs full mode branching

### Phase 8: New Extractors
**Goal**: The knowledge base captures GraphQL schemas, gRPC service definitions, Ecto database structures, and Event Catalog domain metadata from indexed repos
**Depends on**: Phase 7 (extractors must follow source_file convention and changedFiles filter pattern)
**Requirements**: EXT-01, EXT-02, EXT-03, EXT-04, EXT-05, EXT-06
**Success Criteria** (what must be TRUE):
  1. `kb search "MyService"` returns gRPC service definitions from `.proto` files, including RPC methods and client call edges between services
  2. `kb search "users"` returns Ecto schema fields, associations (belongs_to, has_many), and table names extracted from `.ex` files
  3. `kb search "CreateBooking"` returns GraphQL mutations/queries/types from both `.graphql` SDL files and Absinthe macro definitions in `.ex` files
  4. `kb search "BookingCreated"` returns Event Catalog metadata (descriptions, team ownership, domain assignments) merged with existing proto-extracted event data
  5. All new extractor data survives surgical re-indexing -- entities have correct `source_file` values and are properly scoped to file-level updates
**Plans:** 3 plans
Plans:
- [x] 08-01-PLAN.md -- Elixir extractor extensions (Ecto fields/associations, Absinthe macros, gRPC stubs)
- [x] 08-02-PLAN.md -- GraphQL SDL extractor and gRPC service persistence infrastructure
- [x] 08-03-PLAN.md -- Pipeline wiring for all new extractors and Event Catalog enrichment

### Phase 9: Parallel Execution
**Goal**: Full and incremental re-indexing runs repos concurrently, reducing wall-clock time by 2-4x while maintaining data consistency
**Depends on**: Phase 8 (all extractors finalized, pipeline stable)
**Requirements**: IDX2-04
**Success Criteria** (what must be TRUE):
  1. `kb index` processes multiple repos concurrently (observable via faster completion time or progress output)
  2. Concurrency is configurable (e.g., environment variable or flag) with a sensible default
  3. After parallel indexing completes, the database is consistent -- identical results to sequential indexing (no write lock corruption, no missing entities)
**Plans:** 2 plans
Plans:
- [x] 09-01-PLAN.md -- Pipeline refactor: extract-parallel + persist-serial with p-limit
- [ ] 09-02-PLAN.md -- Parallel indexing test suite (consistency, error isolation, config)

## Progress

**Execution Order:** Phases execute in numeric order: 6 -> 7 -> 8 -> 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Storage Foundation | v1.0 | 1/1 | Complete | 2026-03-05 |
| 2. Indexing Pipeline | v1.0 | 2/2 | Complete | 2026-03-05 |
| 3. Search | v1.0 | 1/1 | Complete | 2026-03-05 |
| 4. CLI + Knowledge | v1.0 | 2/2 | Complete | 2026-03-05 |
| 5. MCP Server | v1.0 | 2/2 | Complete | 2026-03-06 |
| 6. Branch-Aware Tracking & Schema Migration | v1.1 | 2/2 | Complete | 2026-03-06 |
| 7. Surgical File-Level Indexing | v1.1 | 2/2 | Complete | 2026-03-06 |
| 8. New Extractors | v1.1 | 3/3 | Complete | 2026-03-06 |
| 9. Parallel Execution | v1.1 | 1/2 | In Progress | - |
