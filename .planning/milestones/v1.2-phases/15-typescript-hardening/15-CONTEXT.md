# Phase 15: TypeScript Hardening - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Tighten TypeScript strictness (noUncheckedIndexedAccess), remove dead code, extract shared patterns for upstream/downstream dependency queries, and fix silent catch blocks. No new features — pure code quality improvements on settled architecture from phases 11-14.

</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion

User delegated all implementation decisions to Claude. The following areas have been analyzed with recommended approaches:

**noUncheckedIndexedAccess (TS-01):**
- `tsconfig.json` currently has `strict: true` but no `noUncheckedIndexedAccess`
- Enabling it will flag every `array[i]` and `record[key]` access as possibly `undefined`
- Fix strategy: enable flag, then systematically fix all compiler errors across `src/`
- Common patterns to fix: array destructuring `const [first] = arr`, record lookups `map[key]`, loop indexing
- Tests are excluded from `tsconfig.json` (`"exclude": ["tests"]`) so only src/ needs fixes

**Dead code removal (TS-02):**
- `getChangedFiles(repoPath, sinceCommit)` in `git.ts:25` uses `HEAD`-based diff (`sinceCommit..HEAD`)
- `getChangedFilesSinceBranch(repoPath, branch, sinceCommit)` in `git.ts:217` uses branch-based diff — this is what `pipeline.ts` actually calls
- `getChangedFiles` is exported via `index.ts:24` but no internal callers use it — pipeline switched to branch-based in Phase 6
- Remove `getChangedFiles` from `git.ts` and its re-export from `index.ts`
- Verify no external callers via grep across the full repo

**Dependencies upstream/downstream symmetry (TS-03):**
- `findLinkedRepos()` in `dependencies.ts:105` has ~80 lines of if/else with mirror-image logic
- Upstream: `consumedEdgesStmt` → `producerEdgesStmt` (find who produces events I consume)
- Downstream: `producedEdgesStmt` → `consumerEdgesStmt` (find who consumes events I produce)
- Extract to a single parameterized function: pass `sourceEdgeType` and `targetEdgeType` as params
- All 6 prepared statements already hoisted above the if/else — the parameterized function can reuse them

**Silent catch blocks (TS-04):**
- `git.ts:15` — bare `catch {}` returning null for getCurrentCommit — intentional (git failures = not a repo)
- `pipeline.ts:343,372,397,407` — catch blocks in extraction pipeline with error logging
- `handler.ts:20` — MCP error handler (already structured via wrapToolHandler)
- Strategy: add brief inline comments to intentionally-silent catches explaining why silence is correct; add structured error info to any that should be logging but aren't

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `tsconfig.json`: `strict: true` already enabled — noUncheckedIndexedAccess is incremental
- Phase 11 contract tests + FTS golden tests catch regressions from any TS changes
- Phase 12 hoisted prepared statements — already handle `| undefined` in many places via `as Type | undefined` casts

### Established Patterns
- `as Type | undefined` cast pattern used extensively for better-sqlite3 `.get()` results — already handles the most common undefined-access sites
- Error isolation in pipeline: individual repo failures don't crash the full index run
- `wrapToolHandler` centralizes MCP error handling — no scattered try/catch in tool files

### Integration Points
- `src/indexer/git.ts`: `getChangedFiles` removal — check `index.ts` re-exports
- `src/search/dependencies.ts`: `findLinkedRepos` refactor — used by `getRepoDependencies` only
- `tsconfig.json`: enabling `noUncheckedIndexedAccess` affects all of `src/`

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. User delegated all decisions to Claude's judgment, consistent with phases 11-14 in this milestone.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 15-typescript-hardening*
*Context gathered: 2026-03-07*
