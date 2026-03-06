---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Improved Reindexing
status: executing
stopped_at: Completed 08-02-PLAN.md
last_updated: "2026-03-06T15:46:06.920Z"
last_activity: 2026-03-06 -- Phase 8 Plan 02 complete (GraphQL extractor + service persistence)
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 7
  completed_plans: 6
  percent: 80
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-06 after Phase 6)

**Core value:** Eliminate repeated cost of AI agents re-learning codebase architecture every session
**Current focus:** Phase 8 -- New Extractors

## Current Position

Phase: 8 of 9 (New Extractors)
Plan: 2 of 3 complete
Status: In Progress
Last activity: 2026-03-06 -- Phase 8 Plan 02 complete (GraphQL extractor + service persistence)

Progress: [################----] 80% (8/9 phases in progress)

## Performance Metrics

**Velocity (v1.0):**
- Total plans completed: 8
- Total execution time: ~18 hours

**By Phase (v1.0):**

| Phase | Plans | Status |
|-------|-------|--------|
| 1. Storage Foundation | 1 | Complete |
| 2. Indexing Pipeline | 2 | Complete |
| 3. Search | 1 | Complete |
| 4. CLI + Knowledge | 2 | Complete |
| 5. MCP Server | 2 | Complete |

**By Phase (v1.1):**

| Phase | Plans | Completed | Status |
|-------|-------|-----------|--------|
| 6. Branch-Aware Tracking | 2 | 2 | Complete |
| 7. Surgical File-Level Indexing | 2 | 2 | Complete |
| 8. New Extractors | 3 | 2 | In Progress |
| Phase 08 P02 | 3min | 2 tasks | 4 files |
| Phase 08 P02 | 3min | 2 tasks | 4 files |

## Accumulated Context

### Decisions

See PROJECT.md Key Decisions table for full log.

Recent decisions affecting current work:
- v1.1: No worker_threads -- p-limit + Promise.all sufficient; SQLite can't share connections across threads
- v1.1: No AST parsing -- regex sufficient for well-structured Elixir/proto/GraphQL macros
- v1.1: EventCatalog via filesystem parsing, not HTTP API (SDK is file-based)
- Phase 6-01: Fixed runMigrations to respect toVersion parameter (was silently ignored)
- Phase 6-01: readBranchFile uses maxBuffer 500KB matching existing MAX_FILE_SIZE; listBranchFiles uses 10MB
- Phase 6-02: Extractors use shared LIB_PATH_PATTERNS regex for lib path matching via branch file lists
- Phase 6-02: indexSingleRepo auto-resolves branch when called directly for backward compat
- Phase 6-02: events.ts sourceFile uses branch-relative paths from listBranchFiles
- Phase 7-01: V1 CREATE TABLE keeps original schema; V4 ALTER TABLE adds file_id to events
- Phase 7-01: clearRepoFiles dual-path cleanup: file_id FK join primary, source_file text fallback for pre-v4 data
- Phase 7-01: persistSurgicalData clears ALL repo edges (caller re-inserts) rather than per-file edge tracking
- Phase 7-02: Extractors run on ALL branch files in both modes; surgical filtering only at persistence layer
- Phase 7-02: Surgical threshold <=200 changed files AND <=50% of repo; above triggers silent full fallback
- Phase 7-02: Edges always re-derived repo-wide after surgical persist for correctness
- [Phase 07]: Extractors run on ALL branch files in both modes; surgical filtering only at persistence layer
- Phase 8-01: Line-by-line schema block parsing with depth tracking instead of greedy regex for nested do...end safety
- Phase 8-01: gRPC stub deduplication via Set -- same stub ref'd multiple ways counts once
- Phase 8-01: Absinthe query/mutation root blocks (no atom name) use kind as name
- Phase 8-02: GraphQL types stored as body text (no field-level extraction per user decision)
- Phase 8-02: Services use ON CONFLICT upsert for idempotent persistence
- Phase 8-02: Surgical mode wipes ALL repo services and re-inserts (no file_id on services table)
- Phase 8-02: Service FTS includes description for RPC method searchability
- [Phase 08]: GraphQL types stored as body text (no field-level extraction per user decision)
- [Phase 08]: Surgical mode wipes ALL repo services and re-inserts (no file_id on services table)

### Pending Todos

None.

### Blockers/Concerns

- Cross-repo edge stability model needs design decision during Phase 7 planning (3 approaches identified in research)
- EventCatalog frontmatter fields may vary between v2/v3 -- validate against actual catalog repo during Phase 8

## Session Continuity

Last session: 2026-03-06T15:46:02.559Z
Stopped at: Completed 08-02-PLAN.md
Resume file: None
