# Phase 9: Parallel Execution - Research

**Researched:** 2026-03-07
**Domain:** Node.js async concurrency with SQLite serial persistence
**Confidence:** HIGH

## Summary

Phase 9 converts the `indexAllRepos` for-loop into a parallel-extract + serial-persist pipeline using `p-limit` for concurrency control and `Promise.allSettled` for error isolation. The refactor is surgically scoped: one function (`indexAllRepos` in `pipeline.ts`) changes from synchronous iteration to async orchestration, while `indexSingleRepo` gets split into an extraction phase (parallelizable) and a persistence phase (serial).

The architecture is straightforward because better-sqlite3 is synchronous and single-threaded -- there's no connection sharing concern. All git operations and file parsing (the expensive part) run concurrently, then results queue up for serial DB writes. The CLI command needs a minor change to handle the async return.

**Primary recommendation:** Split `indexSingleRepo` into `extractRepoData(repoPath, branch, options)` (pure, no DB) and `persistExtractedData(db, extracted)` (DB writes). Run extractions through p-limit, collect results with Promise.allSettled, persist serially.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Extract parallel, persist serial: run git ops + file reads + regex parsing concurrently across repos, collect results, then persist to DB one repo at a time
- Use `p-limit` package for concurrency control (already decided in STATE.md, tiny dep, well-tested)
- Use `Promise.allSettled` so one repo failure doesn't cancel others
- Default concurrency: 4
- Print per-repo output as each repo completes (same format as current: 'Indexing repo... done (X modules, Y protos)')
- Order may vary due to parallelism -- that's fine
- Skipped repos (no new commits) print nothing -- only indexed and errored repos produce output
- Summary line unchanged: 'N repos (X indexed, Y skipped, Z errors)'
- No timing info in output
- No parallelism details exposed in output
- KB_CONCURRENCY=1 means sequential (natural behavior, good escape hatch)
- Default: 4 if not set
- `kb status` does not show concurrency level (runtime detail, not KB state)
- Failed repos don't affect others in the same batch (Promise.allSettled)
- Failed persistence: skip and report error, no retry
- Event Catalog enrichment runs if any repos succeeded (same as current `success > 0` check)

### Claude's Discretion
- Whether to split into separate extractRepo() + persist functions or make indexSingleRepo async
- Exact p-limit integration pattern
- How to handle the skip check (before or during parallel phase)
- Test strategy for parallelism verification

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IDX2-04 | Repos indexed in parallel with configurable concurrency, DB writes serialized on main thread | p-limit controls extraction concurrency; Promise.allSettled collects results; serial persist loop handles DB writes; KB_CONCURRENCY env var for configuration |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| p-limit | ^7.0.0 | Concurrency limiter for async functions | 47M weekly downloads, battle-tested, pure ESM, tiny footprint, sindresorhus ecosystem |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| better-sqlite3 | ^12.0.0 (existing) | Synchronous SQLite | Already in use; serial persistence happens naturally |
| vitest | ^3.0.0 (existing) | Test framework | Test parallelism behavior |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| p-limit | Hand-rolled semaphore | p-limit is 3KB, proven, handles edge cases; not worth hand-rolling |
| p-limit | worker_threads | SQLite can't share connections across threads; massive complexity for no gain (decided in STATE.md) |
| Promise.allSettled | Promise.all | allSettled continues on failure; all rejects on first error -- allSettled is correct here |

**Installation:**
```bash
npm install p-limit
```

**Note on ESM compatibility:** p-limit v7 is pure ESM. This project uses `"type": "module"` and `"module": "ESNext"` in tsconfig -- fully compatible. No CJS workaround needed.

## Architecture Patterns

### Recommended Refactor Structure

The refactor touches exactly these files:

```
src/indexer/
  pipeline.ts        # PRIMARY CHANGE: indexAllRepos becomes async, extract/persist split
package.json         # ADD: p-limit dependency
src/cli/commands/
  index-cmd.ts       # MINOR: handle async indexAllRepos (add await)
```

### Pattern 1: Extract-then-Persist Split

**What:** Separate the pure extraction logic (git reads, file parsing, regex) from the DB persistence logic. Extraction is parallelizable; persistence is not.

**When to use:** This is the core refactoring pattern for the entire phase.

**Recommended approach -- split `indexSingleRepo` into two functions:**

```typescript
// New: Pure extraction function (no DB access, safe to parallelize)
interface ExtractedRepoData {
  repoName: string;
  repoPath: string;
  metadata: RepoMetadata;
  mode: 'full' | 'surgical';
  allModules: ModuleData[];
  events: EventData[];
  services: ServiceData[];
  elixirModules: ElixirModule[];  // needed for edge insertion
  protoDefinitions: ProtoDefinition[];  // needed for event relationships
  eventRelationships: EventRelationship[];
  // Surgical-specific
  changedFiles?: string[];
  surgicalModules?: ModuleData[];
  surgicalEvents?: EventData[];
  existingRepoId?: number;
}

async function extractRepoData(
  repoPath: string,
  options: IndexOptions,
  branch: string,
  dbSnapshot: { repoId?: number; lastCommit?: string | null },
): Promise<ExtractedRepoData> {
  // All git reads, file parsing, regex matching -- no DB writes
}

function persistExtractedData(
  db: Database.Database,
  extracted: ExtractedRepoData,
): IndexStats & { mode: 'full' | 'surgical' } {
  // All DB writes -- called serially
}
```

**Why this approach over making indexSingleRepo async:** Clean separation of concerns. The extraction function can be tested without a DB. The persist function remains synchronous (better-sqlite3 is sync anyway). Makes the concurrency boundary explicit.

**Key subtlety -- DB reads during extraction:** The current `indexSingleRepo` reads from DB to determine surgical vs full mode (checks `existingRow.last_indexed_commit`). This read must happen before parallel extraction. Two options:

1. **Pre-read approach (recommended):** Before entering the parallel phase, read the skip check + existing repo info for all repos into a lightweight snapshot. Pass this snapshot into `extractRepoData`. This keeps DB access out of the parallel phase entirely.
2. **Read-during-extract approach:** Since better-sqlite3 reads are synchronous and happen on the main thread (even inside an async function), they're technically safe. But mixing DB reads into the "pure extraction" function muddies the architecture.

### Pattern 2: p-limit Integration

**What:** Use p-limit to cap concurrent extractions.

```typescript
import pLimit from 'p-limit';

const concurrency = parseInt(process.env.KB_CONCURRENCY ?? '4', 10) || 4;
const limit = pLimit(concurrency);

// Wrap each repo extraction in the limiter
const extractionPromises = reposToIndex.map(({ repoPath, branch, snapshot }) =>
  limit(() => extractRepoData(repoPath, options, branch, snapshot))
);

const results = await Promise.allSettled(extractionPromises);
```

**Key detail:** `limit()` returns a Promise, so the extraction function inside can be sync or async -- p-limit handles both. Since our extraction calls `execSync` (git operations) internally, each extraction blocks its "slot" until complete, which is exactly what we want for concurrency control.

### Pattern 3: Serial Persistence After Parallel Extraction

**What:** After all extractions complete, persist results one by one.

```typescript
for (const result of results) {
  if (result.status === 'fulfilled') {
    try {
      const stats = persistExtractedData(db, result.value);
      console.log(`Indexing ${result.value.repoName}... done (...)`);
      indexResults.push({ repo: result.value.repoName, status: 'success', ... });
    } catch (error) {
      console.error(`Indexing ${result.value.repoName}... ERROR: ...`);
      indexResults.push({ repo: result.value.repoName, status: 'error', ... });
    }
  } else {
    // Promise.allSettled rejected = extraction failed
    indexResults.push({ repo: ..., status: 'error', error: result.reason?.message });
  }
}
```

### Pattern 4: Skip Check Placement

**What:** Where to run the "no new commits" check relative to the parallel phase.

**Recommended: Before the parallel phase.** The skip check does two things:
1. `resolveDefaultBranch(repoPath)` -- git operation (fast, ~5ms)
2. `checkSkip(db, repoPath, repoName, branch)` -- DB read (fast, ~1ms)

Run these sequentially for all repos to build a work list. This avoids DB reads during the parallel phase and provides the `existingRepoId`/`lastCommit` snapshot needed for surgical mode decisions.

```typescript
// Phase 1: Build work list (sequential, fast)
const workItems: WorkItem[] = [];
for (const repoPath of repos) {
  const branch = resolveDefaultBranch(repoPath);
  // ... skip checks ...
  workItems.push({ repoPath, branch, snapshot: { repoId, lastCommit } });
}

// Phase 2: Parallel extraction
const extractions = await Promise.allSettled(
  workItems.map(item => limit(() => extractRepoData(item.repoPath, options, item.branch, item.snapshot)))
);

// Phase 3: Serial persistence
for (const extraction of extractions) { ... }
```

### Anti-Patterns to Avoid
- **DB writes inside the parallel phase:** better-sqlite3 is synchronous and will block, but interleaving write transactions from concurrent async contexts is unpredictable and could cause "database is locked" errors. Keep ALL writes serial.
- **Using Promise.all instead of Promise.allSettled:** One failing repo would cancel all in-flight extractions, losing work.
- **Passing the `db` object into extraction functions:** Even for reads, this blurs the extract/persist boundary. Pre-snapshot the DB info instead.
- **Async extraction with internal `execSync`:** This works but looks odd. The function is async because p-limit needs a Promise, but internally it calls `execSync`. This is fine -- `execSync` blocks the current async context's "slot" but not the event loop for other slots. Document this clearly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Concurrency limiting | Custom semaphore/queue | p-limit | Edge cases around queue draining, error propagation, and cleanup are non-trivial |
| Promise error isolation | try/catch wrapper per promise | Promise.allSettled | Built-in, standardized, handles all edge cases |
| Environment variable parsing | Complex parser with validation | `parseInt(process.env.KB_CONCURRENCY ?? '4', 10) \|\| 4` | One-liner, fallback to default on NaN |

**Key insight:** The entire parallelism implementation is ~30 lines of orchestration code wrapping existing functions. There's nothing complex to build -- just restructure what's already there.

## Common Pitfalls

### Pitfall 1: execSync Blocking the Event Loop
**What goes wrong:** `execSync` (used in all git operations) blocks the Node.js event loop. If you run 4 concurrent extractions and each calls `execSync`, only one actually executes at a time -- you get no parallelism.
**Why it happens:** Node.js is single-threaded. `execSync` blocks the main thread.
**How to avoid:** This is NOT actually a problem here. `execSync` spawns a child process and blocks the *calling* async context, but p-limit uses microtask scheduling. When one `execSync` blocks, Node.js can't start another extraction in that tick, BUT once the child process returns and the microtask completes, the next queued extraction starts. The practical effect is that git operations in different repos DO overlap because the OS runs child processes in parallel -- the `execSync` call blocks waiting for the child, but other child processes spawned by other extractions continue running.
**Warning signs:** If you see zero speedup, this might be the cause. But empirically, `execSync` with git operations on different repos does yield parallelism because the OS-level processes run concurrently.
**Validation note:** This is the highest-risk assumption. If `execSync` truly serializes everything, the fallback is to use `execFile` from `child_process/promises` for the git calls. But that's a larger refactor and should only be attempted if measured speedup is negligible.

### Pitfall 2: Console Output Interleaving
**What goes wrong:** Multiple repos printing progress simultaneously creates garbled output.
**Why it happens:** `console.log` is not atomic for multi-line output.
**How to avoid:** Per the user decision, output happens AFTER each repo completes (not during). Since persistence is serial, output during the persist phase is naturally ordered. Only extraction-phase errors could interleave, but those are collected and printed later.

### Pitfall 3: Signature Change from Sync to Async
**What goes wrong:** `indexAllRepos` currently returns `IndexResult[]` synchronously. Changing it to `async` makes it return `Promise<IndexResult[]>`, breaking all callers.
**Why it happens:** TypeScript enforces return type changes.
**How to avoid:** Update all callers:
1. `src/cli/commands/index-cmd.ts` -- wrap in async action, await the result
2. `src/mcp/sync.ts` -- does NOT call `indexAllRepos`, only `indexSingleRepo`. No change needed.
3. `src/index.ts` -- type export changes automatically
4. Tests -- pipeline tests that call `indexAllRepos` need `await`

### Pitfall 4: DB Snapshot Staleness
**What goes wrong:** Pre-reading repo state (commit SHA, repo ID) before parallel extraction, then using stale data during persistence.
**Why it happens:** Another repo's persistence could theoretically change shared state.
**How to avoid:** Each repo's persistence only writes to its own repo's tables. Cross-repo edges (gRPC client edges, Ecto associations) resolve target IDs at persist time. Since persistence is serial, each repo sees the latest state when it persists. The pre-read snapshot only provides the repo's OWN `last_indexed_commit` and `repo_id` -- neither of which changes until that repo's own persistence runs.

### Pitfall 5: p-limit v7 Requires Node 20+
**What goes wrong:** `npm install` succeeds but runtime crashes on Node 18.
**Why it happens:** p-limit v7 uses Node 20+ features.
**How to avoid:** This project targets ES2022 and uses modern ESM -- Node 20+ is almost certainly already in use. Verify with `node --version` during implementation. If Node 18 is needed, use p-limit v6 instead.

## Code Examples

### Complete indexAllRepos Refactor Pattern

```typescript
import pLimit from 'p-limit';

export async function indexAllRepos(
  db: Database.Database,
  options: IndexOptions,
): Promise<IndexResult[]> {
  const repos = discoverRepos(options.rootDir);
  const results: IndexResult[] = [];
  const concurrency = parseInt(process.env.KB_CONCURRENCY ?? '4', 10) || 4;
  const limit = pLimit(concurrency);

  // Phase 1: Build work list (sequential, fast DB reads + git branch resolution)
  const workItems: Array<{
    repoPath: string;
    repoName: string;
    branch: string;
    snapshot: { repoId?: number; lastCommit?: string | null };
  }> = [];

  for (const repoPath of repos) {
    const repoName = path.basename(repoPath);
    const branch = resolveDefaultBranch(repoPath);
    if (!branch) {
      results.push({ repo: repoName, status: 'skipped', mode: 'skipped', skipReason: 'no main or master branch' });
      continue;
    }
    if (!options.force) {
      const skipResult = checkSkip(db, repoPath, repoName, branch);
      if (skipResult) { results.push(skipResult); continue; }
    }
    // Snapshot DB state for this repo
    const existingRow = db.prepare('SELECT id, last_indexed_commit FROM repos WHERE name = ?')
      .get(repoName) as { id: number; last_indexed_commit: string | null } | undefined;
    workItems.push({
      repoPath, repoName, branch,
      snapshot: { repoId: existingRow?.id, lastCommit: existingRow?.last_indexed_commit },
    });
  }

  // Phase 2: Parallel extraction
  const extractions = await Promise.allSettled(
    workItems.map(item =>
      limit(() => extractRepoData(item.repoPath, options, item.branch, item.snapshot))
    )
  );

  // Phase 3: Serial persistence
  for (let i = 0; i < extractions.length; i++) {
    const extraction = extractions[i];
    const workItem = workItems[i];
    if (extraction.status === 'fulfilled') {
      try {
        const stats = persistExtractedData(db, extraction.value);
        console.log(`Indexing ${workItem.repoName}... done (${stats.modules} modules, ${stats.protos} protos)`);
        results.push({ repo: workItem.repoName, status: 'success', mode: stats.mode, stats });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`Indexing ${workItem.repoName}... ERROR: ${msg}`);
        results.push({ repo: workItem.repoName, status: 'error', error: msg });
      }
    } else {
      const msg = extraction.reason instanceof Error ? extraction.reason.message : String(extraction.reason);
      console.error(`Indexing ${workItem.repoName}... ERROR: ${msg}`);
      results.push({ repo: workItem.repoName, status: 'error', error: msg });
    }
  }

  // Summary + Event Catalog (unchanged logic)
  const success = results.filter(r => r.status === 'success').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors = results.filter(r => r.status === 'error').length;
  console.log(`\nIndexing complete: ${results.length} repos (${success} indexed, ${skipped} skipped, ${errors} errors)`);

  if (success > 0) {
    try { enrichFromEventCatalog(db, options.rootDir); }
    catch (error) { console.warn(`Event Catalog enrichment failed: ${error instanceof Error ? error.message : String(error)}`); }
  }

  return results;
}
```

### CLI Async Handling

```typescript
// src/cli/commands/index-cmd.ts
.action(async (opts) => {
  const results = await withDbAsync(async (db) =>
    indexAllRepos(db, { rootDir: opts.root, force: opts.force }),
  );
  output(results);
});
```

**Note:** The existing `withDb` helper is synchronous. Either:
1. Create a `withDbAsync` variant that accepts an async callback, OR
2. Open/close DB manually in the action handler

Option 1 is cleaner:
```typescript
export async function withDbAsync<T>(fn: (db: Database.Database) => Promise<T>): Promise<T> {
  const db = openDatabase(getDbPath());
  try {
    return await fn(db);
  } finally {
    closeDatabase(db);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| worker_threads for parallelism | p-limit + Promise.allSettled | N/A (design decision) | Avoids SQLite connection sharing issues, simpler architecture |
| Sequential for-of loop | Parallel extract + serial persist | This phase | 2-4x wall-clock reduction for extraction-heavy workloads |

**Deprecated/outdated:**
- `p-limit` v5 and below used CommonJS -- v6+ is ESM-only. This project needs v6+ (v7 recommended).

## Open Questions

1. **execSync vs async child_process for parallelism**
   - What we know: `execSync` blocks the calling context but OS child processes run in parallel. Git operations on separate repos have no shared state.
   - What's unclear: Exact speedup with `execSync`. Might be 1.5x instead of 4x if the Node event loop can't interleave enough.
   - Recommendation: Start with `execSync` (no refactor needed). Measure. If speedup is less than 1.5x on 4+ repos, consider converting git.ts functions to use `execFile` from `child_process/promises`. This would be a follow-up optimization, not a blocker.

2. **indexSingleRepo backward compatibility**
   - What we know: `indexSingleRepo` is called by `mcp/sync.ts` (for auto-sync) and exported publicly.
   - What's unclear: Whether to keep `indexSingleRepo` as-is and have `indexAllRepos` use the new split functions internally, or refactor `indexSingleRepo` to also use the split.
   - Recommendation: Keep `indexSingleRepo` unchanged. It's a single-repo operation that doesn't need parallelism. Have `indexAllRepos` use `extractRepoData` + `persistExtractedData` internally. `indexSingleRepo` continues to work for MCP sync, direct calls, and tests.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/indexer/pipeline.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IDX2-04a | Multiple repos indexed concurrently (faster than sequential) | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "parallel"` | Needs new tests |
| IDX2-04b | KB_CONCURRENCY env var controls concurrency | unit | `npx vitest run tests/indexer/pipeline.test.ts -t "concurrency"` | Needs new tests |
| IDX2-04c | KB_CONCURRENCY=1 runs sequentially | unit | `npx vitest run tests/indexer/pipeline.test.ts -t "sequential"` | Needs new tests |
| IDX2-04d | Failed repo doesn't cancel others (Promise.allSettled) | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "error isolation"` | Needs new tests |
| IDX2-04e | DB consistency after parallel indexing (same results as sequential) | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "consistency"` | Needs new tests |
| IDX2-04f | Event Catalog enrichment runs after parallel phase if any success | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "catalog"` | Existing test covers partial |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/indexer/pipeline.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New parallel-specific test cases in `tests/indexer/pipeline.test.ts` -- covers IDX2-04a through IDX2-04e
- [ ] Test strategy: Create multiple git repos in temp dir, index in parallel, verify DB state matches sequential run

### Test Strategy for Parallelism

Testing parallelism is tricky. Recommended approaches:

1. **Consistency test (most important):** Index N repos sequentially, snapshot DB state. Reset DB, index same repos in parallel, snapshot again. Compare module/event/edge counts per repo. They must be identical.

2. **Error isolation test:** Create N repos where one has an invalid git state. Index in parallel. Verify the good repos succeeded and the bad repo errored without affecting others.

3. **Concurrency configuration test:** Set KB_CONCURRENCY=1, verify sequential behavior. Set KB_CONCURRENCY=2, verify it works. These are mostly "doesn't crash" tests.

4. **The async signature test:** Verify `indexAllRepos` returns a Promise and existing test assertions still pass when awaited.

## Sources

### Primary (HIGH confidence)
- [GitHub: sindresorhus/p-limit](https://github.com/sindresorhus/p-limit) - API docs, version info, ESM compatibility
- Project source code: `src/indexer/pipeline.ts`, `src/indexer/writer.ts`, `src/cli/commands/index-cmd.ts` - current architecture

### Secondary (MEDIUM confidence)
- [better-sqlite3 thread safety](https://github.com/WiseLibs/better-sqlite3/issues/86) - confirmed single-threaded safety model
- [p-limit npm](https://www.npmjs.com/package/p-limit) - version 7.3.0 latest

### Tertiary (LOW confidence)
- execSync parallelism behavior with p-limit -- based on Node.js event loop understanding, not empirically tested for this specific codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - p-limit is the locked decision, version and API verified
- Architecture: HIGH - extract/persist split is clean and the codebase structure supports it directly
- Pitfalls: MEDIUM - execSync parallelism behavior is the one area of uncertainty; everything else is well-understood
- Test strategy: MEDIUM - consistency testing approach is sound but exact implementation details TBD

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable domain, no fast-moving dependencies)
