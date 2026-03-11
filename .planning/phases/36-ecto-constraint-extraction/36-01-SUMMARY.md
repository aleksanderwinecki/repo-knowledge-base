---
phase: 36-ecto-constraint-extraction
plan: 01
subsystem: indexer
tags: [elixir, ecto, regex, nullability, field-extraction]

# Dependency graph
requires:
  - phase: 35-fts-description-enrichment
    provides: FTS and field pipeline infrastructure
provides:
  - resolveModuleAttributes for ~w(...)a and [:atom] Elixir attribute forms
  - extractCastFields for cast/4 field extraction with attribute resolution
  - Attribute-aware extractRequiredFields resolving @attr in validate_required
  - ElixirModule.optionalFields and ElixirModule.castFields arrays
  - Set-based pipeline nullability using enriched requiredFields
affects: [field-impact, reindex, elixir-extraction]

# Tech tracking
tech-stack:
  added: []
  patterns: [two-pass-attribute-resolution, set-based-nullability]

key-files:
  created: []
  modified:
    - src/indexer/elixir.ts
    - src/indexer/pipeline.ts
    - tests/indexer/fields.test.ts
    - tests/indexer/elixir.test.ts
    - tests/search/field-impact.test.ts

key-decisions:
  - "Generic attribute resolution over hardcoded names -- semantic usage (validate_required vs cast) determines required/optional, not attribute name"
  - "Set-based lookup in pipeline for O(1) required field checks"
  - "optionalFields computed as cast-only fields (in cast but not in required) rather than separate extraction"

patterns-established:
  - "Two-pass extraction: resolve module attributes first, then resolve @attr references in function calls"
  - "Cast-only fields are optional by definition (permitted but not required)"

requirements-completed: [FEXT-01, FEXT-02, FEXT-03]

# Metrics
duration: 4min
completed: 2026-03-11
---

# Phase 36 Plan 01: Ecto Constraint Extraction Summary

**Two-pass module attribute resolution for Ecto ~w(...)a and [:atom] forms, cast/4 extraction, and Set-based pipeline nullability**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-11T14:09:08Z
- **Completed:** 2026-03-11T14:13:00Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- resolveModuleAttributes handles both ~w(...)a sigil and [:atom, :list] forms generically (not hardcoded names)
- extractRequiredFields now resolves @attr references in validate_required calls (fixing the documented gap)
- extractCastFields handles inline lists, single @attr references, and @required ++ @optional concatenation
- Pipeline nullability converted from .includes() to Set.has() consuming enriched requiredFields
- ElixirModule extended with optionalFields (cast-only) and castFields arrays
- 856 tests pass (31 new), zero regressions, clean TypeScript build

## Task Commits

Each task was committed atomically:

1. **Task 1: Module attribute resolution and cast extraction** (TDD)
   - `1913912` test: add failing tests for module attribute resolution and cast extraction
   - `724a4bf` feat: implement module attribute resolution, cast extraction, and attribute-aware required fields

2. **Task 2: Pipeline nullability from combined signals** (TDD)
   - `f0f38bf` test: add pipeline nullability and field-impact end-to-end tests
   - `f0c8b27` feat: convert pipeline nullability to Set-based lookup

## Files Created/Modified
- `src/indexer/elixir.ts` - Added resolveModuleAttributes, extractCastFields, updated extractRequiredFields with optional attrs param, extended ElixirModule interface
- `src/indexer/pipeline.ts` - Converted ectoFields nullable from .includes() to Set.has()
- `tests/indexer/fields.test.ts` - 22 new tests: module attribute resolution, cast extraction, attribute-aware required fields, combined nullability
- `tests/indexer/elixir.test.ts` - 5 new tests: parseElixirFile integration for optionalFields and castFields
- `tests/search/field-impact.test.ts` - 2 new tests: end-to-end field-impact with attribute-resolved nullability

## Decisions Made
- Generic attribute resolution by usage not name -- an attribute named @fields used in validate_required means required, regardless of the name containing "required" or not
- Set-based lookup in pipeline for O(1) performance (was linear .includes())
- optionalFields derived as cast-minus-required rather than requiring separate @optional_fields extraction -- simpler and works for all patterns

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Ecto constraint extraction is complete
- All existing and new tests green
- Ready for next milestone or phase

## Self-Check: PASSED

All 5 files verified on disk. All 4 commit hashes verified in git log.

---
*Phase: 36-ecto-constraint-extraction*
*Completed: 2026-03-11*
