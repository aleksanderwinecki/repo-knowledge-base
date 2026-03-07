# Phase 15: TypeScript Hardening - Research

**Researched:** 2026-03-07
**Domain:** TypeScript strictness, dead code removal, code deduplication, error handling hygiene
**Confidence:** HIGH

## Summary

Phase 15 is a pure code quality phase with four well-scoped requirements. The largest item is enabling `noUncheckedIndexedAccess` in tsconfig.json, which produces exactly 60 compiler errors across 6 files (all in `src/indexer/`). The errors fall into two predictable categories: regex match group indexing (`match[1]`, `match[2]`, etc.) and array-by-index access in loops. The remaining three requirements -- dead code removal, dependency query deduplication, and silent catch block annotation -- are surgical changes to specific files with minimal blast radius.

The codebase already has `strict: true` and uses `as Type | undefined` casting extensively for `better-sqlite3` `.get()` calls, so the `noUncheckedIndexedAccess` impact is limited to regex/array patterns in the indexer layer. Tests (197 via Vitest) are excluded from tsconfig so they won't be affected. The safety net from Phase 11 (contract tests, FTS golden tests, CLI snapshot tests) provides strong regression coverage for all changes.

**Primary recommendation:** Enable `noUncheckedIndexedAccess` first (largest change, most mechanical), then handle the three targeted fixes (dead code, dependency symmetry, catch blocks) as independent tasks.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
None -- all decisions delegated to Claude's discretion.

### Claude's Discretion
- **noUncheckedIndexedAccess (TS-01):** Enable flag, systematically fix all compiler errors across src/
- **Dead code removal (TS-02):** Remove `getChangedFiles` from `git.ts` and its re-export from `index.ts`
- **Dependencies upstream/downstream symmetry (TS-03):** Extract to single parameterized function with sourceEdgeType and targetEdgeType params
- **Silent catch blocks (TS-04):** Add inline comments to intentionally-silent catches; add structured error info where logging is missing

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| TS-01 | noUncheckedIndexedAccess enabled in tsconfig with all fix sites resolved | 60 errors mapped across 6 files; fix patterns documented below |
| TS-02 | Dead code removed from git.ts (HEAD-based getChangedFiles if unused) | Confirmed unused: only exported via index.ts, no internal callers |
| TS-03 | Dependencies upstream/downstream symmetry extracted to shared parameterized function | findLinkedRepos analysis complete; mirror-image structure confirmed |
| TS-04 | Silent catch blocks replaced with structured error logging | 29 bare `catch {}` sites catalogued; 5 `catch (error)` sites already have logging |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ES2022 target | Language | Already configured with `strict: true` |
| Vitest | (project default) | Test runner | 197 existing tests, excluded from tsconfig |

### Supporting
No new libraries needed. This phase modifies existing code only.

## Architecture Patterns

### TS-01: noUncheckedIndexedAccess Fix Patterns

**Error breakdown by file (60 total):**

| File | Errors | Primary Pattern |
|------|--------|-----------------|
| `src/indexer/elixir.ts` | 18 | Regex match groups (`match[1]`, `match[2]`), array-by-index |
| `src/indexer/pipeline.ts` | 15 | Parallel array indexing (`workItems[i]`, `settled[i]`) |
| `src/indexer/proto.ts` | 9 | Regex match groups |
| `src/indexer/events.ts` | 8 | Regex match groups |
| `src/indexer/graphql.ts` | 5 | Regex match groups |
| `src/indexer/catalog.ts` | 5 | Regex match groups, array `.map()` with `idMatch[1]` |

**Fix strategy by pattern:**

**Pattern A -- Regex match groups (majority of errors):**
Regex `.exec()` returns `RegExpExecArray | null`. The while-loop already checks for null at the loop level, but individual capture groups (`match[1]`, `match[2]`) are typed as `string | undefined` with this flag. Since these regexes have guaranteed capture groups (not optional), the correct fix is a non-null assertion (`match[1]!`) or a guard-and-continue:
```typescript
// Before:
const name = match[1];  // string | undefined
// After (preferred -- guard + continue):
const name = match[1];
if (!name) continue;
// After (acceptable for known-good captures):
const name = match[1]!;
```
Prefer guard-and-continue for robustness. Use `!` only when the capture group is structurally guaranteed by the regex (e.g., `(\w+)` cannot fail to capture if the regex matched).

**Pattern B -- Parallel array indexing in pipeline.ts:**
The `for (let i = 0; i < settled.length; i++)` loop accesses `workItems[i]` and `settled[i]`. These are structurally guaranteed to be in-bounds since both arrays have the same length. Fix with non-null assertion:
```typescript
const item = workItems[i]!;
const result = settled[i]!;
```
Then the `result.status === 'fulfilled'` check needs a type narrowing adjustment -- with `result` no longer possibly undefined, the existing narrowing via `if (result.status === 'fulfilled')` should work, but `result.value` and `result.reason` need `PromiseFulfilledResult<T>` / `PromiseRejectedResult` narrowing, which the status check already provides.

**Pattern C -- Array-by-index in elixir.ts:**
```typescript
// modulePositions[i] and modulePositions[i+1]
const { name, start } = modulePositions[i]!;
const end = i + 1 < modulePositions.length
  ? modulePositions[i + 1]!.start
  : content.length;
```

**Pattern D -- Record literal indexing (catalog.ts):**
`.map()` returning `idMatch[1]` where idMatch is `RegExpMatchArray | null`. Already guarded with ternary `idMatch ? idMatch[1] : s` but the `[1]` is now `string | undefined`. Fix: `idMatch ? idMatch[1]! : s` or add a fallback.

### TS-02: Dead Code Removal

**Confirmed dead:** `getChangedFiles(repoPath, sinceCommit)` at `git.ts:25-71`
- Exported from `git.ts` (named export)
- Re-exported from `src/index.ts:24`
- Zero internal callers (grep confirms only definition + re-export)
- `pipeline.ts:7` imports `getChangedFilesSinceBranch` (the branch-based variant) instead
- The function was superseded in Phase 6 when pipeline switched to branch-based indexing

**Removal scope:**
1. Delete `getChangedFiles` function body from `git.ts` (lines 25-71)
2. Remove `getChangedFiles` from the export in `src/index.ts:24`
3. No other files reference it

### TS-03: Dependencies Upstream/Downstream Symmetry

**Current structure in `dependencies.ts:105-184`:**

`findLinkedRepos()` has an if/else on `direction` with mirror-image logic:
- Upstream: `consumedEdgesStmt` -> iterate events -> `producerEdgesStmt` -> resolve repos -> label with `MECHANISM_LABELS['consumes_event']`
- Downstream: `producedEdgesStmt` -> iterate events -> `consumerEdgesStmt` -> resolve repos -> label with `MECHANISM_LABELS['produces_event']`

The 6 prepared statements are already hoisted above the if/else. The body differs only in which statements are used and which mechanism label is applied.

**Parameterized extraction:**
```typescript
function findLinkedRepos(
  db: Database.Database,
  repoId: number,
  direction: 'upstream' | 'downstream',
): LinkedRepo[] {
  // Hoist prepared statements (unchanged)
  // ...

  const sourceEdgesStmt = direction === 'upstream' ? consumedEdgesStmt : producedEdgesStmt;
  const targetEdgesStmt = direction === 'upstream' ? producerEdgesStmt : consumerEdgesStmt;
  const mechanismLabel = direction === 'upstream' ? 'consumes_event' : 'produces_event';

  // Single traversal loop (replaces both branches)
  const edges = sourceEdgesStmt.all(repoId) as Array<{ target_id: number; relationship_type: string }>;

  for (const edge of edges) {
    const event = eventNameStmt.get(edge.target_id) as { name: string } | undefined;
    if (!event) continue;

    const targetEdges = targetEdgesStmt.all(edge.target_id) as Array<{ source_id: number }>;
    for (const target of targetEdges) {
      const repo = repoByIdStmt.get(target.source_id) as { id: number; name: string } | undefined;
      if (!repo) continue;

      results.push({
        repoId: repo.id,
        repoName: repo.name,
        eventName: event.name,
        mechanism: `${MECHANISM_LABELS[mechanismLabel]} (${event.name})`,
      });
    }
  }
  return results;
}
```

This collapses ~80 lines of if/else into ~20 lines of parameterized logic. The `MECHANISM_LABELS` record access (`MECHANISM_LABELS[mechanismLabel]`) will be `string | undefined` with `noUncheckedIndexedAccess` enabled -- handle with `!` since the keys are known-good string literals from the const record.

### TS-04: Silent Catch Blocks

**29 bare `catch {}` blocks across src/:**

| File | Count | Context | Verdict |
|------|-------|---------|---------|
| `git.ts` | 11 | All `execSync` calls for git commands | Intentionally silent -- git failures are expected (not a repo, branch missing, commit GC'd). Add inline comments. |
| `catalog.ts` | 7 | File read failures for MDX parsing | Intentionally silent -- skip unreadable catalog files. Add inline comments. |
| `metadata.ts` | 4 | File reads for README/mix.exs/package.json | Intentionally silent -- corrupted files still allow partial extraction. Already have inline comments on 2 of 4. |
| `events.ts` | 1 | File read failure during extraction | Intentionally silent -- skip unreadable files. Add inline comment. |
| `graphql.ts` | 1 | File read failure | Intentionally silent. Add inline comment. |
| `elixir.ts` | 1 | File read failure | Intentionally silent. Add inline comment. |
| `proto.ts` | 1 | File read failure | Intentionally silent. Add inline comment. |
| `fts.ts` | 2 | FTS query syntax fallback | Intentionally silent -- the outer try catches syntax errors and retries as phrase match, the inner catch returns empty array. Add inline comments. |
| `status.ts` | 1 | Table existence check | Intentionally silent -- table may not exist yet. Already commented. |

**5 `catch (error)` blocks (already logging):**

| File | Lines | Status |
|------|-------|--------|
| `pipeline.ts` | 343, 372, 397, 407 | Already logs structured `error.message` -- compliant |
| `handler.ts` | 20 | Already returns structured error via `wrapToolHandler` -- compliant |

**Strategy:** All 29 bare catch blocks are intentionally silent for legitimate reasons. None need to add error logging -- they just need inline documentation explaining why silence is correct. The `metadata.ts` catches at lines 181 and 201 already have comments (`/* corrupted mix.exs */`, `/* corrupted package.json */`). The remaining 27 need brief comments added.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Regex match safety | Custom wrapper around RegExp | Guard-and-continue or `!` assertion | TypeScript's narrowing handles it; wrappers add indirection |
| Array bounds checking | Runtime bounds checks | `noUncheckedIndexedAccess` + `!` for known-safe access | Compile-time safety is strictly better than runtime checks for this codebase |

## Common Pitfalls

### Pitfall 1: Over-using Non-null Assertions
**What goes wrong:** Littering `!` everywhere defeats the purpose of `noUncheckedIndexedAccess`
**Why it happens:** It's the fastest way to silence errors
**How to avoid:** Prefer guard-and-continue for loop bodies. Use `!` only for structurally-guaranteed access (parallel arrays of known equal length, regex groups that are non-optional).
**Warning signs:** More than 2-3 `!` per function body

### Pitfall 2: Breaking Public API Exports
**What goes wrong:** Removing `getChangedFiles` from `index.ts` could break external consumers
**Why it happens:** The function is part of the public API surface
**How to avoid:** This is a CLI tool, not a library consumed by others. The export exists for completeness, not external use. Removal is safe -- verify with grep.

### Pitfall 3: MECHANISM_LABELS Record Access After noUncheckedIndexedAccess
**What goes wrong:** `MECHANISM_LABELS[key]` becomes `string | undefined` even when the key is a known-good string literal
**Why it happens:** Record indexing returns `T | undefined` with the flag enabled
**How to avoid:** Use `MECHANISM_LABELS[key]!` when the key is a const literal, or use `MECHANISM_LABELS[key] ?? key` as a safe fallback.

### Pitfall 4: Test Breakage from Refactoring
**What goes wrong:** Changing function signatures or removing exports could break tests
**Why it happens:** Tests may import directly from changed modules
**How to avoid:** Tests import from `src/` paths. Check that no test imports `getChangedFiles`. Run full test suite after each change.

## Code Examples

### Regex Match Group Guard Pattern
```typescript
// Pattern used throughout indexer files after noUncheckedIndexedAccess
while ((match = someRegex.exec(content)) !== null) {
  const captured = match[1];
  if (!captured) continue;  // satisfies T | undefined
  // use captured safely as string
}
```

### Parallel Array Assertion Pattern
```typescript
// pipeline.ts: workItems and settled are structurally parallel
for (let i = 0; i < settled.length; i++) {
  const item = workItems[i]!;    // safe: same length as settled
  const result = settled[i]!;    // safe: iterating within bounds
  // ...
}
```

### Intentional Silent Catch Documentation
```typescript
// git.ts pattern: bare catch with inline justification
try {
  execSync('git rev-parse HEAD', { ... });
  return sha;
} catch {
  // Expected: directory is not a git repo or git is not installed
  return null;
}
```

### Parameterized Direction Pattern
```typescript
// dependencies.ts: single function replaces upstream/downstream branches
const sourceEdgesStmt = direction === 'upstream' ? consumedEdgesStmt : producedEdgesStmt;
const targetEdgesStmt = direction === 'upstream' ? producerEdgesStmt : consumerEdgesStmt;
const mechanismKey = direction === 'upstream' ? 'consumes_event' : 'produces_event';
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `strict: true` alone | `strict: true` + `noUncheckedIndexedAccess` | TS 4.1 (2020) | Catches array/record undefined access at compile time |
| Bare `catch {}` blocks | Bare `catch {}` with inline documentation | ESLint best practice | No functional change; improves maintainability |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (latest) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run` |
| Full suite command | `npx vitest run` (197 tests) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TS-01 | Project compiles with noUncheckedIndexedAccess | build check | `npx tsc --noEmit` | N/A (compiler) |
| TS-01 | No regressions from undefined-handling fixes | unit/integration | `npx vitest run` | Existing 197 tests |
| TS-02 | getChangedFiles removed, no callers remain | grep check | `grep -r "getChangedFiles[^S]" src/` | N/A (grep) |
| TS-03 | Dependency queries return identical results | unit | `npx vitest run tests/search/dependencies.test.ts` | Existing tests |
| TS-04 | All catch blocks documented or logging | grep check | `grep -n "catch {" src/` + manual review | N/A (audit) |

### Sampling Rate
- **Per task commit:** `npx tsc --noEmit && npx vitest run`
- **Per wave merge:** `npx tsc --noEmit && npx vitest run`
- **Phase gate:** Full suite green + clean compile with noUncheckedIndexedAccess

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. The compiler itself is the primary validation tool for TS-01.

## Open Questions

None. All four requirements are fully scoped with clear implementation paths.

## Sources

### Primary (HIGH confidence)
- TypeScript compiler output: `npx tsc --noEmit --noUncheckedIndexedAccess` -- 60 errors across 6 files
- Direct source code inspection of all affected files
- Grep across `src/` for `getChangedFiles`, `catch` patterns, and array/record indexing

### Secondary (MEDIUM confidence)
- TypeScript handbook on `noUncheckedIndexedAccess` -- stable since TS 4.1, well-documented behavior

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, purely tsconfig + code changes
- Architecture: HIGH - all patterns verified against actual compiler output
- Pitfalls: HIGH - based on direct analysis of the codebase, not general advice

**Research date:** 2026-03-07
**Valid until:** Indefinite (TypeScript strictness flags are stable)
