# Phase 6: Branch-Aware Tracking & Schema Migration - Research

**Researched:** 2026-03-06
**Domain:** Git plumbing commands for branch-aware file reading, SQLite schema migration
**Confidence:** HIGH

## Summary

This phase has two distinct workstreams: (1) making the indexer read from main/master branch instead of the working tree, and (2) migrating the database schema from v2 to v3 with columns needed by upcoming v1.1 extractors.

The branch-aware tracking requires replacing `git rev-parse HEAD` with `git rev-parse refs/heads/main` (falling back to `refs/heads/master`), replacing `fs.readFileSync` with `git show branch:path`, and replacing `fs.readdirSync`-based file discovery with `git ls-tree -r --name-only branch`. This is a meaningful refactor because the file reading abstraction permeates all extractors (elixir.ts, proto.ts, events.ts, metadata.ts).

The schema migration is straightforward — SQLite `ALTER TABLE ADD COLUMN` statements wrapped in the existing migration transaction pattern. The existing `migrations.ts` already handles this cleanly.

**Primary recommendation:** Build a git file-reading abstraction layer (`src/indexer/git-reader.ts`) that the extractors call instead of `fs` directly. This keeps the branch logic centralized and lets Phase 8's new extractors use the same API from day one.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Fallback chain: try `main`, then `master`, then skip the repo
- Do NOT fall back to HEAD — if default branch can't be determined, skip entirely
- Skip warning is minimal: just state the problem, no fix suggestions
- Read file content from the default branch ref using `git show` / `git cat-file` — never touch the working tree
- No stash/checkout/restore — non-disruptive reads only
- Only main and master supported — hard-coded
- No per-repo config, no --branch flag, no support for develop/trunk
- Single v2->v3 migration containing all new columns at once
- Extend existing tables (repos, modules, services, events) — no new tables
- `repos`: add `default_branch` column
- `modules`: add columns for Ecto schema metadata (table name, fields)
- `services`: add type discriminator for GraphQL/gRPC service types
- `events`: add columns for EventCatalog enrichment (domain, owner_team)
- `edges`: no changes
- Automatic and silent migration — matches v1->v2 behavior
- Always implicit on any DB access (no explicit `kb migrate`)
- After migration, first index run auto-detects and populates `default_branch`
- No --force required after migration
- On migration failure: print error + tell user to delete DB and rebuild
- No schema version in `kb status` output

### Claude's Discretion
- Exact column definitions and data types for new columns
- How to read files via `git show` vs `git cat-file` (implementation detail)
- How extractors in Phase 8 will use the new columns (this phase just adds them)
- Transaction/savepoint strategy for migration safety
- Whether to re-detect default_branch on every run or only when null

### Deferred Ideas (OUT OF SCOPE)
- Per-repo branch override (--branch flag)
- Support for develop/trunk branch names
- Schema version in `kb status` output
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IDX2-01 | Indexer tracks only `main`/`master` branch commit SHA, ignoring checked-out PR branches | Git plumbing commands for branch resolution (`git rev-parse --verify refs/heads/main`), file listing (`git ls-tree`), and content reading (`git show branch:path`) — see Architecture Patterns |
| IDX2-05 | Schema migration (v3) adds columns/tables needed for new extractors | SQLite ALTER TABLE ADD COLUMN pattern within existing migration framework — see Schema Migration section |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.0.0 | SQLite driver | Already in use; synchronous API makes migrations trivial |
| child_process (execSync) | Node built-in | Git command execution | Already the pattern in `src/indexer/git.ts` |

### Supporting
No new dependencies needed. All git operations use built-in `execSync`. All schema changes use `ALTER TABLE ADD COLUMN` which better-sqlite3 handles natively.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `git show branch:path` | `git cat-file blob branch:path` | `git show` is simpler for single files; `cat-file` is lower-level but equivalent. Both work. `git show` is more readable in code. |
| `git ls-tree -r` for file discovery | `git diff-tree` | `ls-tree` gives the full file list from a branch; `diff-tree` only gives differences. For full-index runs, `ls-tree` is what we need. |

## Architecture Patterns

### Git Plumbing Commands Reference

These are the exact commands needed, verified against git documentation:

**Branch resolution (determine default branch):**
```bash
# Returns commit SHA if branch exists, exit code 0
# Returns error exit code 128 if branch doesn't exist
git rev-parse --verify refs/heads/main

# Fallback
git rev-parse --verify refs/heads/master
```

**Get tip commit of a branch (replaces `git rev-parse HEAD`):**
```bash
git rev-parse refs/heads/main
# Returns 40-char SHA, e.g., abc123...
```

**List all files on a branch (replaces `fs.readdirSync` recursive):**
```bash
git ls-tree -r --name-only main
# Returns newline-separated relative paths:
# lib/booking.ex
# lib/payment.ex
# proto/booking.proto
# mix.exs
```

**Read file content from a branch (replaces `fs.readFileSync`):**
```bash
git show main:lib/booking.ex
# Returns file content to stdout
```

**Changed files between commits on a branch (replaces `git diff ..HEAD`):**
```bash
git diff --name-status abc123..main
# Returns status + path, same format as current getChangedFiles
```

### Recommended Refactoring Approach

The key architectural decision: **introduce a `GitReader` abstraction** that encapsulates branch-aware file operations. All extractors currently use `fs` directly — they need to be changed to accept file content rather than reading it themselves.

**Approach: Content-provider pattern**

Instead of refactoring every extractor's internal file reading, provide the content from the pipeline level:

1. **`git.ts` gets new functions** for branch resolution, file listing, and content reading
2. **Pipeline orchestrates** — it resolves the branch, lists files, reads content, and passes content to extractors
3. **Extractors keep their parse functions** (`parseElixirFile`, `parseProtoFile`) which already accept `(path, content)` pairs
4. **File discovery moves to pipeline** using `git ls-tree` filtered by extension/path patterns

This works because the existing extractors already have a two-phase structure:
- `findExFiles()` / `findProtoFiles()` — file discovery (needs to change to `git ls-tree`)
- `parseElixirFile(path, content)` / `parseProtoFile(path, content)` — pure parsing (no change needed)

### Recommended New Functions in git.ts

```typescript
/**
 * Resolve the default branch for a repo.
 * Tries main, then master. Returns null if neither exists.
 */
export function resolveDefaultBranch(repoPath: string): string | null {
  for (const branch of ['main', 'master']) {
    try {
      execSync(`git rev-parse --verify refs/heads/${branch}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return branch;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Get the tip commit SHA for a specific branch.
 */
export function getBranchCommit(repoPath: string, branch: string): string | null {
  try {
    return execSync(`git rev-parse refs/heads/${branch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim() || null;
  } catch {
    return null;
  }
}

/**
 * List all files on a branch matching optional path prefixes and extensions.
 */
export function listBranchFiles(
  repoPath: string,
  branch: string,
): string[] {
  try {
    const output = execSync(`git ls-tree -r --name-only ${branch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024, // 10MB for large repos
    }).trim();
    return output ? output.split('\n') : [];
  } catch {
    return [];
  }
}

/**
 * Read file content from a branch without touching the working tree.
 */
export function readBranchFile(
  repoPath: string,
  branch: string,
  filePath: string,
): string | null {
  try {
    return execSync(`git show ${branch}:${filePath}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 500 * 1024, // 500KB matches existing MAX_FILE_SIZE
    });
  } catch {
    return null;
  }
}

/**
 * Get files changed between a commit and a branch tip.
 */
export function getChangedFilesSinceBranch(
  repoPath: string,
  sinceCommit: string,
  branch: string,
): { added: string[]; modified: string[]; deleted: string[] } {
  // Same logic as existing getChangedFiles but uses branch instead of HEAD
  try {
    const output = execSync(`git diff --name-status ${sinceCommit}..${branch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    // ... same parsing logic as existing getChangedFiles
  } catch {
    return { added: [], modified: [], deleted: [] };
  }
}
```

### How Extractors Change

**Current flow (reads working tree):**
```
extractElixirModules(repoPath)
  -> findExFiles(repoPath)          // fs.readdirSync
  -> fs.readFileSync(filePath)      // fs.readFileSync
  -> parseElixirFile(path, content) // pure parse
```

**New flow (reads from branch):**
```
// In pipeline.ts:
const branch = resolveDefaultBranch(repoPath);
const allFiles = listBranchFiles(repoPath, branch);
const exFiles = allFiles.filter(f => f.endsWith('.ex') && isUnderLib(f));

for (const file of exFiles) {
  const content = readBranchFile(repoPath, branch, file);
  if (content) {
    modules.push(...parseElixirFile(file, content));
  }
}
```

The parse functions (`parseElixirFile`, `parseProtoFile`) already accept `(filePath, content)` — they don't need to change. Only the **file discovery** and **file reading** paths change, and those move into the pipeline.

### Schema v3 Migration

**Recommended column definitions:**

```sql
-- repos: store detected default branch
ALTER TABLE repos ADD COLUMN default_branch TEXT;

-- modules: Ecto schema metadata for Phase 8 EXT-02
ALTER TABLE modules ADD COLUMN table_name TEXT;
ALTER TABLE modules ADD COLUMN schema_fields TEXT;  -- JSON array of field definitions

-- services: type discriminator for Phase 8 EXT-01, EXT-03
ALTER TABLE services ADD COLUMN service_type TEXT;  -- 'grpc' | 'graphql' | 'http' | null

-- events: EventCatalog enrichment for Phase 8 EXT-05
ALTER TABLE events ADD COLUMN domain TEXT;
ALTER TABLE events ADD COLUMN owner_team TEXT;
```

**Why these types:**
- `default_branch TEXT` — just stores "main" or "master", nullable (null = not yet detected)
- `table_name TEXT` — Ecto schema table name, already extracted by `extractSchemaTable()` in elixir.ts (currently returned but not persisted to its own column)
- `schema_fields TEXT` — JSON string of field definitions; keeps schema simple, avoids a separate fields table
- `service_type TEXT` — discriminator; nullable for existing services that predate the categorization
- `domain TEXT`, `owner_team TEXT` — simple nullable text; EventCatalog assigns these

### Migration Implementation

```typescript
function migrateToV3(db: Database.Database): void {
  db.exec(`
    ALTER TABLE repos ADD COLUMN default_branch TEXT;
    ALTER TABLE modules ADD COLUMN table_name TEXT;
    ALTER TABLE modules ADD COLUMN schema_fields TEXT;
    ALTER TABLE services ADD COLUMN service_type TEXT;
    ALTER TABLE events ADD COLUMN domain TEXT;
    ALTER TABLE events ADD COLUMN owner_team TEXT;
  `);
}
```

In `runMigrations()`, add:
```typescript
if (fromVersion < 3) {
  migrateToV3(db);
}
```

In `schema.ts`, change:
```typescript
export const SCHEMA_VERSION = 3;
```

### Writer Changes

`upsertRepo()` needs to persist `default_branch`:

```typescript
// Add to upsert statement
INSERT INTO repos (name, path, description, last_indexed_commit, default_branch)
VALUES (@name, @path, @description, @lastIndexedCommit, @defaultBranch)
ON CONFLICT(name) DO UPDATE SET
  path = @path,
  description = @description,
  last_indexed_commit = @lastIndexedCommit,
  default_branch = @defaultBranch,
  updated_at = datetime('now')
```

The `RepoMetadata` interface needs a `defaultBranch` field added.

### Anti-Patterns to Avoid
- **Don't shell-escape user input into git commands.** Branch names are hardcoded ("main"/"master") and file paths come from `git ls-tree` output, so injection isn't a concern — but never interpolate arbitrary strings into `execSync` calls.
- **Don't use `git checkout` or `git stash`.** The entire point is non-disruptive reads. `git show` and `git ls-tree` never modify the working tree.
- **Don't create a separate "git reader" class with state.** Plain functions matching the existing pattern in `git.ts` are simpler and testable.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Branch resolution logic | Custom remote-tracking branch detection | Hard-coded `main`/`master` with `git rev-parse --verify` | User decision: only two branches, skip if neither exists |
| File content from branch | Temporary checkout + read + restore | `git show branch:path` | Non-disruptive, atomic, no working tree mutation |
| File listing from branch | Walk working tree + filter | `git ls-tree -r --name-only branch` | Shows exactly what's committed on the branch, ignores local changes |
| Schema migration framework | Version tracking table, rollback support | Existing `pragma user_version` + `runMigrations()` pattern | Already works for v1->v2, just extend |

## Common Pitfalls

### Pitfall 1: Detached HEAD State
**What goes wrong:** `git rev-parse HEAD` works in detached HEAD, but `resolveDefaultBranch` should still work because it checks `refs/heads/main` not HEAD.
**Why it happens:** CI environments, `git checkout <sha>`, submodule updates.
**How to avoid:** Never reference HEAD. Always use `refs/heads/main` or `refs/heads/master` explicitly.
**Warning signs:** Tests pass locally but fail in CI where repos are often in detached HEAD.

### Pitfall 2: Bare Repos
**What goes wrong:** `git ls-tree` and `git show` work fine in bare repos, but `fs.existsSync(path.join(dirPath, '.git'))` in `scanner.ts` checks for a `.git` directory. Bare repos have no `.git` dir.
**Why it happens:** Some local setups might have bare clones.
**How to avoid:** Not a concern — scanner already filters for this, and the tool targets developer workstation repos which are never bare.

### Pitfall 3: Large git ls-tree Output
**What goes wrong:** A monorepo with 100k files will produce multi-MB output from `git ls-tree`.
**Why it happens:** `ls-tree -r` lists every file recursively.
**How to avoid:** Set `maxBuffer` on `execSync` (10MB is safe). The existing extractors already skip files > 500KB, so even if there are many files, individual reads are bounded.

### Pitfall 4: Shell Metacharacter in File Paths
**What goes wrong:** File paths with spaces or special characters in `git show branch:path` could fail.
**Why it happens:** Unusual file naming in repos.
**How to avoid:** Quote the entire `branch:path` argument. In `execSync`, pass the command as a string (which goes through shell), so use: `` `git show "${branch}:${filePath}"` ``. Or better — since branch is always "main"/"master" and paths come from `git ls-tree` output, this is low risk. But quoting is cheap insurance.

### Pitfall 5: Migration Failure Leaves Partial State
**What goes wrong:** If one ALTER TABLE succeeds but a subsequent one fails, the DB is in an inconsistent state.
**Why it happens:** Unlikely with ADD COLUMN (which is atomic per statement), but possible if the DB is corrupted or disk is full.
**How to avoid:** The existing pattern wraps all migrations in a single transaction (`db.transaction(() => {...})()`). SQLite's transactional DDL means all ALTER TABLEs either succeed together or roll back together. This is already handled.

### Pitfall 6: metadata.ts Reads README from Working Tree
**What goes wrong:** `extractDescription()` in metadata.ts uses `fs.readFileSync` to read README.md. After branch-aware changes, this should read from the branch too.
**Why it happens:** Easy to miss — it's not an "extractor" in the traditional sense, but it reads repo files.
**How to avoid:** Convert `extractMetadata()` to accept branch-aware file reading, or have the pipeline pass README content to it. Same for `detectTechStack()` and `detectKeyFiles()`.

## Code Examples

### Testing Branch Resolution (using temp git repos)

```typescript
// Test helper: create a repo with a specific branch name
function createRepoWithBranch(name: string, branchName: string, files: Record<string, string>): string {
  const repoDir = path.join(tmpDir, 'repos', name);
  fs.mkdirSync(repoDir, { recursive: true });

  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: repoDir, stdio: 'pipe' });

  // Rename default branch
  execSync(`git branch -m ${branchName}`, { cwd: repoDir, stdio: 'pipe' });

  return repoDir;
}

// Test: indexing from main while on a feature branch
it('indexes from main branch content, not feature branch', () => {
  const repoDir = createRepoWithBranch('branch-test', 'main', {
    'mix.exs': 'defmodule BranchTest.MixProject do\nend',
    'lib/original.ex': 'defmodule BranchTest.Original do\nend',
  });

  // Create feature branch with different content
  execSync('git checkout -b feature/new-stuff', { cwd: repoDir, stdio: 'pipe' });
  fs.writeFileSync(path.join(repoDir, 'lib', 'feature.ex'), 'defmodule BranchTest.Feature do\nend');
  execSync('git add -A && git commit -m "feature"', { cwd: repoDir, stdio: 'pipe' });

  // Index while on feature branch — should get main content only
  const stats = indexSingleRepo(db, repoDir, { force: true, rootDir: tmpDir });

  expect(stats.modules).toBe(1); // Only Original, not Feature

  const modules = db.prepare(
    "SELECT name FROM modules WHERE repo_id = (SELECT id FROM repos WHERE name = 'branch-test')"
  ).all() as { name: string }[];
  expect(modules.map(m => m.name)).toEqual(['BranchTest.Original']);
});
```

### Testing Schema Migration (v2 -> v3)

```typescript
it('migrates v2 database to v3 preserving data', () => {
  // Create a v2 database manually
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Run v1 + v2 migrations manually
  migrateToV1(db);
  migrateToV2(db);
  db.pragma('user_version = 2');

  // Insert v2 data
  db.prepare("INSERT INTO repos (name, path) VALUES ('test-repo', '/tmp/test')").run();
  db.prepare("INSERT INTO modules (repo_id, name, type) VALUES (1, 'TestModule', 'module')").run();
  db.close();

  // Reopen — should auto-migrate to v3
  const db2 = openDatabase(dbPath);

  // Verify version
  expect(db2.pragma('user_version', { simple: true })).toBe(3);

  // Verify new columns exist
  const repoColumns = db2.pragma('table_info(repos)').map(c => c.name);
  expect(repoColumns).toContain('default_branch');

  const moduleColumns = db2.pragma('table_info(modules)').map(c => c.name);
  expect(moduleColumns).toContain('table_name');
  expect(moduleColumns).toContain('schema_fields');

  // Verify old data preserved
  const repo = db2.prepare("SELECT name FROM repos WHERE name = 'test-repo'").get();
  expect(repo).toBeDefined();

  db2.close();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `git rev-parse HEAD` for commit tracking | `git rev-parse refs/heads/main` for branch-specific tracking | This phase | Ignores feature branch commits, always tracks default branch |
| `fs.readFileSync` for file content | `git show branch:path` | This phase | Reads committed content from correct branch, ignores working tree |
| `fs.readdirSync` for file discovery | `git ls-tree -r --name-only branch` | This phase | Discovers files from branch tree, not working directory |
| Schema v2 (base tables + learned_facts) | Schema v3 (+ branch tracking + extractor columns) | This phase | Infrastructure for Phase 8 extractors |

## Open Questions

1. **Re-detect default_branch on every run or only when null?**
   - What we know: First run populates it, subsequent runs could skip detection.
   - What's unclear: What if someone renames their branch from master to main between runs?
   - Recommendation: Re-detect on every run. The cost is two `git rev-parse --verify` calls per repo (~1ms each) — negligible. Storing it is for audit/debugging, not caching.

2. **Should metadata.ts reading (README, mix.exs for tech stack) also use git show?**
   - What we know: metadata.ts reads README.md, mix.exs, package.json from the filesystem.
   - What's unclear: Is it worth the effort to convert these too, or are they unlikely to differ between branches?
   - Recommendation: Yes, convert them. The whole point is "index from main regardless of checkout state." A feature branch might modify package.json or README.md. Consistency matters.

3. **How to handle the `scanner.ts` project marker check with git show?**
   - What we know: `discoverRepos()` checks for mix.exs, package.json etc. using `fs.existsSync`.
   - What's unclear: Should discovery also be branch-aware?
   - Recommendation: No. Discovery checks for `.git` directory existence and project markers — this determines "is this a repo?" which is a filesystem concern. The branch-aware reading only matters once we decide to index a repo. Scanner stays filesystem-based.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.x |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/indexer/git.test.ts tests/db/schema.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| IDX2-01a | resolveDefaultBranch returns "main" for repo with main branch | unit | `npx vitest run tests/indexer/git.test.ts -t "resolveDefaultBranch"` | No - Wave 0 |
| IDX2-01b | resolveDefaultBranch returns "master" when no main branch | unit | `npx vitest run tests/indexer/git.test.ts -t "resolveDefaultBranch"` | No - Wave 0 |
| IDX2-01c | resolveDefaultBranch returns null for non-standard branch names | unit | `npx vitest run tests/indexer/git.test.ts -t "resolveDefaultBranch"` | No - Wave 0 |
| IDX2-01d | getBranchCommit returns SHA for named branch, not HEAD | unit | `npx vitest run tests/indexer/git.test.ts -t "getBranchCommit"` | No - Wave 0 |
| IDX2-01e | readBranchFile reads content from branch, not working tree | unit | `npx vitest run tests/indexer/git.test.ts -t "readBranchFile"` | No - Wave 0 |
| IDX2-01f | listBranchFiles lists files from branch tree | unit | `npx vitest run tests/indexer/git.test.ts -t "listBranchFiles"` | No - Wave 0 |
| IDX2-01g | Pipeline indexes from main when checked out on feature branch | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "branch"` | No - Wave 0 |
| IDX2-01h | Pipeline skips repo with no main/master branch | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "skip"` | No - Wave 0 |
| IDX2-01i | Pipeline handles detached HEAD state | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "detached"` | No - Wave 0 |
| IDX2-05a | v2 -> v3 migration adds all new columns | unit | `npx vitest run tests/db/schema.test.ts -t "v3"` | No - Wave 0 |
| IDX2-05b | v2 -> v3 migration preserves existing data | unit | `npx vitest run tests/db/schema.test.ts -t "preserv"` | No - Wave 0 |
| IDX2-05c | Fresh database gets all v3 columns | unit | `npx vitest run tests/db/schema.test.ts -t "columns"` | Partial - existing test checks v2 columns |
| IDX2-05d | default_branch persisted and retrievable via writer | unit | `npx vitest run tests/indexer/writer.test.ts -t "default_branch"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/indexer/git.test.ts tests/db/schema.test.ts tests/indexer/pipeline.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] New test cases in `tests/indexer/git.test.ts` -- covers IDX2-01a through IDX2-01f (new git functions)
- [ ] New test cases in `tests/indexer/pipeline.test.ts` -- covers IDX2-01g through IDX2-01i (branch-aware pipeline)
- [ ] New test cases in `tests/db/schema.test.ts` -- covers IDX2-05a through IDX2-05c (v3 migration)
- [ ] New test cases in `tests/indexer/writer.test.ts` -- covers IDX2-05d (default_branch persistence)
- [ ] Update existing schema tests to expect v3 columns

## Sources

### Primary (HIGH confidence)
- [git-rev-parse docs](https://git-scm.com/docs/git-rev-parse) - branch verification with `--verify refs/heads/`
- [git-ls-tree docs](https://git-scm.com/docs/git-ls-tree) - recursive file listing from branch tree
- [git-diff docs](https://git-scm.com/docs/git-diff) - changed files between commits/branches
- [SQLite ALTER TABLE docs](https://sqlite.org/lang_altertable.html) - ADD COLUMN constraints and behavior
- Existing codebase: `src/db/migrations.ts`, `src/indexer/git.ts`, `src/indexer/pipeline.ts` - established patterns

### Secondary (MEDIUM confidence)
- [git-tower.com guide](https://www.git-tower.com/learn/git/faq/checkout-file-from-another-branch) - `git show branch:path` usage patterns
- [codegenes.net](https://www.codegenes.net/blog/is-there-a-better-way-to-find-out-if-a-local-git-branch-exists/) - branch existence checking best practices

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new dependencies, all git commands verified against official docs
- Architecture: HIGH - the content-provider pattern is well-understood; existing parse functions already accept `(path, content)` pairs
- Pitfalls: HIGH - identified from code review of all 4 extractors + metadata + pipeline + writer
- Schema migration: HIGH - SQLite ALTER TABLE ADD COLUMN is the simplest possible migration; existing transaction pattern handles atomicity

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable domain - git plumbing and SQLite ALTER TABLE don't change)
