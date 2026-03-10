---
phase: 28-output-control-summary
plan: 02
subsystem: cli
tags: [output-gating, tty-detection, json, cli, indexing]

# Dependency graph
requires:
  - phase: 28-output-control-summary
    plan: 01
    provides: printSummary function for compact human-readable summary
provides:
  - resolveOutputMode function for TTY/JSON output gating
  - --json and --verbose CLI flags on kb index command
  - Output gating: human summary on TTY, JSON on pipe or --json
affects: [cli index command, future --verbose per-repo detail]

# Tech tracking
tech-stack:
  added: []
  patterns: [TTY-based output gating, pure function for testable mode resolution]

key-files:
  created: [tests/cli/index-cmd.test.ts]
  modified: [src/cli/commands/index-cmd.ts]

key-decisions:
  - "Extract resolveOutputMode as exported pure function for testability"
  - "Error routing: stderr in JSON mode, printSummary handles in human mode"

patterns-established:
  - "Output gating: resolveOutputMode(opts, isTTY) centralizes JSON/human decision"

requirements-completed: [OUT-01, OUT-02, OUT-03]

# Metrics
duration: 2min
completed: 2026-03-10
---

# Phase 28 Plan 02: Output Gating Summary

**TTY-aware output gating: human summary by default, JSON on --json or pipe, with resolveOutputMode pure function and 5 unit tests**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-10T11:33:27Z
- **Completed:** 2026-03-10T11:35:07Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- resolveOutputMode pure function: --json flag or non-TTY stdout triggers JSON, TTY defaults to human summary
- --json and --verbose flags added to kb index command
- Output gating wired: printSummary on TTY, output() for JSON/pipe
- Error routing split: stderr in JSON mode, printSummary handles errors in human mode
- 5 tests covering full gating matrix (TTY/non-TTY x --json/no-flag)
- Full suite green: 711 tests passing, build clean

## Task Commits

Each task was committed atomically (TDD flow):

1. **RED: Failing tests for resolveOutputMode** - `bdef3b8` (test)
2. **GREEN: Implement output gating with --json/--verbose** - `94988e6` (feat)

**Plan metadata:** [pending] (docs: complete plan)

## Files Created/Modified
- `tests/cli/index-cmd.test.ts` - 5 unit tests for resolveOutputMode gating matrix
- `src/cli/commands/index-cmd.ts` - resolveOutputMode function, --json/--verbose flags, gated output block

## Decisions Made
- Extract resolveOutputMode as an exported pure function rather than inline logic, for direct unit testability
- Error routing: JSON mode sends errors to stderr (machine-readable separation), human mode lets printSummary handle errors on the same stream

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 28 complete (last phase in v3.1 Indexing UX milestone)
- --verbose flag declared but not wired to per-repo detail yet (future enhancement)
- All v3.1 requirements satisfied: PROG-01-03, ERR-01-03, SUM-01-03, OUT-01-03

## Self-Check: PASSED

- [x] tests/cli/index-cmd.test.ts exists
- [x] src/cli/commands/index-cmd.ts exists
- [x] 28-02-SUMMARY.md exists
- [x] Commit bdef3b8 found
- [x] Commit 94988e6 found

---
*Phase: 28-output-control-summary*
*Completed: 2026-03-10*
