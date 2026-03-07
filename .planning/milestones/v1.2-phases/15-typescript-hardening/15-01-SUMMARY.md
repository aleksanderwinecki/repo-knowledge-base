---
phase: 15-typescript-hardening
plan: 01
subsystem: typescript
tags: [noUncheckedIndexedAccess, strict-types, compiler-safety, indexer]

# Dependency graph
requires:
  - phase: 14-core-dedup
    provides: "Stable indexer layer with hoisted statements and shared extraction pipeline"
provides:
  - "Compile-time safety for all array[i] and record[key] access in src/indexer/"
  - "noUncheckedIndexedAccess enabled in tsconfig.json"
affects: [15-typescript-hardening]

# Tech tracking
tech-stack:
  added: []
  patterns: ["guard-and-continue for regex match groups in while loops", "non-null assertion for structurally guaranteed parallel array access", "?? fallback for record indexing in .map() callbacks"]

key-files:
  created: []
  modified:
    - tsconfig.json
    - src/indexer/elixir.ts
    - src/indexer/pipeline.ts
    - src/indexer/proto.ts
    - src/indexer/events.ts
    - src/indexer/graphql.ts
    - src/indexer/catalog.ts

key-decisions:
  - "Prefer guard-and-continue over non-null assertions for regex match groups in while loops (better for readability and type narrowing)"
  - "Use non-null assertions (!) for structurally guaranteed parallel array indexing in pipeline.ts"
  - "Use ?? fallback for record indexing in .map() callbacks where continue is unavailable"

patterns-established:
  - "Guard-and-continue: extract match[N] to const, guard with if (!val) continue, use narrowed val"
  - "Parallel array assertion: workItems[i]! and settled[i]! inside for loops bounded by array length"
  - "Nullish coalescing for ternary record access: idMatch ? idMatch[1] ?? fallback : fallback"

requirements-completed: [TS-01]

# Metrics
duration: 3min
completed: 2026-03-07
---

# Phase 15 Plan 01: noUncheckedIndexedAccess Summary

**Enabled noUncheckedIndexedAccess in tsconfig.json, fixed all 60 compiler errors across 6 indexer files with guard-and-continue patterns and non-null assertions**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-07T18:37:05Z
- **Completed:** 2026-03-07T18:40:28Z
- **Tasks:** 1
- **Files modified:** 7

## Accomplishments
- Enabled `noUncheckedIndexedAccess: true` in tsconfig.json for compile-time undefined access safety
- Fixed all 60 compiler errors across elixir.ts (18), pipeline.ts (15), proto.ts (9), events.ts (8), graphql.ts (5), catalog.ts (5)
- Zero runtime behavior changes -- purely type-level guards and assertions
- All 435 tests pass, clean compilation with the stricter flag

## Task Commits

Each task was committed atomically:

1. **Task 1: Enable noUncheckedIndexedAccess and fix all 60 compiler errors** - `d48db56` (feat)

## Files Created/Modified
- `tsconfig.json` - Added noUncheckedIndexedAccess: true to compilerOptions
- `src/indexer/elixir.ts` - Guard-and-continue for regex matches, ! for array-by-index, ?? for extractSchemaTable
- `src/indexer/pipeline.ts` - Non-null assertions for parallel array indexing (workItems[i]!, settled[i]!)
- `src/indexer/proto.ts` - Non-null assertions for regex match groups in extractMessages, extractFields, extractServices, extractRpcs
- `src/indexer/events.ts` - Guard-and-continue for all 4 consumer detection regex patterns, ?? for moduleMatch
- `src/indexer/graphql.ts` - Non-null assertions for regex match groups in braceRe, unionRe, scalarRe loops
- `src/indexer/catalog.ts` - Non-null assertions for parseFrontmatter internals, ?? fallbacks for .map() callbacks

## Decisions Made
- Preferred guard-and-continue for regex match groups in while loops (events.ts patterns 1-4, elixir.ts defmodule/def loops) -- better readability and type narrowing
- Used non-null assertions (!) for structurally guaranteed access: parallel arrays in pipeline.ts, regex groups in proto.ts/graphql.ts inner loops where continue is already handled
- Used ?? fallbacks for catalog.ts .map() callbacks where continue is unavailable (idMatch[1] ?? s)
- Used ?. for optional chaining on moduledoc extractions (heredocMatch[1]?.trim(), singleMatch[1]?.trim())

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- noUncheckedIndexedAccess is now enforced project-wide
- Ready for remaining TypeScript hardening plans (TS-02 dead code, TS-03 dependency symmetry, TS-04 catch blocks)

---
*Phase: 15-typescript-hardening*
*Completed: 2026-03-07*
