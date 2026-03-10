# Phase 27: Progress Reporting & Error Grouping - Research

**Researched:** 2026-03-10
**Domain:** Node.js CLI progress reporting, TTY detection, error collection patterns
**Confidence:** HIGH

## Summary

This phase modifies the indexing pipeline (`src/indexer/pipeline.ts`) to replace scattered `console.log`/`console.warn`/`console.error` calls with two new capabilities: (1) in-place progress counters that update via `\r` on TTYs and fall back to plain newlines on pipes, and (2) error collection that defers all failure reporting to a grouped summary at the end.

The codebase currently has **10 console output calls** in `pipeline.ts` that all fire inline during processing. There is no TTY detection anywhere in the project. The `gitRefresh` function already returns structured `{ refreshed, error }` results, and `resolveDefaultBranch` returns `null` for missing branches -- both are already well-suited for collection rather than inline printing.

**Primary recommendation:** Create a `ProgressReporter` class that accepts `process.stderr` (for progress) and uses `process.stderr.isTTY` for mode detection. Collect errors into categorized arrays during pipeline execution; print grouped summary after all work completes. Keep the `IndexResult[]` return type unchanged so the MCP tool and CLI command are unaffected.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PROG-01 | Git refresh phase shows live counter `Refreshing [42/412]...` | ProgressReporter with `\r` overwrite on stderr, counting repos in git refresh loop |
| PROG-02 | Extraction/indexing phase shows live counter with repo name `Indexing [42/412] app-foo...` | Same ProgressReporter, called during Phase 3 (serial persistence loop) |
| PROG-03 | Progress uses `\r` on TTY, plain newlines on non-TTY | `process.stderr.isTTY` check in ProgressReporter constructor |
| ERR-01 | Git refresh failures grouped by category at end | ErrorCollector with category classification from error message text |
| ERR-02 | "No main/master" repos shown as single count + list | ErrorCollector collects skip reasons, renders as `N repos had no main/master branch: [list]` |
| ERR-03 | Indexing errors listed individually at end | ErrorCollector stores per-repo errors, prints after all processing |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js `process.stderr` | built-in | Progress output stream | stderr is correct for progress -- stdout reserved for data (JSON results) |
| `process.stderr.isTTY` | built-in | TTY vs pipe detection | Standard Node.js API, no deps needed |
| `process.stderr.clearLine` / `cursorTo` | built-in | In-place line update | Only available when `isTTY` is true; part of `tty.WriteStream` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `\r` writes | `ora`, `cli-progress`, `listr2` | Overkill -- we need a single counter line, not spinners or progress bars. Zero deps is right here. |
| `process.stderr.clearLine()` | Raw `\r` + padding | `clearLine` is cleaner but `\r` + padding to line width works everywhere. `clearLine` is the better approach. |

**Installation:** None required -- all built-in Node.js APIs.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── indexer/
│   ├── pipeline.ts          # Modified: accepts ProgressReporter, uses ErrorCollector
│   └── progress.ts          # NEW: ProgressReporter + ErrorCollector classes
├── cli/
│   └── commands/
│       └── index-cmd.ts     # Modified: creates ProgressReporter, passes to pipeline
└── mcp/
    └── tools/
        └── reindex.ts       # Unchanged (no TTY in MCP context)
```

### Pattern 1: ProgressReporter Class

**What:** A small class that encapsulates TTY detection and provides `update(current, total, label?)` and `finish(message?)` methods.

**When to use:** Any time the pipeline needs to show progress during a loop.

**Example:**
```typescript
// Source: Node.js tty.WriteStream docs
export class ProgressReporter {
  private isTTY: boolean;
  private stream: NodeJS.WriteStream;

  constructor(stream: NodeJS.WriteStream = process.stderr) {
    this.stream = stream;
    this.isTTY = !!stream.isTTY;
  }

  update(current: number, total: number, label?: string): void {
    const msg = label
      ? `Indexing [${current}/${total}] ${label}...`
      : `Refreshing [${current}/${total}]...`;

    if (this.isTTY) {
      this.stream.clearLine(0);
      this.stream.cursorTo(0);
      this.stream.write(msg);
    } else {
      this.stream.write(msg + '\n');
    }
  }

  finish(message?: string): void {
    if (this.isTTY) {
      this.stream.clearLine(0);
      this.stream.cursorTo(0);
    }
    if (message) {
      this.stream.write(message + '\n');
    }
  }
}
```

### Pattern 2: ErrorCollector with Categorization

**What:** Collects errors during pipeline execution and groups them by category for end-of-run reporting.

**When to use:** Git refresh failures and indexing errors, plus "no branch" skips.

**Example:**
```typescript
export type ErrorCategory = 'worktree_conflict' | 'dirty_tree' | 'timeout' | 'no_branch' | 'other';

export interface CollectedError {
  repo: string;
  category: ErrorCategory;
  message: string;
}

export class ErrorCollector {
  private errors: CollectedError[] = [];
  private noBranchRepos: string[] = [];

  addRefreshError(repo: string, errorMsg: string): void {
    this.errors.push({
      repo,
      category: classifyGitError(errorMsg),
      message: errorMsg,
    });
  }

  addNoBranch(repo: string): void {
    this.noBranchRepos.push(repo);
  }

  addIndexError(repo: string, errorMsg: string): void {
    this.errors.push({ repo, category: 'other', message: errorMsg });
  }

  printSummary(stream: NodeJS.WriteStream): void {
    // No-branch repos as single count
    if (this.noBranchRepos.length > 0) {
      stream.write(`\n${this.noBranchRepos.length} repos had no main/master branch: ${this.noBranchRepos.join(', ')}\n`);
    }

    // Group refresh errors by category
    const grouped = groupBy(this.errors, e => e.category);
    for (const [category, errors] of Object.entries(grouped)) {
      stream.write(`\n${categoryLabel(category)} (${errors.length}):\n`);
      for (const err of errors) {
        stream.write(`  ${err.repo}: ${err.message}\n`);
      }
    }
  }
}

function classifyGitError(msg: string): ErrorCategory {
  if (msg.includes('dirty working tree')) return 'dirty_tree';
  if (msg.includes('ETIMEDOUT') || msg.includes('SIGTERM')) return 'timeout';
  if (msg.includes('already checked out') || msg.includes('is locked')) return 'worktree_conflict';
  return 'other';
}
```

### Pattern 3: Pipeline Injection (No Global State)

**What:** Pass `ProgressReporter` and `ErrorCollector` into `indexAllRepos` via an optional parameter rather than using global state or importing `process.stderr` directly inside the pipeline.

**Why:** The MCP tool calls `indexAllRepos` too -- it should NOT get progress output. Making it injectable means CLI passes a real reporter, MCP passes nothing (defaults to a no-op or null).

**Example:**
```typescript
export interface PipelineCallbacks {
  progress?: ProgressReporter;
  errors?: ErrorCollector;
}

export async function indexAllRepos(
  db: Database.Database,
  options: IndexOptions,
  callbacks?: PipelineCallbacks,
): Promise<IndexResult[]> {
  // ...
}
```

### Anti-Patterns to Avoid
- **Writing progress to stdout:** stdout is the data channel (JSON results). Progress MUST go to stderr. This is Unix convention and the project already uses `output()` for stdout JSON.
- **Global TTY detection at module level:** `const isTTY = process.stderr.isTTY` at module scope breaks testability. Put it in the class constructor.
- **Hardcoded `\r` without clearLine:** Using `\r` alone leaves artifacts if the new line is shorter than the previous one. Use `clearLine(0)` + `cursorTo(0)` on TTY streams.
- **Modifying `IndexResult` return type:** The MCP tool and CLI both consume `IndexResult[]`. Keep the return type stable; progress/error display is a side effect, not a return value change.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| TTY detection | Custom `ioctl` or platform checks | `process.stderr.isTTY` | Built into Node.js, handles all platforms |
| Line clearing | Manual ANSI escape sequences | `stream.clearLine(0)` + `stream.cursorTo(0)` | Part of `tty.WriteStream`, handles terminal differences |

**Key insight:** This is intentionally simple -- a progress counter and error grouping. No third-party libraries are needed. The entire implementation is ~100-150 lines of new code.

## Common Pitfalls

### Pitfall 1: Writing Progress to stdout
**What goes wrong:** Progress output mixes with JSON results, breaking piped consumers.
**Why it happens:** `console.log` writes to stdout by default.
**How to avoid:** All progress goes to `process.stderr`. Current `console.log` calls in pipeline.ts that print "Indexing X... done" must be removed or redirected.
**Warning signs:** `output(results)` in index-cmd.ts produces invalid JSON because progress lines are interleaved.

### Pitfall 2: clearLine Not Available on Non-TTY Streams
**What goes wrong:** `TypeError: stream.clearLine is not a function` when piped.
**Why it happens:** `clearLine` and `cursorTo` are methods of `tty.WriteStream`, not `fs.WriteStream`. When stderr is piped, it's a regular `Writable`.
**How to avoid:** Only call `clearLine`/`cursorTo` when `isTTY` is true. The ProgressReporter pattern above already handles this with the `if (this.isTTY)` guard.
**Warning signs:** Tests pass locally (TTY) but crash in CI (piped).

### Pitfall 3: Forgetting the Final clearLine After Progress
**What goes wrong:** The last progress line (`Refreshing [412/412]...`) stays on screen, followed by the summary on a new line.
**How to avoid:** Call `finish()` after the progress loop to clear the line, then print summary content on clean lines.

### Pitfall 4: MCP Tool Getting Progress Output
**What goes wrong:** MCP tool returns progress text mixed with JSON results.
**Why it happens:** If progress writes are hardcoded in `indexAllRepos`, MCP calls trigger them too.
**How to avoid:** Injectable callbacks pattern -- MCP path doesn't pass a reporter, so no output.

### Pitfall 5: Error Classification Regex Being Too Broad
**What goes wrong:** Errors miscategorized because substring matching is too loose.
**Why it happens:** `msg.includes('timeout')` could match repo names containing "timeout".
**How to avoid:** Match on specific error patterns from `execSync`: `ETIMEDOUT` for timeout, `dirty working tree, skipping checkout` (exact string from `gitRefresh`), `already checked out at` for worktree conflicts.

## Code Examples

### TTY Detection (Node.js built-in)
```typescript
// Source: Node.js docs - process.stderr
// process.stderr.isTTY is boolean | undefined
const isTTY = !!process.stderr.isTTY;  // coerce to boolean

// clearLine and cursorTo only exist on tty.WriteStream
if (isTTY) {
  (process.stderr as import('tty').WriteStream).clearLine(0);
  (process.stderr as import('tty').WriteStream).cursorTo(0);
}
```

### Current Console Output Points in pipeline.ts (All Must Change)

| Line | Current Code | New Behavior |
|------|-------------|--------------|
| 329 | `console.warn(\`Repo not found: ${name}\`)` | Keep as-is (targeted repo warning, not part of progress) |
| 341 | `console.warn(\`Git refresh failed...\`)` | Replace with `errors.addRefreshError(repo, error)` |
| 355 | `console.warn(\`Skipping ${repoName}: no main...\`)` | Replace with `errors.addNoBranch(repoName)` |
| 385 | `console.error(\`Indexing ${repoName}... ERROR\`)` | Replace with `errors.addIndexError(repo, msg)` |
| 408-409 | `console.log(\`Indexing ${item.repoName}... done\`)` | Replace with `progress.update(i+1, total, item.repoName)` |
| 414 | `console.error(\`Indexing ${item.repoName}... ERROR\`)` | Replace with `errors.addIndexError(repo, msg)` |
| 419 | `console.error(\`Indexing ${item.repoName}... ERROR\`)` | Replace with `errors.addIndexError(repo, msg)` |
| 428-429 | `console.log(\`Indexing complete: ...\`)` | Replace with `progress.finish()` + `errors.printSummary()` |
| 439 | `console.warn(\`Event Catalog enrichment...\`)` | Keep as stderr warning (non-critical) |
| 450 | `console.warn(\`FTS optimize failed...\`)` | Keep as stderr warning (non-critical) |

### Git Refresh Loop -- Adding Progress Counter
```typescript
// Current: no progress, inline error printing
if (options.refresh) {
  for (const repoPath of repos) {
    const branch = resolveDefaultBranch(repoPath);
    if (branch) {
      const result = gitRefresh(repoPath, branch);
      if (!result.refreshed) {
        console.warn(`Git refresh failed...`);  // inline!
      }
    }
  }
}

// New: progress counter + deferred error collection
if (options.refresh) {
  const refreshTotal = repos.length;
  for (let i = 0; i < repos.length; i++) {
    callbacks?.progress?.update(i + 1, refreshTotal);  // "Refreshing [42/412]..."
    const repoPath = repos[i]!;
    const branch = resolveDefaultBranch(repoPath);
    if (branch) {
      const result = gitRefresh(repoPath, branch);
      if (!result.refreshed) {
        callbacks?.errors?.addRefreshError(path.basename(repoPath), result.error ?? 'unknown');
      }
    }
  }
  callbacks?.progress?.finish();
}
```

### Error Category Labels
```typescript
// Map internal categories to human-readable labels
function categoryLabel(category: ErrorCategory): string {
  switch (category) {
    case 'worktree_conflict': return 'Worktree conflicts';
    case 'dirty_tree': return 'Dirty working trees';
    case 'timeout': return 'Timeouts';
    case 'no_branch': return 'No main/master branch';
    case 'other': return 'Other errors';
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `console.log` for progress | `process.stderr.write` with TTY detection | Always been the right way | stdout clean for data, stderr for human feedback |
| ANSI escape `\x1b[2K\r` | `stream.clearLine(0)` + `stream.cursorTo(0)` | Node.js 0.x | Cross-platform, no raw escape codes |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/indexer/pipeline.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROG-01 | Refresh progress counter output | unit | `npx vitest run tests/indexer/progress.test.ts -t "refresh progress"` | Wave 0 |
| PROG-02 | Index progress counter with repo name | unit | `npx vitest run tests/indexer/progress.test.ts -t "index progress"` | Wave 0 |
| PROG-03 | TTY vs non-TTY output format | unit | `npx vitest run tests/indexer/progress.test.ts -t "non-TTY"` | Wave 0 |
| ERR-01 | Git errors grouped by category | unit | `npx vitest run tests/indexer/progress.test.ts -t "error grouping"` | Wave 0 |
| ERR-02 | No-branch repos as single count | unit | `npx vitest run tests/indexer/progress.test.ts -t "no branch"` | Wave 0 |
| ERR-03 | Index errors at end, not interleaved | unit | `npx vitest run tests/indexer/progress.test.ts -t "index errors"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/indexer/progress.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before verify

### Wave 0 Gaps
- [ ] `tests/indexer/progress.test.ts` -- covers PROG-01 through ERR-03 (new file)
- Framework and config already exist, no additional setup needed

## Open Questions

1. **Progress counter format: `Refreshing` vs `Fetching`**
   - What we know: Requirements say `Refreshing [42/412]...` for git refresh phase
   - What's unclear: Nothing -- requirements are explicit about the format
   - Recommendation: Use exactly `Refreshing [N/T]...` and `Indexing [N/T] repo-name...`

2. **Should MCP tool see any progress?**
   - What we know: MCP tools return JSON via `wrapToolHandler`. There is no TTY context.
   - What's unclear: Nothing really -- MCP should never get progress output.
   - Recommendation: Optional callbacks pattern means MCP path passes nothing.

3. **Phase 28 overlap: should this phase also suppress the "Indexing X... done" lines?**
   - What we know: Phase 28 (OUT-03) says "Per-repo 'Indexing X... done' lines are suppressed in favor of the progress counter." Phase 27 replaces those lines with progress counters.
   - What's unclear: Whether Phase 27 removes the `console.log` entirely or Phase 28 does.
   - Recommendation: Phase 27 should replace `console.log("Indexing X... done")` with `progress.update()`. This naturally satisfies OUT-03 as a side effect. Phase 28 then focuses on the summary/JSON gating which is its actual scope.

## Sources

### Primary (HIGH confidence)
- `src/indexer/pipeline.ts` -- all 10 console output points mapped
- `src/indexer/git.ts` -- `gitRefresh` return structure and error strings verified
- `src/cli/commands/index-cmd.ts` -- CLI entry point, current flow verified
- `src/cli/output.ts` -- stdout reserved for JSON data
- `src/mcp/tools/reindex.ts` -- MCP consumer of `indexAllRepos`, no TTY context
- Node.js `tty.WriteStream` docs -- `clearLine`, `cursorTo`, `isTTY` APIs

### Secondary (MEDIUM confidence)
- `execSync` timeout behavior verified via local test -- `ETIMEDOUT` in message, `SIGTERM` signal
- Git worktree conflict error message pattern: `already checked out at` (standard git error)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all built-in Node.js APIs, no external deps
- Architecture: HIGH -- injection pattern is standard, codebase already has clean separation
- Pitfalls: HIGH -- verified TTY API behavior, mapped all console output points

**Research date:** 2026-03-10
**Valid until:** Indefinite -- Node.js TTY APIs are stable
