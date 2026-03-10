---
phase: 33-filesystem-reads
plan: 01
subsystem: indexer
tags: [filesystem, fs, performance, extractors, git]

requires:
  - phase: 32-schema-drop-rebuild
    provides: drop+rebuild schema management (clean slate for refactored indexer)
provides:
  - listWorkingTreeFiles and readWorkingTreeFile filesystem functions in git.ts
  - All 10 extractors refactored to use fs reads instead of git child processes
  - Branch parameter removed from all extractor signatures
affects: [33-02 pipeline-wiring, indexer, pipeline]

tech-stack:
  added: []
  patterns: [filesystem-based file I/O replacing git child process spawning]

key-files:
  created: []
  modified:
    - src/indexer/git.ts
    - src/indexer/elixir.ts
    - src/indexer/proto.ts
    - src/indexer/graphql.ts
    - src/indexer/events.ts
    - src/indexer/metadata.ts
    - src/indexer/topology/index.ts
    - src/indexer/topology/grpc-clients.ts
    - src/indexer/topology/http-clients.ts
    - src/indexer/topology/gateway.ts
    - src/indexer/topology/kafka.ts

key-decisions:
  - "Manual recursive directory walk with stack (not Node recursive readdirSync) for cross-platform reliability"
  - "readWorkingTreeFile checks fs.statSync before reading to enforce 500KB cap without loading large files"
  - "metadata.ts defaultBranch field kept in interface but always set to null to avoid cascading interface changes"
  - "Branch-aware *FromBranch private functions in metadata.ts deleted entirely — filesystem functions already existed"

patterns-established:
  - "listWorkingTreeFiles/readWorkingTreeFile as the standard file I/O pattern for all extractors"

requirements-completed: [FS-01, FS-02, FS-03]

duration: 2min
completed: 2026-03-10
---

# Phase 33 Plan 01: Filesystem Reads Summary

**Replaced git child process file I/O with direct fs reads across all 10 extractors, eliminating thousands of execSync calls per indexing run**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T16:00:42Z
- **Completed:** 2026-03-10T16:03:34Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Added `listWorkingTreeFiles` (recursive dir walk, skipping .git/node_modules/etc) and `readWorkingTreeFile` (500KB cap, null on error) to git.ts
- Refactored all 10 extractor files to import and use the new fs-based functions
- Removed `branch` parameter from every extractor function signature
- Deleted 95 lines of branch-aware code paths and helper functions from metadata.ts

## Task Commits

Each task was committed atomically:

1. **Task 1: Add filesystem file I/O functions to git.ts** - `2ce1d97` (feat)
2. **Task 2: Refactor all extractors to use filesystem reads** - `79e782c` (feat)

**Plan metadata:** TBD (docs: complete plan)

## Files Created/Modified
- `src/indexer/git.ts` - Added listWorkingTreeFiles and readWorkingTreeFile exports
- `src/indexer/elixir.ts` - Switched to fs reads, removed branch param
- `src/indexer/proto.ts` - Switched to fs reads, removed branch param
- `src/indexer/graphql.ts` - Switched to fs reads, removed branch param
- `src/indexer/events.ts` - Switched to fs reads, removed branch param from both public and private functions
- `src/indexer/metadata.ts` - Switched to fs reads, removed branch param, deleted *FromBranch helpers
- `src/indexer/topology/index.ts` - Removed branch param, updated all 4 sub-extractor calls
- `src/indexer/topology/grpc-clients.ts` - Switched to fs reads, removed branch param
- `src/indexer/topology/http-clients.ts` - Switched to fs reads, removed branch param
- `src/indexer/topology/gateway.ts` - Switched to fs reads, removed branch param
- `src/indexer/topology/kafka.ts` - Switched to fs reads, removed branch param

## Decisions Made
- Used manual stack-based directory walk rather than Node's `recursive: true` option for `readdirSync` — more explicit control over skip directories and better cross-version compatibility
- Kept `defaultBranch` field in `RepoMetadata` interface (always null) to avoid cascading type changes across the codebase — the field isn't used downstream for extraction logic
- Deleted the entire branch-aware code path in metadata.ts since the filesystem variants already existed and were the correct implementation

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All extractors use filesystem reads; pipeline.ts still passes branch args (expected — plan 33-02 wires everything up)
- TypeScript errors in pipeline.ts are expected and will be fixed by plan 33-02
- Test files still mock old functions — also handled by plan 33-02

## Self-Check: PASSED

All 11 modified files verified present. Both task commits (2ce1d97, 79e782c) verified in git log.

---
*Phase: 33-filesystem-reads*
*Completed: 2026-03-10*
