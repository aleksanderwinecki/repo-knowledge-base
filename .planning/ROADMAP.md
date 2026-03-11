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
- v4.1 Indexing Performance -- Phases 32-33 (shipped 2026-03-11)
- v4.2 Search Quality -- Phases 34-36 (in progress)

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

<details>
<summary>v4.1 Indexing Performance (Phases 32-33) -- SHIPPED 2026-03-11</summary>

- [x] Phase 32: Schema Drop & Rebuild (1/1 plans) -- completed 2026-03-10
- [x] Phase 33: Filesystem Reads (2/2 plans) -- completed 2026-03-10

</details>

### v4.2 Search Quality (In Progress)

- [x] **Phase 34: Search Query Layer** - OR-default queries, progressive relaxation, and result enrichment for AI agent recall (completed 2026-03-11)
- [ ] **Phase 35: FTS Description Enrichment** - Richer FTS descriptions with repo name, proto context, and module semantics
- [ ] **Phase 36: Ecto Constraint Extraction** - Deeper Ecto field extraction from @required_fields, @optional_fields, and cast attrs

## Phase Details

### Phase 34: Search Query Layer
**Goal**: AI agent search queries return relevant results by defaulting to OR with BM25 ranking, falling back progressively when narrow queries underperform, and suggesting next-step actions per result
**Depends on**: Phase 33
**Requirements**: SRCH-01, SRCH-02, SRCH-03, ENRICH-01, ENRICH-02
**Success Criteria** (what must be TRUE):
  1. A multi-term `kb_search` query returns results containing ANY search term, ranked by BM25 relevance (not requiring ALL terms)
  2. When a strict AND query returns fewer than 3 results, the system automatically retries with broader matching and returns a larger result set
  3. Each search result includes a `nextAction` field suggesting the appropriate follow-up MCP tool (e.g., `kb_entity` for entities, `kb_field_impact` for fields)
  4. All existing search golden tests pass; new golden tests verify OR ranking order and relaxation behavior
**Plans**: 2 plans

Plans:
- [ ] 34-01-PLAN.md — OR-default queries with progressive relaxation (TDD)
- [ ] 34-02-PLAN.md — nextAction result enrichment

### Phase 35: FTS Description Enrichment
**Goal**: FTS indexed descriptions carry enough context for cross-repo disambiguation and proto field discoverability without polluting BM25 rankings
**Depends on**: Phase 34
**Requirements**: DESC-01, DESC-02, DESC-03
**Success Criteria** (what must be TRUE):
  1. Searching for a repo name returns modules and fields from that repo (because repo name is embedded in FTS descriptions)
  2. Searching for an event name returns proto fields associated with that event (because proto field descriptions include parent message and event context)
  3. Module FTS descriptions include repo context and structural semantics (table name, associations) without inlining field name lists that would collapse BM25 rank spread
**Plans**: 1 plan

Plans:
- [ ] 35-01-PLAN.md — FTS description enrichment with repo name, event context, and module semantics (TDD)

### Phase 36: Ecto Constraint Extraction
**Goal**: Ecto field nullability reflects the full picture from @required_fields, @optional_fields, and cast/2 attributes -- not just validate_required
**Depends on**: Phase 34
**Requirements**: FEXT-01, FEXT-02, FEXT-03
**Success Criteria** (what must be TRUE):
  1. An Ecto schema using `@required_fields ~w(name email)a` has those fields extracted with correct nullability (not nullable)
  2. An Ecto schema using `@optional_fields [:phone, :bio]` has those fields extracted as nullable
  3. Fields listed in `cast/2` calls are identified as permitted fields, contributing to the nullability determination alongside required/optional signals
  4. `kb_field_impact` results for Ecto fields reflect the combined required/optional/cast nullability signal (not just validate_required)
**Plans**: TBD

Plans:
- [ ] 36-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 34 -> 35 -> 36

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
| 32-33 | v4.1 | 3/3 | Complete | 2026-03-11 |
| 34. Search Query Layer | 2/2 | Complete    | 2026-03-11 | - |
| 35. FTS Description Enrichment | v4.2 | 0/1 | Not started | - |
| 36. Ecto Constraint Extraction | v4.2 | 0/? | Not started | - |
