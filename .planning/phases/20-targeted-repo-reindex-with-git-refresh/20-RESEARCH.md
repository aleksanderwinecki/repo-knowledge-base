# Phase 20: Targeted Repo Reindex with Git Refresh - Research

**Researched:** 2026-03-09
**Domain:** CLI/indexer pipeline, git operations, selective reindexing
**Confidence:** HIGH

## Summary

Phase 20 adds the ability to reindex specific repos (instead of all ~400) with an automatic git refresh step that fetches the latest code from the remote and updates the local default branch before indexing. This is a surgical extension of the existing indexing pipeline -- no new libraries, no schema changes, no new extraction logic.

The codebase already has `indexSingleRepo()` in `pipeline.ts` that indexes one repo at a time, and the MCP layer's `sync.ts` already calls it for stale repo re-indexing. The main gaps are: (1) CLI lacks `--repo` targeting, (2) no git fetch/pull step exists anywhere, and (3) MCP has no explicit reindex tool. All three are straightforward additions to existing patterns.

**Primary recommendation:** Add `--repo <name>` (repeatable) to `kb index`, add a `gitRefresh()` function to `src/indexer/git.ts` that does fetch + reset on the default branch, wire it into the pipeline before extraction, and optionally expose a `kb_reindex` MCP tool.

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| commander | ^14.0.3 | CLI parsing with `--repo` option | Already used, supports `.option()` with repeatable values |
| better-sqlite3 | ^12.0.0 | DB access for repo path lookup | Already used throughout |
| child_process (execSync) | Node built-in | Git commands (fetch, reset) | Already used in `src/indexer/git.ts` |
| p-limit | ^7.3.0 | Parallel execution | Already used in pipeline |

### No new dependencies needed

This phase requires zero new npm packages. All functionality is built on existing git.ts patterns (execSync with error handling) and existing pipeline.ts patterns (indexSingleRepo).

## Architecture Patterns

### Existing Code to Extend

**`src/indexer/git.ts`** -- Add `gitRefresh(repoPath, branch)`:
- `git fetch origin` to pull latest refs
- `git checkout <branch>` to ensure on default branch
- `git reset --hard origin/<branch>` to fast-forward local to remote
- Must handle: no remote configured, fetch failure, checkout failure
- Return type: `{ refreshed: boolean; error?: string }`

**`src/indexer/pipeline.ts`** -- Already has `indexSingleRepo()`:
- Takes `(db, repoPath, options, branch?)` -- exactly what we need
- The `IndexOptions` interface needs `repos?: string[]` and `refresh?: boolean`
- `indexAllRepos()` needs a filter path: if `options.repos` provided, filter `discoverRepos()` results

**`src/cli/commands/index-cmd.ts`** -- Add CLI options:
- `--repo <name>` (repeatable via commander's `.option('--repo <name...>')`)
- `--refresh` flag to trigger git fetch+reset before indexing
- When `--repo` specified without `--refresh`, just reindex those repos
- When `--repo` specified with `--refresh`, git refresh then reindex

**`src/indexer/scanner.ts`** -- `discoverRepos()` returns all repos under rootDir. The pipeline can filter by name post-discovery, or we can resolve repo paths from the DB's `repos.path` column for previously-indexed repos.

### Recommended Pattern: Repo Resolution

Two approaches for targeting repos by name:

1. **Filter discoverRepos() output** -- scan all dirs, filter by basename matching. Simple, but scans filesystem for all ~400 repos even to target one.
2. **Look up path from DB** -- query `repos` table for the path of a known repo. Fast, but fails for never-indexed repos.

**Recommendation:** Hybrid approach. First try DB lookup (fast path for known repos). If not found, fall back to `discoverRepos()` + filter (covers first-time indexing). This is the same pattern `sync.ts` uses (it reads `repos.path` from DB).

### Pattern: Git Refresh Safety

The git refresh step must be safe for repos where the user might have local changes:

```typescript
// Source: project's existing git.ts pattern
export function gitRefresh(
  repoPath: string,
  branch: string,
): { refreshed: boolean; error?: string } {
  try {
    // Fetch latest from remote
    execSync('git fetch origin', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000, // 30s timeout for network ops
    });

    // Check if we're on the right branch
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (currentBranch !== branch) {
      // Not on default branch -- check for dirty working tree
      const status = execSync('git status --porcelain', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (status) {
        return { refreshed: false, error: 'dirty working tree, skipping checkout' };
      }

      execSync(`git checkout ${branch}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    // Fast-forward to remote
    execSync(`git reset --hard origin/${branch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { refreshed: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { refreshed: false, error: msg };
  }
}
```

**Key design decision:** Since the indexer reads from git refs (`git show branch:file`), not the working tree, the refresh step updates the local branch ref to match origin. Even repos on feature branches get indexed correctly because `resolveDefaultBranch()` + `readBranchFile()` already read from the branch ref, not HEAD. But `git fetch` alone only updates `origin/main` -- the local `main` ref stays stale unless we also reset. So `git reset --hard origin/<branch>` is needed.

**Alternative:** Just `git fetch origin` and then index from `origin/<branch>` instead of `<branch>`. This avoids touching the local branch at all. However, this would require changing `resolveDefaultBranch()` to return `origin/main` which ripples through the entire codebase. Not worth it -- `reset --hard` on the default branch is the standard approach.

### Anti-Patterns to Avoid
- **git pull instead of fetch+reset:** `git pull` can trigger merge conflicts. `fetch` + `reset --hard` is always clean.
- **Modifying all extractors for refresh:** The refresh is a pre-step before the existing pipeline. Don't thread refresh logic into extractors.
- **Requiring --refresh with --repo:** They should be independent. `--repo` alone means "reindex these repos as-is." `--refresh` alone means "refresh all repos before indexing." Together means "refresh + reindex just these."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Git operations | Custom git protocol handling | `execSync('git ...')` | Already the project pattern, battle-tested in git.ts |
| CLI repeatable options | Custom arg parsing | Commander's variadic option `.option('--repo <names...>')` | Commander handles it natively |
| Repo path resolution | Filesystem walk for single repo | DB lookup + discoverRepos fallback | Fast path for common case |

## Common Pitfalls

### Pitfall 1: Network Timeout on git fetch
**What goes wrong:** `git fetch origin` hangs or takes too long on slow networks, blocking the entire pipeline.
**Why it happens:** Default execSync has no timeout. Some repos may have large remotes.
**How to avoid:** Set `timeout: 30000` (30s) on all network git operations. Return error gracefully on timeout.
**Warning signs:** Pipeline hangs with no output.

### Pitfall 2: Detached HEAD or Feature Branch
**What goes wrong:** Repo is on a feature branch or detached HEAD. `git reset --hard origin/main` would lose the user's position.
**Why it happens:** Developer was working in the repo and left it on a feature branch.
**How to avoid:** The indexer already reads from the branch ref (`git show main:file`), not the working tree. For refresh, fetch is always safe. The reset should only happen on the default branch, and only if the user is already on it OR explicitly requested `--refresh`. If on a different branch with a dirty tree, skip the checkout/reset and just fetch (the `origin/main` ref is updated, but we don't use it directly -- we use `main`). Actually, the simplest safe approach: always fetch, only reset if current branch == default branch OR working tree is clean.
**Warning signs:** User complains their feature branch was switched.

### Pitfall 3: No Remote Configured
**What goes wrong:** `git fetch origin` fails because there's no "origin" remote.
**Why it happens:** Locally-created repos, or repos cloned via unusual methods.
**How to avoid:** Catch the error, return `{ refreshed: false, error: 'no remote' }`, proceed with indexing from local state.
**Warning signs:** Error output during `git fetch`.

### Pitfall 4: Commander Repeatable Option Syntax
**What goes wrong:** Using `.option('--repo <name>', '...').` gives a single string. Using `--repo a --repo b` doesn't accumulate.
**Why it happens:** Commander's repeatable syntax requires either variadic (`<names...>`) or a custom argParser with accumulation.
**How to avoid:** Use `.option('--repo <name...>', 'repos to reindex')` for space-separated list, or use `.option('--repo <name>', '...', collect, [])` pattern for repeated flags. The variadic approach (`<name...>`) is simpler: `kb index --repo foo bar baz`.
**Warning signs:** Only first repo gets processed.

### Pitfall 5: Embedding Re-generation Scope
**What goes wrong:** After reindexing 1 repo with `--embed`, `generateAllEmbeddings()` regenerates embeddings for ALL entities, not just the targeted repo.
**Why it happens:** `generateAllEmbeddings(db, force)` scans all entities without embeddings (or all if force=true).
**How to avoid:** This is actually fine -- `generateAllEmbeddings` already only generates for entities missing embeddings (unless `--force`). After reindexing one repo, only that repo's entities will be missing embeddings. No change needed.

## Code Examples

### CLI Option Registration (Commander pattern from this project)
```typescript
// Source: existing src/cli/commands/index-cmd.ts pattern
program
  .command('index')
  .description('Index repos under root directory')
  .option('--root <path>', 'root directory to scan', defaultRoot)
  .option('--repo <names...>', 'specific repos to reindex (space-separated)')
  .option('--force', 'force re-index all repos', false)
  .option('--refresh', 'git fetch + reset to latest before indexing', false)
  .option('--embed', 'generate vector embeddings after indexing', false)
  .option('--timing', 'report timing to stderr', false)
  .action(async (opts) => { ... });
```

### Repo Filtering in Pipeline
```typescript
// Source: extending existing indexAllRepos pattern
export async function indexAllRepos(
  db: Database.Database,
  options: IndexOptions,
): Promise<IndexResult[]> {
  let repos = discoverRepos(options.rootDir);

  // Filter to targeted repos if specified
  if (options.repos && options.repos.length > 0) {
    const targetSet = new Set(options.repos);
    repos = repos.filter(r => targetSet.has(path.basename(r)));

    // Warn about repos not found on filesystem
    const foundNames = new Set(repos.map(r => path.basename(r)));
    for (const name of options.repos) {
      if (!foundNames.has(name)) {
        console.warn(`Repo not found: ${name}`);
      }
    }
  }

  // Git refresh step (before indexing)
  if (options.refresh) {
    for (const repoPath of repos) {
      const branch = resolveDefaultBranch(repoPath);
      if (branch) {
        const result = gitRefresh(repoPath, branch);
        if (!result.refreshed) {
          console.warn(`Git refresh failed for ${path.basename(repoPath)}: ${result.error}`);
        }
      }
    }
  }

  // ... rest of existing pipeline unchanged
}
```

### MCP Tool Registration (following existing pattern)
```typescript
// Source: following src/mcp/tools/search.ts pattern
import { z } from 'zod';

export function registerReindexTool(server: McpServer, db: Database.Database) {
  server.tool(
    'kb_reindex',
    'Reindex specific repos with optional git refresh',
    { repos: z.array(z.string()).describe('Repo names to reindex'), refresh: z.boolean().default(true) },
    wrapToolHandler('kb_reindex', async (args) => {
      // ... implementation
    }),
  );
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `kb index` reindexes all ~400 repos | Still the only option | Phase 20 fixes this | Users wait for full index when only 1 repo changed |
| No git refresh capability | repos.ts stores path, HEAD compared for staleness | Phase 6 (v1.1) | Staleness detection exists but no refresh mechanism |
| MCP auto-sync on query | `sync.ts` re-indexes stale repos found in results | Phase 5+ | Reactive, not proactive -- doesn't fetch from remote |

## Open Questions

1. **Should `--refresh` be the default when `--repo` is specified?**
   - What we know: The user's primary use case is "repo is stale, fetch fresh code, reindex"
   - What's unclear: Whether there are cases where you want `--repo` without refresh
   - Recommendation: Make `--refresh` opt-in (explicit flag). The user asked for both capabilities, and keeping them independent is more flexible. The MCP tool could default to refresh=true since AI agents always want fresh data.

2. **Should the MCP server expose a dedicated reindex tool?**
   - What we know: Current MCP has no explicit reindex capability. Auto-sync in `sync.ts` handles some staleness reactively.
   - What's unclear: Whether AI agents need to proactively trigger reindexing.
   - Recommendation: Add `kb_reindex` MCP tool. It's a natural complement to the existing tools and lets agents refresh data when they know it's stale.

3. **Handling repos not yet indexed (first-time --repo targeting)?**
   - What we know: `discoverRepos()` finds all repos in rootDir by filesystem scan. DB lookup only works for previously-indexed repos.
   - What's unclear: Whether `--repo` should support never-indexed repos.
   - Recommendation: Use `discoverRepos()` + filter approach for `--repo`. It handles both known and unknown repos. The filesystem scan is fast enough (just readdir + stat, no git operations).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | vitest.config.ts |
| Quick run command | `npx vitest run tests/indexer/git.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RIDX-01 | `kb index --repo <name>` indexes only targeted repo | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "targeted"` | Needs new tests |
| RIDX-02 | `gitRefresh()` fetches + resets to latest on default branch | unit | `npx vitest run tests/indexer/git.test.ts -t "gitRefresh"` | Needs new tests |
| RIDX-03 | `--refresh` flag triggers git refresh before indexing | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "refresh"` | Needs new tests |
| RIDX-04 | Git refresh handles errors gracefully (no remote, dirty tree) | unit | `npx vitest run tests/indexer/git.test.ts -t "refresh"` | Needs new tests |
| RIDX-05 | MCP `kb_reindex` tool accepts repo names and triggers reindex | unit | `npx vitest run tests/mcp/tools.test.ts -t "reindex"` | Needs new tests |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/indexer/git.test.ts tests/indexer/pipeline.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New tests in `tests/indexer/git.test.ts` for gitRefresh() function
- [ ] New tests in `tests/indexer/pipeline.test.ts` for targeted repo filtering
- [ ] New tests in `tests/mcp/tools.test.ts` for kb_reindex MCP tool (if implemented)
- [ ] No new fixtures needed -- existing `createGitRepo()` helpers + temp dirs sufficient

## Sources

### Primary (HIGH confidence)
- Project source code: `src/indexer/git.ts`, `src/indexer/pipeline.ts`, `src/indexer/scanner.ts` -- direct inspection of current implementation
- Project source code: `src/cli/commands/index-cmd.ts` -- current CLI option pattern
- Project source code: `src/mcp/server.ts`, `src/mcp/sync.ts` -- current MCP tool registration and auto-sync pattern
- Project tests: `tests/indexer/git.test.ts`, `tests/indexer/pipeline.test.ts` -- existing test patterns and helpers

### Secondary (MEDIUM confidence)
- Commander.js variadic options -- `.option('--name <values...>')` syntax for space-separated repeated values
- Git porcelain commands -- `git fetch origin`, `git reset --hard origin/<branch>` are standard and well-documented

### Tertiary (LOW confidence)
- None. All findings verified against project source code.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero new dependencies, pure extension of existing patterns
- Architecture: HIGH -- all extension points clearly identified in source code, `indexSingleRepo` already exists
- Pitfalls: HIGH -- git edge cases are well-known, project already handles most via try/catch patterns in git.ts

**Research date:** 2026-03-09
**Valid until:** 2026-04-09 (stable -- no external dependencies involved)
