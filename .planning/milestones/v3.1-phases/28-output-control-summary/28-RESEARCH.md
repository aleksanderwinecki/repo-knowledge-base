# Phase 28: Output Control & Summary - Research

**Researched:** 2026-03-10
**Domain:** CLI output gating (TTY detection, JSON/human-readable modes), compact summary formatting
**Confidence:** HIGH

## Summary

Phase 28 completes the v3.1 Indexing UX milestone by replacing the unconditional JSON dump from `kb index` with a compact human-readable summary on TTY, while preserving JSON output via `--json` flag or pipe detection. Phase 27 already wired `ProgressReporter` and `ErrorCollector` into the pipeline, and the CLI already creates them. The remaining work is: (1) add `--json` and `--verbose` flags to the index command, (2) build a summary formatter function that takes `IndexResult[]` + elapsed time and writes a compact human-readable summary, (3) gate `output(results)` behind TTY/flag detection.

This is a pure presentation-layer change. The pipeline, MCP tool, and all other CLI commands are unaffected. The `IndexResult[]` type already contains everything needed to compute success/skipped/error counts. The `ErrorCollector` already groups and prints errors to stderr. The only gap is a summary formatter and the output gating logic in `index-cmd.ts`.

**Primary recommendation:** Create a `formatSummary()` function in a new `src/cli/summary.ts` module, add `--json`/`--verbose` flags to the index command, and gate output in `index-cmd.ts` based on `opts.json || !process.stdout.isTTY`.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| OUT-01 | JSON results only on `--json` or non-TTY (pipe) | TTY detection via `process.stdout.isTTY`, `--json` flag on Commander; gate `output(results)` call |
| OUT-02 | Human-readable summary as default TTY output | New `formatSummary()` function writes to stdout; computed from `IndexResult[]` + elapsed time |
| OUT-03 | Per-repo "Indexing X... done" lines suppressed; detail via `--verbose` or `--json` | Phase 27 already replaced these with progress counter; `--verbose` flag controls whether per-repo lines print |
| SUM-01 | Summary shows: total repos, indexed count, skipped count, error count, elapsed time | All derivable from `IndexResult[]` (count by status) + `withTimingAsync` timing |
| SUM-02 | Errors listed individually with repo name and error message | `IndexResult[]` entries with `status === 'error'` have `repo` and `error` fields; `ErrorCollector.printSummary()` already does this for stderr |
| SUM-03 | Summary compact enough for single terminal screen (400-repo run) | Fixed-size summary block: header line + counts line + error lines (only failures, not 400 lines) |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @commander-js/extra-typings | ^14.0.0 | CLI flag definitions (`--json`, `--verbose`) | Already used for all CLI commands |
| Node.js process.stdout.isTTY | built-in | Pipe/TTY detection | Standard Node.js approach, no dependencies |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | existing | Unit tests for summary formatter | Test all formatting scenarios |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Manual TTY check | `supports-color` or `is-interactive` | Overkill -- `process.stdout.isTTY` is the standard Node check, zero deps |
| Custom summary format | `cli-table3` or `chalk` | Out of scope per REQUIREMENTS.md -- no color, no fancy tables |

## Architecture Patterns

### Recommended Project Structure
```
src/cli/
  commands/index-cmd.ts   # Modified: add --json, --verbose flags; gate output
  output.ts               # Unchanged (still used by other commands)
  summary.ts              # NEW: formatSummary() function
  timing.ts               # Unchanged (but elapsed time used in summary)
src/indexer/
  progress.ts             # Minor: add getters for error counts/data if needed
  pipeline.ts             # Unchanged
```

### Pattern 1: Output Gating in Command Handler
**What:** The command handler decides output mode based on flags and TTY status.
**When to use:** Only in `index-cmd.ts` -- other commands remain JSON-only (they serve MCP/AI agents).
**Example:**
```typescript
// In index-cmd.ts action handler:
const jsonMode = opts.json || !process.stdout.isTTY;

if (jsonMode) {
  output(results);
} else {
  printSummary(results, elapsed, errors);
}
```

### Pattern 2: Summary Formatter as Pure Function
**What:** A pure function that takes data and returns formatted string(s), writing to a stream.
**When to use:** For testability -- mock the stream in tests, same pattern as ProgressReporter/ErrorCollector.
**Example:**
```typescript
// src/cli/summary.ts
export function printSummary(
  stream: NodeJS.WriteStream,
  results: IndexResult[],
  elapsedMs: number,
  errors: ErrorCollector,
): void {
  const success = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const failed  = results.filter(r => r.status === 'error').length;
  const elapsed = (elapsedMs / 1000).toFixed(1);

  stream.write(`Indexed ${success} repos, skipped ${skipped}, ${failed} errors (${elapsed}s)\n`);

  // Delegate error detail to ErrorCollector (already writes to stderr)
  if (errors.hasErrors()) {
    errors.printSummary(stream);
  }
}
```

### Pattern 3: Elapsed Time from perf_hooks
**What:** Use the existing `withTimingAsync` wrapper but also capture the raw duration for the summary.
**When to use:** To get elapsed time without duplicating timing logic.
**Example:**
```typescript
// Option A: Use performance.getEntriesByName after withTimingAsync completes
const results = await withTimingAsync('index-all', () => indexAllRepos(...));
const measure = performance.getEntriesByName('index-all')[0];
const elapsedMs = measure?.duration ?? 0;

// Option B: Simpler -- just use Date.now() around the call
const start = Date.now();
const results = await withDbAsync(async (db) => indexAllRepos(db, ...));
const elapsedMs = Date.now() - start;
```

### Anti-Patterns to Avoid
- **Modifying `output()` globally:** Other commands (search, deps, etc.) rely on unconditional JSON output. Don't add TTY detection to `output.ts` -- it would break MCP tool expectations. The gating belongs in `index-cmd.ts` only.
- **Verbose per-repo output in default mode:** The success criteria explicitly say progress counter is the only mid-run output. Don't add "Indexed app-foo (42 modules)" lines unless `--verbose`.
- **Touching the MCP reindex tool:** `reindex.ts` calls `indexAllRepos` without callbacks and returns JSON directly. It must not be affected by TTY/output changes (it runs in an MCP server process, not a TTY).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TTY detection | Custom stream inspection | `process.stdout.isTTY` | Built-in, battle-tested, handles all edge cases |
| Error grouping | Custom error aggregation in summary | `ErrorCollector.printSummary()` | Already built in Phase 27, tested, handles categorization |
| Timing | Custom timer | Existing `withTimingAsync` + `performance.getEntriesByName` | Already in the codebase |

## Common Pitfalls

### Pitfall 1: Breaking JSON Pipe Consumers
**What goes wrong:** Summary text leaks into stdout when piped, breaking `kb index | jq`.
**Why it happens:** Checking `process.stderr.isTTY` instead of `process.stdout.isTTY`, or writing summary to stdout alongside JSON.
**How to avoid:** Gate on `process.stdout.isTTY`. Summary goes to stdout only in human mode. JSON goes to stdout only in JSON mode. Never both.
**Warning signs:** `kb index | jq` fails with parse error.

### Pitfall 2: ErrorCollector.printSummary() Writing to Wrong Stream
**What goes wrong:** Error summary goes to stderr (current behavior) but the compact summary goes to stdout, creating a split output that's confusing.
**Why it happens:** `ErrorCollector.printSummary()` takes a stream parameter, but the current call in `index-cmd.ts` passes `process.stderr`.
**How to avoid:** In human-readable mode, pass `process.stdout` to `printSummary()` so everything appears together in the terminal. In JSON mode, errors can stay on stderr (or be embedded in the JSON).
**Warning signs:** Errors appear above/below the summary in a confusing order.

### Pitfall 3: Summary Not Compact Enough
**What goes wrong:** With 10+ errored repos and detailed error messages, summary overflows a terminal screen.
**Why it happens:** Printing full error messages for each failed repo.
**How to avoid:** Cap error detail. For the compact summary, show error count + first N errors. Truncate long error messages.
**Warning signs:** Summary for a 400-repo run is more than ~24 lines (standard terminal height).

### Pitfall 4: --verbose Flag Missing from Other Index Subcommands
**What goes wrong:** `--verbose` only works on `kb index`, but `kb index --repo app-foo --verbose` also needs it.
**Why it happens:** Forgetting that `--repo` uses the same command handler.
**How to avoid:** The flag is on the `index` command itself, so it applies to all invocations automatically via Commander.

### Pitfall 5: Elapsed Time Includes DB Open/Close
**What goes wrong:** Reported elapsed time is slightly higher than expected because it includes database initialization.
**Why it happens:** Wrapping `withDbAsync` in the timer rather than just `indexAllRepos`.
**How to avoid:** Either accept the small overhead (it's negligible), or time only the `indexAllRepos` call. The existing `withTimingAsync('index-all', ...)` already wraps just the pipeline call, so use that measurement.

## Code Examples

### Current State: index-cmd.ts Output Path
```typescript
// Current: unconditionally dumps JSON to stdout
output(results);
if (opts.timing) reportTimings();
```

### Target State: Gated Output
```typescript
// After: gate based on --json flag and TTY detection
const jsonMode = opts.json || !process.stdout.isTTY;

if (jsonMode) {
  output(results);
} else {
  // Get elapsed time from perf_hooks (already measured by withTimingAsync)
  const measure = performance.getEntriesByName('index-all')[0];
  const elapsedMs = measure?.duration ?? 0;
  printSummary(process.stdout, results, elapsedMs, errors);
}

if (opts.timing) reportTimings();
```

### Summary Format (compact, fits one screen)
```
Indexed 380 repos, skipped 15, 5 errors in 42.3s

Errors:
  app-broken: parse error in package.json
  app-stale: git fetch timed out
  app-locked: .git/index.lock: File is locked
  app-dirty: dirty working tree
  app-orphan: no main or master branch

3 repos had no main/master branch: app-x, app-y, app-z
```

For a 400-repo run with 5 errors, this is ~10 lines -- well within a single terminal screen. Even with 20 errors, it's ~25 lines.

### Commander Flag Additions
```typescript
.option('--json', 'output raw JSON results', false)
.option('--verbose', 'show per-repo detail during indexing', false)
```

### Verbose Mode: Per-repo Detail
When `--verbose` is active (TTY mode), the progress callback could print completion lines:
```
Indexing [42/412] app-foo... done (23 modules, 5 protos)
```
But the success criteria say progress counter is the only mid-run output by default. Verbose mode is for users who want detail -- it's opt-in.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Unconditional JSON dump | TTY-aware output gating | This phase (28) | Human users get readable output, pipes still get JSON |
| Interleaved "Indexing X... done" lines | Progress counter only (Phase 27) | Phase 27 | Cleaner output, detail available via --verbose |

**Current gaps being addressed:**
- `output(results)` in index-cmd.ts is the only place that dumps JSON unconditionally -- this is the target for change
- No `--json` flag exists yet
- No `--verbose` flag exists yet
- No summary formatter exists yet

## Open Questions

1. **Should --verbose print per-repo results during indexing or after?**
   - What we know: Success criteria say "detail available via `--verbose` or `--json`". The progress counter is the only mid-run output.
   - What's unclear: Does `--verbose` mean per-repo lines during indexing (replacing the counter), or a detailed per-repo table after completion?
   - Recommendation: Print detailed per-repo results after completion in verbose mode (keeps the clean progress counter during indexing). The per-repo results would include module/proto/event counts per repo.

2. **Should ErrorCollector need new public getters?**
   - What we know: `ErrorCollector` fields are all private. `printSummary()` writes directly to a stream. `IndexResult[]` already has error info.
   - What's unclear: Whether the summary formatter should use `ErrorCollector.printSummary()` or build error output from `IndexResult[]` directly.
   - Recommendation: Use `ErrorCollector.printSummary()` for the error detail section (it already handles categorized grouping nicely). Derive counts from `IndexResult[]` for the header line. Add a `totalErrors(): number` getter if needed for the header count.

3. **Should `--json` be mutually exclusive with `--verbose`?**
   - What we know: `--json` outputs the raw results array. `--verbose` adds per-repo detail.
   - Recommendation: `--json` wins if both are passed (JSON output is the escape hatch for programmatic consumers). Or simply: `--json` forces JSON mode regardless of other flags.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (existing) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/cli/summary.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OUT-01 | JSON output only on `--json` or non-TTY | unit | `npx vitest run tests/cli/summary.test.ts -t "json mode"` | Wave 0 |
| OUT-02 | Human-readable summary as default TTY output | unit | `npx vitest run tests/cli/summary.test.ts -t "human summary"` | Wave 0 |
| OUT-03 | Per-repo lines suppressed (verbose only) | unit | `npx vitest run tests/cli/summary.test.ts -t "verbose"` | Wave 0 |
| SUM-01 | Summary shows total/indexed/skipped/error/elapsed | unit | `npx vitest run tests/cli/summary.test.ts -t "summary counts"` | Wave 0 |
| SUM-02 | Errors listed individually with repo + message | unit | `npx vitest run tests/cli/summary.test.ts -t "error listing"` | Wave 0 |
| SUM-03 | Summary fits single screen for 400 repos | unit | `npx vitest run tests/cli/summary.test.ts -t "compact"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/cli/summary.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/cli/summary.test.ts` -- covers OUT-01 through SUM-03, summary formatting, output gating
- [ ] `src/cli/summary.ts` -- new module (production code, not test gap, but needed for tests to pass)

## Sources

### Primary (HIGH confidence)
- Direct codebase inspection of `src/cli/commands/index-cmd.ts`, `src/cli/output.ts`, `src/indexer/pipeline.ts`, `src/indexer/progress.ts`, `src/mcp/tools/reindex.ts`
- `IndexResult` type definition in `pipeline.ts` (lines 41-48) -- confirms all fields needed for summary
- `ErrorCollector` class in `progress.ts` (lines 101-178) -- confirms available API surface
- Node.js `process.stdout.isTTY` documentation -- standard TTY detection mechanism

### Secondary (MEDIUM confidence)
- Commander.js flag patterns from existing `.option()` calls in the codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all tools are already in the project, no new dependencies
- Architecture: HIGH -- pure presentation layer change, clear separation from pipeline
- Pitfalls: HIGH -- verified by reading the actual code paths and understanding the data flow

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable domain, no moving parts)
