---
phase: 21-embedding-removal
plan: 01
subsystem: database, search, cli, mcp
tags: [sqlite-vec, embeddings, fts5, dead-code-removal]

# Dependency graph
requires: []
provides:
  - Clean codebase with no vector/embedding references in any src/ file
  - FTS5-only search path (sync) through CLI and MCP
  - Schema version 7 (no vec0 virtual table)
affects: [21-02 (test cleanup and doc updates)]

# Tech tracking
tech-stack:
  added: []
  removed: [sqlite-vec, "@huggingface/transformers"]
  patterns: [sync-only search via FTS5 searchText]

key-files:
  created: []
  modified:
    - src/db/database.ts
    - src/db/schema.ts
    - src/db/migrations.ts
    - src/indexer/pipeline.ts
    - src/indexer/writer.ts
    - src/search/index.ts
    - src/cli/commands/search.ts
    - src/cli/commands/index-cmd.ts
    - src/mcp/server.ts
    - src/mcp/sync.ts
    - package.json
  deleted:
    - src/embeddings/generate.ts
    - src/embeddings/pipeline.ts
    - src/embeddings/text.ts
    - src/db/vec.ts
    - src/search/semantic.ts
    - src/search/hybrid.ts
    - src/mcp/tools/semantic.ts

key-decisions:
  - "SCHEMA_VERSION decremented from 8 to 7 (V8 migration removed entirely)"
  - "CLI search action changed from async to sync (no async search paths remain)"

patterns-established:
  - "Search is FTS5-only: all search paths use sync searchText, no async search functions"

requirements-completed: [CLEAN-01, CLEAN-02, CLEAN-03, CLEAN-04, CLEAN-05]

# Metrics
duration: 4min
completed: 2026-03-09
---

# Phase 21 Plan 01: Embedding Removal Summary

**Removed all embedding infrastructure: src/embeddings/, sqlite-vec, V8 migration, semantic/hybrid search, CLI --semantic/--embed flags, MCP semantic tool, and 2 npm packages**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-09T10:11:37Z
- **Completed:** 2026-03-09T10:15:08Z
- **Tasks:** 2
- **Files modified:** 19

## Accomplishments
- Deleted entire src/embeddings/ directory, src/db/vec.ts, src/search/semantic.ts, src/search/hybrid.ts, src/mcp/tools/semantic.ts (7 files)
- Cleaned all embedding references from database.ts, schema.ts, migrations.ts, pipeline.ts, writer.ts, search barrel, CLI commands, MCP server, sync module
- Uninstalled sqlite-vec and @huggingface/transformers (removed 50 packages)
- TypeScript build compiles cleanly with no broken imports

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete embedding sources, vec module, clean DB and indexer layers** - `b05d4dc` (feat)
2. **Task 2: Remove search/CLI/MCP embedding code, uninstall packages, verify build** - `6834ac1` (feat)

## Files Created/Modified
- `src/db/database.ts` - Removed vec extension loading
- `src/db/schema.ts` - SCHEMA_VERSION 8 -> 7
- `src/db/migrations.ts` - Removed V8 migration and vec import
- `src/indexer/pipeline.ts` - Removed embed option, embeddings stat, Phase 4 embedding generation
- `src/indexer/writer.ts` - Removed clearRepoEmbeddings function and vec import
- `src/search/index.ts` - Removed semantic/hybrid exports
- `src/cli/commands/search.ts` - Rewrote to use sync FTS5 searchText, removed --semantic
- `src/cli/commands/index-cmd.ts` - Removed --embed flag
- `src/mcp/server.ts` - Removed semantic tool registration
- `src/mcp/sync.ts` - Removed withAutoSyncAsync function
- `package.json` / `package-lock.json` - Uninstalled sqlite-vec, @huggingface/transformers

## Decisions Made
- SCHEMA_VERSION decremented from 8 to 7 -- the V8 migration (vec0 virtual table) is removed entirely, so new databases skip it
- CLI search action changed from async to sync -- all remaining search paths (FTS5 text, entity) are synchronous

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Source tree is clean of all embedding/vector references
- Plan 02 (test cleanup and doc updates) can proceed to remove test files and update documentation

---
*Phase: 21-embedding-removal*
*Completed: 2026-03-09*

## Self-Check: PASSED
