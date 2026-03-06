# Phase 7: Surgical File-Level Indexing - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Incremental re-indexing processes only files that changed since the last indexed commit. When a single file changes, only that file's entities are re-extracted — not the entire repo. Deleted files have their entities and FTS entries cleaned up. `kb index --force` remains the full wipe-and-rewrite recovery path. After surgical re-indexing, search results must be identical to what a full `--force` re-index would produce.

</domain>

<decisions>
## Implementation Decisions

### Fallback strategy
- Unreachable commit (force-push rewrote history): silent automatic full re-index, no user action needed. isCommitReachable() already exists.
- Large diff threshold: if changed files exceed a threshold (e.g., 50% of repo files or 200+ files), silently fall back to full re-index. Large diffs are often rebases/merges where full is faster anyway.
- `--force` always does full wipe-and-rewrite (current behavior preserved). It's the "nuclear option" recovery path.
- No runtime consistency verification. Trust the implementation, test suite covers correctness (surgical vs full comparison tests).

### Index output/reporting
- Console output stays the same: 'Indexing repo-name... done (X modules, Y protos)'. No differentiation between surgical and full mode.
- Add `mode: 'full' | 'surgical' | 'skipped'` to IndexResult for programmatic consumers (tests, MCP).
- Summary line stays unchanged: 'N repos (X indexed, Y skipped, Z errors)'. No surgical/full breakdown.
- Fallback to full re-index is silent — no log message, no warning.

### Cross-file edge handling
- After surgical file extraction, recalculate ALL edges repo-wide by re-running detectEventRelationships() on all branch files.
- Clear ALL repo edges before recalculation (clean slate, no orphans).
- detectEventRelationships() reads all .ex files from the branch (not from DB state) — edges are derived from file content.
- Cross-repo edges are NOT affected. Only same-repo edges are recalculated during surgical indexing. Current behavior.

### Modified file strategy
- Wipe-and-rewrite per file: clearRepoFiles(db, repoId, [changedFile]) then re-extract and insert. Reuses existing clearRepoFiles(). Simple, correct.
- Added files use the same code path as modified files (clearRepoFiles is a no-op for new files).
- Extractors keep current signatures — pipeline calls extractors on all branch files, then only persists entities from changed files. Extractors stay untouched.
- Strict file_id tracking: every module and event must have a file_id linking to the files table. Events currently use source_file (text path) — needs migration to file_id FK for surgical cleanup to work reliably.

### Claude's Discretion
- Exact threshold numbers for fallback (50% of files, 200+ files, etc.)
- Whether to use a single transaction for the entire surgical update or per-file transactions
- How to refactor persistRepoData to support surgical mode vs full mode internally
- File_id migration approach for events table

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `clearRepoFiles(db, repoId, filePaths)` in writer.ts: already handles per-file entity + FTS cleanup for modules and events
- `getChangedFilesSinceBranch(repoPath, sinceCommit, branch)` in git.ts: returns `{added, modified, deleted}` file lists
- `isCommitReachable(repoPath, commitSha)` in git.ts: detects unreachable commits for fallback trigger
- `parseElixirFile(filePath, content)` / `parseProtoFile(filePath, content)`: pure functions that extract from individual files — no refactoring needed

### Established Patterns
- Pipeline flow: metadata → skip check → incremental check → extract → persist → update commit
- Transaction wrapping: persistRepoData uses db.transaction() for atomic writes
- FTS sync: indexEntity/removeEntity called alongside INSERT/DELETE for every entity

### Integration Points
- `pipeline.ts:indexSingleRepo()`: main refactor target — needs surgical vs full branching after skip check
- `pipeline.ts:isIncremental`: already partially implemented — detects changed commits but still does full extraction
- `writer.ts:persistRepoData()`: currently always calls clearRepoEntities() — needs surgical path that only clears changed files
- `writer.ts:clearRepoFiles()`: already works but needs to also handle events via file_id (currently uses source_file text match)

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

*Phase: 07-surgical-file-level-indexing*
*Context gathered: 2026-03-06*
