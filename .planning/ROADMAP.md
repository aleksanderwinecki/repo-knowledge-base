# Roadmap: Repo Knowledge Base

## Milestones

- v1.0 MVP -- Phases 1-5 (shipped 2026-03-06)
- v1.1 Improved Reindexing -- Phases 6-10 (shipped 2026-03-07)
- v1.2 Hardening & Quick Wins -- Phases 11-15 (shipped 2026-03-07)
- v2.0 Design-Time Intelligence -- Phases 16-20 (shipped 2026-03-09)
- v2.1 Cleanup & Tightening -- Phases 21-22 (shipped 2026-03-09)
- v3.0 Graph Intelligence -- Phases 23-26 (in progress)

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

### v3.0 Graph Intelligence (Phases 23-26)

- [x] **Phase 23: Graph Infrastructure** - Shared edge utilities and in-memory graph module with BFS primitives (completed 2026-03-09)
- [x] **Phase 24: Blast Radius** - kb_impact MCP tool and CLI for downstream impact analysis (completed 2026-03-09)
- [ ] **Phase 25: Flow Tracing** - kb_trace MCP tool and CLI for shortest-path queries between services
- [ ] **Phase 26: Service Explanation** - kb_explain MCP tool and CLI for structured service summary cards

## Phase Details

### Phase 23: Graph Infrastructure
**Goal**: Agents and tools have a shared graph module that builds in-memory adjacency lists from topology edges and provides BFS traversal primitives
**Depends on**: Phase 22 (existing topology edges in DB)
**Requirements**: GRAPH-01, GRAPH-02, GRAPH-03, GRAPH-04, GRAPH-05
**Success Criteria** (what must be TRUE):
  1. Graph module builds forward and reverse adjacency lists from a single bulk SQL query, completing in under 10ms for 12K edges
  2. BFS downstream traversal returns all reachable services with correct depth tracking, including through Kafka/event intermediate nodes
  3. Shortest path query returns ordered hop list between any two connected services
  4. Event/Kafka two-hop paths (repo->event->repo) are collapsed to single logical edges transparently
  5. Shared edge utilities (confidence, mechanism formatting, metadata parsing) are importable from a dedicated module without touching dependencies.ts
**Plans**: 2 plans

Plans:
- [ ] 23-01-PLAN.md -- Extract shared edge utilities into edge-utils.ts
- [ ] 23-02-PLAN.md -- In-memory graph module with BFS traversal primitives (TDD)

### Phase 24: Blast Radius
**Goal**: Agents can instantly answer "what breaks if I change service X?" via MCP or CLI
**Depends on**: Phase 23
**Requirements**: IMPACT-01, IMPACT-02, IMPACT-03, IMPACT-04, IMPACT-05, IMPACT-06, IMPACT-07
**Success Criteria** (what must be TRUE):
  1. Agent can run `kb_impact <service>` (MCP) or `kb impact <service>` (CLI) and get a depth-grouped list of affected services with mechanism labels and confidence
  2. Results can be filtered by mechanism (grpc, http, kafka, event, gateway) and capped by depth (default 3)
  3. Each affected service is classified as direct, indirect, or transitive with an aggregated stats block including blast radius score
  4. Response for hub nodes (300+ affected services) fits within the 4KB MCP response cap using compact formatting
**Plans**: 3 plans

Plans:
- [ ] 24-01-PLAN.md -- bfsUpstream traversal primitive with mechanism filtering (TDD)
- [ ] 24-02-PLAN.md -- Impact analysis module with tier classification, stats, and compact formatter (TDD)
- [ ] 24-03-PLAN.md -- MCP tool and CLI command registration with tests

### Phase 25: Flow Tracing
**Goal**: Agents can trace the path a request takes between any two services
**Depends on**: Phase 23
**Requirements**: TRACE-01, TRACE-02, TRACE-03, TRACE-04
**Success Criteria** (what must be TRUE):
  1. Agent can run `kb_trace <from> <to>` (MCP) or `kb trace <from> <to>` (CLI) and get the shortest path between two services
  2. Response includes ordered hop list with mechanism per hop and a human-readable path_summary string
  3. "Service not found" and "no path exists" produce distinct, clear error responses
  4. Each hop is annotated with confidence level and the response includes min-path confidence (weakest link)
**Plans**: 2 plans

Plans:
- [ ] 25-01-PLAN.md -- Core trace module with traceRoute function, formatting, and validation (TDD)
- [ ] 25-02-PLAN.md -- MCP tool and CLI command wiring with integration and contract tests

### Phase 26: Service Explanation
**Goal**: Agents can get a structured overview card for any service, replacing manual exploration
**Depends on**: Phase 22 (no graph module dependency -- pure SQL aggregation)
**Requirements**: EXPLAIN-01, EXPLAIN-02, EXPLAIN-03, EXPLAIN-04, EXPLAIN-05
**Success Criteria** (what must be TRUE):
  1. Agent can run `kb_explain <service>` (MCP) or `kb explain <service>` (CLI) and get a structured service card
  2. Card includes identity, description, inbound/outbound connections grouped by mechanism, events produced/consumed, and entity counts
  3. Card includes "talks to" / "called by" summaries and top modules by type
  4. Card includes actionable next-step hints for agents (e.g., "Run kb_impact app-payments to see blast radius")
**Plans**: TBD

Plans:
- [ ] 26-01: TBD

## Progress

| Phase | Milestone | Plans | Status | Completed |
|-------|-----------|-------|--------|-----------|
| 1-5 | v1.0 | 9/9 | Complete | 2026-03-06 |
| 6-10 | v1.1 | 11/11 | Complete | 2026-03-07 |
| 11-15 | v1.2 | 12/12 | Complete | 2026-03-07 |
| 16-20 | v2.0 | 11/11 | Complete | 2026-03-09 |
| 21-22 | v2.1 | 4/4 | Complete | 2026-03-09 |
| 23. Graph Infrastructure | 2/2 | Complete    | 2026-03-09 | - |
| 24. Blast Radius | 3/3 | Complete    | 2026-03-09 | - |
| 25. Flow Tracing | v3.0 | 0/2 | Not started | - |
| 26. Service Explanation | v3.0 | 0/? | Not started | - |
