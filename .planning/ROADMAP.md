# Roadmap: Repo Knowledge Base

## Milestones

- v1.0 MVP -- Phases 1-5 (shipped 2026-03-06)
- v1.1 Improved Reindexing -- Phases 6-10 (shipped 2026-03-07)
- v1.2 Hardening & Quick Wins -- Phases 11-15 (shipped 2026-03-07)
- v2.0 Design-Time Intelligence -- Phases 16-20 (shipped 2026-03-09)
- v2.1 Cleanup & Tightening -- Phases 21-22 (shipped 2026-03-09)
- v3.0 Graph Intelligence -- Phases 23-26 (shipped 2026-03-10)
- v3.1 Indexing UX -- Phases 27-28

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

### v3.1 Indexing UX

- [x] **Phase 27: Progress Reporting & Error Grouping** - Live counters and grouped error collection during indexing pipeline (completed 2026-03-10)
- [ ] **Phase 28: Output Control & Summary** - TTY/JSON output gating and compact final summary

## Phase Details

### Phase 27: Progress Reporting & Error Grouping
**Goal**: Users see live progress during the ~1hr full reindex and errors are collected/grouped instead of interleaved with output
**Depends on**: Phase 26
**Requirements**: PROG-01, PROG-02, PROG-03, ERR-01, ERR-02, ERR-03
**Success Criteria** (what must be TRUE):
  1. Running `kb index` on a TTY shows an in-place updating counter during git refresh (`Refreshing [42/412]...`) that overwrites the previous line
  2. Running `kb index` on a TTY shows an in-place updating counter during extraction with the current repo name (`Indexing [42/412] app-foo...`)
  3. When piped (non-TTY), progress lines are printed as plain newlines instead of `\r` overwrites
  4. Git refresh failures appear as a grouped summary at the end, categorized by failure type (worktree conflict, dirty tree, timeout, other), not interleaved with progress
  5. Repos with no main/master branch are reported as a single count with repo list, not individual "Skipping X" messages scattered through output
**Plans:** 2/2 plans complete
Plans:
- [x] 27-01-PLAN.md -- ProgressReporter and ErrorCollector classes with TDD
- [ ] 27-02-PLAN.md -- Wire progress/error classes into pipeline and CLI

### Phase 28: Output Control & Summary
**Goal**: Default `kb index` output is a compact human-readable summary instead of a JSON dump, with JSON available on demand
**Depends on**: Phase 27
**Requirements**: OUT-01, OUT-02, OUT-03, SUM-01, SUM-02, SUM-03
**Success Criteria** (what must be TRUE):
  1. Running `kb index` on a TTY prints a human-readable summary (not JSON) showing total repos, indexed count, skipped count, error count, and elapsed time
  2. Running `kb index --json` (or piping to another process) outputs the JSON results array
  3. Per-repo "Indexing X... done" lines are gone from default output -- progress counter is the only mid-run output (detail available via `--verbose` or `--json`)
  4. Errors are listed individually in the summary with repo name and error message
  5. The entire summary for a 400-repo run fits on a single terminal screen (compact, no bloat)
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
| 27. Progress & Errors | 2/2 | Complete    | 2026-03-10 | - |
| 28. Output & Summary | v3.1 | 0/TBD | Not started | - |
