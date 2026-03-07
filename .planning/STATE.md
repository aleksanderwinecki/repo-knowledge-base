---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: Search Type Filtering
status: complete
stopped_at: "Phase 10 Plan 02 complete"
last_updated: "2026-03-07T12:32:07Z"
last_activity: 2026-03-07 -- Phase 10 Plan 02 complete (CLI & MCP type filtering interfaces)
progress:
  total_phases: 6
  completed_phases: 5
  total_plans: 11
  completed_plans: 11
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-06 after Phase 6)

**Core value:** Eliminate repeated cost of AI agents re-learning codebase architecture every session
**Current focus:** Phase 10 -- Search Type Filtering

## Current Position

Phase: 10 of 10 (Search Type Filtering)
Plan: 2 of 2 complete
Status: Complete
Last activity: 2026-03-07 -- Phase 10 Plan 02 complete (CLI & MCP type filtering interfaces)

Progress: [####################] 100%

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
| 8. New Extractors | 3 | 3 | Complete |
| Phase 08 P01 | 3min | 2 tasks | 2 files |
| Phase 08 P02 | 3min | 2 tasks | 4 files |
| Phase 08 P03 | 7min | 3 tasks | 5 files |
| 9. Parallel Execution | 2 | 2 | Complete |
| Phase 09 P01 | 6min | 3 tasks | 6 files |
| Phase 09 P02 | 3min | 1 tasks | 1 files |
| 10. Search Type Filtering | 2 | 2 | Complete |
| Phase 10 P01 | 9min | 2 tasks | 10 files |
| Phase 10 P02 | 4min | 2 tasks | 9 files |

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
- Phase 8-03: FTS description includes table_name for Ecto schema searchability (Pitfall 6 fix)
- Phase 8-03: Event Catalog multi-strategy matching: exact CamelCase, LIKE suffix, path-based for Payload events
- Phase 8-03: Domain derived by traversing domain->service->event chain in catalog MDX files
- Phase 8-03: Ecto association edges skip cross-repo targets not found in DB
- Phase 8-03: enrichFromEventCatalog wrapped in try/catch to prevent catalog failures from blocking indexing
- Phase 9-01: p-limit v7 for ESM-native concurrency control
- Phase 9-01: Three-phase pipeline: sequential DB prep, parallel extraction, serial persistence
- Phase 9-01: extractRepoData takes dbSnapshot instead of DB handle for thread safety
- Phase 9-01: indexSingleRepo unchanged for MCP sync backward compatibility
- [Phase 09]: Error isolation test uses directory-to-file replacement sabotage since pipeline is resilient to git corruption
- Phase 10-01: FTS entity_type stores parent:subtype composite format with UNINDEXED to prevent MATCH pollution
- Phase 10-01: COARSE_TYPES set distinguishes parent types from granular sub-types for resolveTypeFilter
- Phase 10-01: removeEntity uses LIKE pattern for safe composite matching across sub-types
- Phase 10-01: Sub-type to parent mapping uses known sets (MODULE_SUB_TYPES, SERVICE_SUB_TYPES) with fallback
- Phase 10-02: Import listAvailableTypes directly from db/fts.js in CLI (shorter path for CLI-only use)
- Phase 10-02: outputError with MISSING_QUERY code when no query and no --list-types (explicit error vs silent help)

### Roadmap Evolution

- Phase 10 added: Search Type Filtering

### Pending Todos

None.

### Blockers/Concerns

- Cross-repo edge stability model needs design decision during Phase 7 planning (3 approaches identified in research)
- ~~EventCatalog frontmatter fields may vary between v2/v3~~ -- RESOLVED: validated against actual catalog repo (v2.60.0), implemented multi-strategy matching

## Session Continuity

Last session: 2026-03-07T12:32:07Z
Stopped at: Completed 10-02-PLAN.md (Phase 10 complete)
Resume file: None -- all plans complete
