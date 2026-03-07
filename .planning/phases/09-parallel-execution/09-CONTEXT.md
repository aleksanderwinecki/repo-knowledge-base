# Phase 9: Parallel Execution - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Full and incremental re-indexing runs repos concurrently, reducing wall-clock time by 2-4x while maintaining data consistency. Parallelism applies to the extraction phase (git operations, file reading, regex parsing); DB persistence remains serial. Event Catalog enrichment still runs after all repos complete.

</domain>

<decisions>
## Implementation Decisions

### Concurrency model
- Extract parallel, persist serial: run git ops + file reads + regex parsing concurrently across repos, collect results, then persist to DB one repo at a time
- Use `p-limit` package for concurrency control (already decided in STATE.md, tiny dep, well-tested)
- Use `Promise.allSettled` so one repo failure doesn't cancel others
- Default concurrency: 4

### Progress reporting
- Print per-repo output as each repo completes (same format as current: 'Indexing repo... done (X modules, Y protos)')
- Order may vary due to parallelism — that's fine
- Skipped repos (no new commits) print nothing — only indexed and errored repos produce output
- Summary line unchanged: 'N repos (X indexed, Y skipped, Z errors)'
- No timing info in output
- No parallelism details exposed in output

### Concurrency configuration
- KB_CONCURRENCY=1 means sequential (natural behavior, good escape hatch)
- Default: 4 if not set
- `kb status` does not show concurrency level (runtime detail, not KB state)

### Error isolation
- Failed repos don't affect others in the same batch (Promise.allSettled)
- Failed persistence: skip and report error, no retry
- Event Catalog enrichment runs if any repos succeeded (same as current `success > 0` check)

### Claude's Discretion
- Whether to split into separate extractRepo() + persist functions or make indexSingleRepo async
- Exact p-limit integration pattern
- How to handle the skip check (before or during parallel phase)
- Test strategy for parallelism verification

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `indexSingleRepo(db, repoPath, options, branch)`: current synchronous single-repo pipeline — needs async wrapper or split
- `persistRepoData(db, data)` / `persistSurgicalData(db, data)`: DB write functions — remain synchronous, called serially
- `discoverRepos(rootDir)`: returns repo paths — used as input to parallel map
- `enrichFromEventCatalog(db, rootDir)`: post-processing — runs after parallel phase completes

### Established Patterns
- `indexAllRepos` is a simple `for...of` loop over `discoverRepos()` results — main refactor target
- `checkSkip()` reads DB (fast) — can run before parallel phase to filter work
- `resolveDefaultBranch()` is a git operation — could be part of parallel extraction
- Error isolation already exists per repo via try/catch in the loop

### Integration Points
- `pipeline.ts:indexAllRepos()` — primary refactor target (for loop → parallel)
- `pipeline.ts:indexSingleRepo()` — may need async wrapper or extraction split
- `cli.ts:index command` — calls indexAllRepos, may need to handle async return
- `package.json` — add p-limit dependency

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 09-parallel-execution*
*Context gathered: 2026-03-07*
