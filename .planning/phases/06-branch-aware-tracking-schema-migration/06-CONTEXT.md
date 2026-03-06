# Phase 6: Branch-Aware Tracking & Schema Migration - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Repos are always indexed from main/master branch regardless of local checkout state. The database schema is migrated to v3 with columns/tables needed by all v1.1 extractors (GraphQL, gRPC, Ecto, EventCatalog). Existing v2 data is preserved. No new extractors in this phase — just the infrastructure they need.

</domain>

<decisions>
## Implementation Decisions

### Default branch resolution
- Fallback chain: try `main`, then `master`, then skip the repo
- Do NOT fall back to HEAD — if default branch can't be determined, skip entirely
- Skip warning is minimal: just state the problem, no fix suggestions
- Read file content from the default branch ref using `git show` / `git cat-file` — never touch the working tree
- No stash/checkout/restore — non-disruptive reads only

### Branch name support
- Only main and master supported — hard-coded
- No per-repo config, no --branch flag, no support for develop/trunk
- If a repo uses a non-standard default branch, the user renames the branch rather than configuring the tool

### Schema v3 design
- Single v2->v3 migration containing all new columns at once
- Extend existing tables rather than creating new ones:
  - `repos`: add `default_branch` column (stores detected branch name)
  - `modules`: add columns for Ecto schema metadata (table name, fields)
  - `services`: add type discriminator for GraphQL/gRPC service types
  - `events`: add columns for EventCatalog enrichment (domain, owner_team)
  - `edges`: no changes needed — already generic enough for Ecto associations
- Store `default_branch` in repos table alongside `last_indexed_commit` for debugging/audit

### Migration behavior
- Automatic and silent — matches v1->v2 behavior, no user prompt or log message
- Always implicit on any DB access (no explicit `kb migrate` command)
- After migration, first index run auto-detects and populates `default_branch` per repo
- No --force required after migration
- On migration failure: print error + tell user to delete DB and rebuild with `kb index --force`
- No schema version in `kb status` output

### Claude's Discretion
- Exact column definitions and data types for new columns
- How to read files via `git show` vs `git cat-file` (implementation detail)
- How extractors in Phase 8 will use the new columns (this phase just adds them)
- Transaction/savepoint strategy for migration safety
- Whether to re-detect default_branch on every run or only when null

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/db/schema.ts`: SCHEMA_VERSION constant + `initializeSchema()` — increment to 3, add migration
- `src/db/migrations.ts`: `runMigrations()` with pragma-based versioning — add v2->v3 migration block
- `src/indexer/git.ts`: `getCurrentCommit()`, `getChangedFiles()`, `isCommitReachable()` — extend with branch resolution functions
- `src/indexer/pipeline.ts`: Skip/incremental logic at lines 128-139 — update to use default branch commit instead of HEAD

### Established Patterns
- Schema migrations: check `fromVersion < N`, run ALTER TABLE in transaction
- Git utilities: `execSync()` with cwd, returns null on failure
- Pipeline: metadata extraction -> skip check -> incremental check -> extract -> persist -> update commit
- Tests: temp DB in `/tmp`, temp git repos with `mkdtempSync()`, cleanup in afterEach

### Integration Points
- `src/indexer/metadata.ts`: calls `getCurrentCommit()` — needs to call new branch-aware version instead
- `src/indexer/writer.ts`: `upsertRepo()` — needs to persist `default_branch` column
- `src/indexer/pipeline.ts`: incremental comparison — must compare against default branch tip, not HEAD
- `src/db/database.ts`: `openDatabase()` calls `initializeSchema()` — migration runs here automatically

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

- Per-repo branch override (--branch flag) — not needed, rename branch instead
- Support for develop/trunk branch names — not in scope
- Schema version in `kb status` output — decided against

</deferred>

---

*Phase: 06-branch-aware-tracking-schema-migration*
*Context gathered: 2026-03-06*
