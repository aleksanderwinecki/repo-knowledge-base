# Roadmap: Repo Knowledge Base

## Milestones

- v1.0 MVP -- Phases 1-5 (shipped 2026-03-06)
- v1.1 Improved Reindexing -- Phases 6-10 (shipped 2026-03-07)
- v1.2 Hardening & Quick Wins -- Phases 11-15 (shipped 2026-03-07)
- v2.0 Design-Time Intelligence -- Phases 16-20 (shipped 2026-03-09)
- v2.1 Cleanup & Tightening -- Phases 21-22 (shipped 2026-03-09)
- v3.0 Graph Intelligence -- Phases 23-26 (shipped 2026-03-10)
- v3.1 Indexing UX -- Phases 27-28 (shipped 2026-03-10)
- v4.0 Data Contract Intelligence -- Phases 29-31

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

### v4.0 Data Contract Intelligence (Phases 29-31)

- [x] **Phase 29: Field Extraction & Schema** - Schema migration + extract fields from Ecto/proto/GraphQL with nullability metadata (completed 2026-03-10)
- [ ] **Phase 30: Field Search & Shared Concepts** - FTS indexing of fields, type filtering, shared concept detection across repos
- [ ] **Phase 31: Field Edges & Field Impact** - Cross-service field edges, BFS integration, kb_field_impact MCP tool and CLI command

## Phase Details

### Phase 29: Field Extraction & Schema
**Goal**: Every Ecto schema field, proto message field, and GraphQL type field is individually extracted and stored with nullability metadata during indexing
**Depends on**: Phase 28 (v3.1 complete)
**Requirements**: FLD-01, FLD-02, FLD-03, FLD-04, NULL-01, NULL-02
**Success Criteria** (what must be TRUE):
  1. Running `kb index` on a repo with Ecto schemas stores each `field/3` call as a separate row in the `fields` table with correct parent module, field name, field type, and repo
  2. Running `kb index` on a repo with `.proto` files stores each proto message field as a separate row in the `fields` table with correct parent message, field name, field type, and repo
  3. Running `kb index` on a repo with GraphQL type definitions stores each GraphQL field as a separate row in the `fields` table with correct parent type, field name, field type, and repo
  4. Ecto fields referenced in `validate_required` are stored with `nullable=false`; other cast fields are stored with `nullable=true`
  5. Proto fields with `optional` keyword are stored with `nullable=true`; plain proto3 fields are stored with `nullable=false`
**Plans:** 2/2 plans complete
Plans:
- [x] 29-01-PLAN.md -- V8 migration, FieldData contract, extractor enhancements (Elixir/proto/GraphQL)
- [x] 29-02-PLAN.md -- Pipeline field mapping + writer persistence for both full and surgical paths

### Phase 30: Field Search & Shared Concepts
**Goal**: Users can search for any field name across the entire indexed codebase and discover which field names are shared data contracts across multiple repos
**Depends on**: Phase 29
**Requirements**: FSRCH-01, FSRCH-02, FSRCH-03, SHARED-01, SHARED-02
**Success Criteria** (what must be TRUE):
  1. `kb_search "employee_id"` returns every Ecto schema, proto message, and GraphQL type containing a field named `employee_id` across all indexed repos
  2. `kb_search "employee_id"` matches both exact compound names and individual tokens (searching "employee" also surfaces `employee_id` fields)
  3. `kb_search --type field` (CLI) and `kb_search` with `type: "field"` (MCP) filters results to field entities only
  4. After indexing, field names appearing in 2+ repos are identified as shared concepts with cross-repo occurrence counts
  5. `kb_entity "employee_id" --type field` shows all repos, parent schemas/protos/types, field types, and nullability for that field name
**Plans:** 2 plans
Plans:
- [ ] 30-01-PLAN.md -- FTS field indexing, type plumbing, hydrator, cleanup (FSRCH-01/02/03)
- [ ] 30-02-PLAN.md -- Field entity cards with shared concept detection (SHARED-01/02)

### Phase 31: Field Edges & Field Impact
**Goal**: Users can trace a field name from its origin schemas through proto/event boundaries to all consuming services, seeing nullability at each hop
**Depends on**: Phase 29, Phase 30
**Requirements**: FEDGE-01, FEDGE-02, FIMPACT-01, FIMPACT-02, FIMPACT-03
**Success Criteria** (what must be TRUE):
  1. When an Ecto schema field name matches a proto message field name within the same repo, a `maps_to` edge is created between them during indexing
  2. Field-level edges are traversable by the existing BFS machinery in graph.ts (bfsDownstream/bfsUpstream work with field edges)
  3. `kb_field_impact "employee_id"` shows: origin repos with parent schemas, proto boundaries with Kafka topics, consuming repos with their local field info, and nullability at each hop
  4. `kb_field_impact` is available as both MCP tool and CLI command (`kb field-impact "employee_id"`)
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
| 29 | v4.0 | 2/2 | Complete | 2026-03-10 |
| 30 | v4.0 | 0/2 | Not started | - |
| 31 | v4.0 | 0/TBD | Not started | - |
