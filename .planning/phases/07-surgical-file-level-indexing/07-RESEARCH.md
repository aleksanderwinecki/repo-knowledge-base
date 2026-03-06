# Phase 7: Surgical File-Level Indexing - Research

**Researched:** 2026-03-06
**Domain:** Incremental file-level indexing with SQLite entity management
**Confidence:** HIGH

## Summary

This phase transforms the current "detect changes, still do full extraction" indexing into true surgical file-level re-indexing. The codebase already has most building blocks in place: `getChangedFilesSinceBranch()` returns `{added, modified, deleted}` file lists, `clearRepoFiles()` removes entities for specific files, `isCommitReachable()` detects unreachable commits for fallback, and the individual file parsers (`parseElixirFile`, `parseProtoFile`) are pure functions that work on single files. The `isIncremental` flag in `pipeline.ts` already detects when surgical mode is possible but currently only handles deleted files — added/modified files still trigger full extraction and full `clearRepoEntities()`.

The primary technical challenges are: (1) refactoring `persistRepoData()` to support a surgical path that only clears/inserts entities for changed files instead of calling `clearRepoEntities()`, (2) migrating the `events` table to use `file_id` FK instead of text `source_file` for reliable per-file cleanup, and (3) implementing edge recalculation that clears and re-derives all same-repo edges after surgical entity updates. The existing `clearRepoFiles()` in `writer.ts` already handles modules via `file_id` FK join but uses text-based `source_file` matching for events — this mismatch is the main schema gap.

**Primary recommendation:** Split the pipeline into a clear surgical vs full code path in `indexSingleRepo()`, add `file_id` column to events table (schema v4 migration), and create a new `persistSurgicalData()` function that handles per-file wipe-and-rewrite alongside repo-wide edge recalculation.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Fallback strategy:** Unreachable commit triggers silent automatic full re-index via `isCommitReachable()`. Large diff threshold (Claude's discretion on exact numbers) falls back to full. `--force` always does full wipe-and-rewrite. No runtime consistency verification.
- **Index output/reporting:** Console output unchanged. Add `mode: 'full' | 'surgical' | 'skipped'` to IndexResult. Summary line unchanged. Fallback to full is silent.
- **Cross-file edge handling:** After surgical file extraction, recalculate ALL edges repo-wide by re-running `detectEventRelationships()` on all branch files. Clear ALL repo edges before recalculation. `detectEventRelationships()` reads from branch, not DB. Cross-repo edges not affected.
- **Modified file strategy:** Wipe-and-rewrite per file via `clearRepoFiles()`. Added files use same path. Extractors keep current signatures. Strict `file_id` tracking: events need migration from `source_file` text to `file_id` FK.

### Claude's Discretion
- Exact threshold numbers for fallback (50% of files, 200+ files, etc.)
- Whether to use a single transaction for the entire surgical update or per-file transactions
- How to refactor persistRepoData to support surgical mode vs full mode internally
- File_id migration approach for events table

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| IDX2-02 | Re-indexing surgically processes only files changed since last indexed commit (no full wipe-and-rewrite) | Pipeline refactoring to add surgical path using `getChangedFilesSinceBranch()` + per-file extraction + `clearRepoFiles()` per changed file |
| IDX2-03 | Deleted files detected via `git diff` and their entities/FTS entries cleaned up | Already partially implemented — `clearRepoFiles()` exists and handles modules+events+edges+files table cleanup. Needs `file_id` on events for reliable cleanup. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| better-sqlite3 | ^12.0.0 | SQLite database, transactions | Already in use, synchronous API ideal for surgical updates |
| vitest | ^3.0.0 | Test framework | Already in use, 197 existing tests |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (no new libraries) | - | - | All work is internal refactoring of existing code |

No new dependencies needed. This phase is purely internal refactoring of existing pipeline, writer, and schema code.

## Architecture Patterns

### Current Pipeline Flow (Full Mode)
```
indexSingleRepo()
  1. extractMetadata(repoPath, branch)
  2. Check isIncremental (currently only used for deleted file cleanup)
  3. Handle deleted files via clearRepoFiles()
  4. Run ALL extractors on ALL branch files
  5. persistRepoData() → clearRepoEntities() → insert ALL
  6. insertEventEdges() → insert ALL edges
```

### Target Pipeline Flow (Surgical Mode)
```
indexSingleRepo()
  1. extractMetadata(repoPath, branch)
  2. Determine mode: force→full, no prior commit→full, unreachable commit→full,
     large diff→full, otherwise→surgical
  3. IF surgical:
     a. getChangedFilesSinceBranch() → {added, modified, deleted}
     b. clearRepoFiles(db, repoId, [...deleted, ...modified, ...added])
     c. Extract entities from ONLY changed files (filter extractors)
     d. persistSurgicalData() → insert only new entities for changed files
     e. Clear ALL repo edges, re-run detectEventRelationships() on ALL files
     f. Re-insert ALL edges
  4. IF full:
     a. (current behavior — clearRepoEntities + extract all + persist all)
  5. Update last_indexed_commit
```

### Key Refactoring Pattern: Surgical persistRepoData

The current `persistRepoData()` always calls `clearRepoEntities(repoId)` which wipes everything. For surgical mode, we need a path that:

1. Only clears entities from changed files (via `clearRepoFiles`)
2. Inserts entities only for changed files (modules, events, files)
3. Clears ALL repo edges (clean slate for edge recalculation)
4. Re-inserts ALL edges from fresh `detectEventRelationships()` output

**Recommended approach:** Create a separate `persistSurgicalData()` function rather than adding mode branching inside `persistRepoData()`. Keeps the existing full-mode path untouched and testable.

```typescript
// New function signature
export function persistSurgicalData(
  db: Database.Database,
  data: {
    repoId: number;
    metadata: RepoMetadata;
    changedFiles: string[];   // files to clear and re-insert
    modules: ModuleData[];    // entities extracted from changed files only
    events: EventData[];      // entities extracted from changed files only
  }
): void;
```

### Schema Migration Pattern (v4): Add file_id to events

```sql
-- V4 migration: Add file_id FK to events for surgical cleanup
ALTER TABLE events ADD COLUMN file_id INTEGER REFERENCES files(id) ON DELETE SET NULL;
```

After migration, events INSERT must populate `file_id` by looking up or creating the file record (same pattern modules already use). The `clearRepoFiles()` function should then use `file_id` for event cleanup instead of `source_file` text matching.

**Keep `source_file` column:** Don't remove it — it's used by search/entity.ts for display and by `insertEventEdges()` for edge source_file tracking. `file_id` is for cleanup; `source_file` is for display.

### Extractor Filtering Pattern

Extractors currently scan ALL branch files. For surgical mode, they still need to run on individual files. Two approaches:

**Approach A (Recommended):** Run extractors on all branch files (unchanged), then filter output to only include entities from changed files before persisting. Simple, zero extractor changes.

```typescript
const allModules = extractElixirModules(repoPath, branch);
const changedModules = allModules.filter(m => changedFileSet.has(m.filePath));
```

**Why this works:** Extractors are fast (regex-based, typically <100ms). The git I/O for `readBranchFile` per file is the real cost, but `listBranchFiles` is already called once and cached. The filtering is trivial.

**Why not per-file extraction:** The extractors call `listBranchFiles()` + `readBranchFile()` internally for every file. Refactoring them to accept a file list would save I/O but adds complexity for marginal benefit. The context decision says "Extractors keep current signatures."

**Approach B (Optimize later if needed):** Pass file filter to extractors. Only worth it if repos have 10,000+ files and surgical indexing of 1 file triggers reading all 10,000.

### Edge Recalculation Pattern

Per the locked decision: after surgical entity updates, clear ALL repo edges and recalculate from scratch.

```typescript
// 1. Clear all repo edges
db.prepare("DELETE FROM edges WHERE (source_type = 'repo' AND source_id = ?)").run(repoId);

// 2. Re-run edge detection on ALL branch files
const eventRelationships = detectEventRelationships(repoPath, branch, protoDefinitions, elixirModules);

// 3. Re-insert all edges
insertEventEdges(db, repoId, eventRelationships);
```

**Critical detail:** `detectEventRelationships()` needs ALL proto definitions and ALL elixir modules (not just changed ones) because edges are derived from the full set. So for surgical mode, we still run extractors on all files to get the complete module/proto lists for edge detection, but only persist entities from changed files.

This means the surgical flow is:
1. Extract ALL modules and protos (for edge detection)
2. Filter to changed-file entities (for persistence)
3. Clear changed files + insert filtered entities
4. Clear ALL edges + re-derive ALL edges using full extractor output

### Single Transaction Pattern

**Recommendation:** Use a single transaction wrapping the entire surgical update. Reasons:
- SQLite writes are serialized anyway (single writer)
- A single transaction is faster (one journal sync vs N)
- Atomicity: either the surgical update fully succeeds or fully rolls back
- Consistent with existing `persistRepoData()` which uses `db.transaction()`

### Anti-Patterns to Avoid
- **Partial commit updates:** Never update `last_indexed_commit` before the surgical operation completes. If it fails mid-way, the next run should re-try the same diff.
- **Mixing surgical and full cleanup:** Don't call `clearRepoEntities()` in surgical mode — that wipes everything. Use `clearRepoFiles()` for specific files only.
- **Edge orphans from text matching:** Don't rely on `source_file` text matching for edge cleanup — edges can reference files that aren't in the changed set. Clear ALL repo edges instead.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Changed file detection | Custom file watcher or mtime tracking | `git diff --name-status` via `getChangedFilesSinceBranch()` | Git is authoritative, already handles renames, symlinks, submodules |
| Commit reachability | Try/catch around git diff | `isCommitReachable()` via `git cat-file -t` | Clean boolean check, handles GC'd commits, force-pushes |
| File-to-entity mapping | Custom file tracking table | `files` table + `file_id` FK | Already exists for modules, just needs extension to events |
| FTS sync | Manual FTS INSERT/DELETE | `indexEntity()` / `removeEntity()` | Already handles tokenization, dedup, delete-before-insert |

## Common Pitfalls

### Pitfall 1: Events Without file_id Cause Orphans
**What goes wrong:** `clearRepoFiles()` uses `source_file` text match for events. If the source_file path format differs between extractor output and DB storage (e.g., trailing slash, normalization), events survive cleanup and become orphans.
**Why it happens:** Modules use `file_id` FK (reliable integer join), but events use `source_file` text (fragile string comparison).
**How to avoid:** Add `file_id` to events table (v4 migration). Update `clearRepoFiles()` to use `file_id` join for events. Keep `source_file` for backward compat and display.
**Warning signs:** After surgical re-index, `SELECT COUNT(*) FROM events` is higher than after a `--force` full re-index.

### Pitfall 2: Edge Orphans After Surgical Update
**What goes wrong:** Edges reference entity IDs. If a module is deleted during surgical cleanup but its edge still exists, the edge points to a non-existent entity.
**Why it happens:** Edges don't have FK constraints (polymorphic edge table).
**How to avoid:** Clear ALL repo edges before recalculation (locked decision). Don't try to surgically update edges — always do full edge recalculation.
**Warning signs:** Entity card queries return edges with null/missing target names.

### Pitfall 3: Large Diff Degrades Performance
**What goes wrong:** A rebase or large merge creates a diff with hundreds of changed files. Surgical mode processes each one individually, which can be slower than a full re-index.
**Why it happens:** Per-file `clearRepoFiles()` + insert is O(n) DB operations vs full mode's O(1) `clearRepoEntities()`.
**How to avoid:** Implement the large-diff threshold fallback. If changed files > threshold, silently fall back to full mode.
**Warning signs:** `kb index` takes longer after a rebase than after initial indexing.

### Pitfall 4: consumer-created events in insertEventEdges
**What goes wrong:** `insertEventEdges()` creates new event records for consumers when no matching producer event exists. During surgical re-indexing, these consumer-created events might get orphaned or duplicated.
**Why it happens:** Consumer events are inserted by `insertEventEdges()`, not by the normal event persistence path. They don't go through `persistSurgicalData()`.
**How to avoid:** Since edges are fully recalculated (clear all + re-insert), consumer-created events from the previous indexing will be orphaned. `insertEventEdges()` must handle this — either clean up consumer-only events before edge recalculation, or let the edge recalculation re-create them as needed. The safest approach: during edge clear, also delete events that were created by consumers (identifiable by `schema_definition` starting with `'consumed:'`).
**Warning signs:** Duplicate event records after multiple surgical re-indexes.

### Pitfall 5: Transaction Scope vs extractors
**What goes wrong:** Wrapping extractor calls (which do git I/O) inside a DB transaction holds the write lock for the entire extraction duration.
**Why it happens:** Trying to make the whole surgical pipeline atomic.
**How to avoid:** Extract first (outside transaction), then wrap only the DB operations (clear + insert + edge recalculation) in a transaction. Extractors don't touch the DB.

## Code Examples

### Surgical Mode Detection in indexSingleRepo

```typescript
// After existing isIncremental check
const changes = getChangedFilesSinceBranch(repoPath, existingRow.last_indexed_commit!, branch);
const totalChanged = changes.added.length + changes.modified.length + changes.deleted.length;

// Fallback thresholds
const allBranchFiles = listBranchFiles(repoPath, branch);
const changeRatio = totalChanged / Math.max(allBranchFiles.length, 1);
const useSurgical = totalChanged > 0 && totalChanged <= 200 && changeRatio <= 0.5;
```

### Per-File Entity Extraction (Filter Approach)

```typescript
// Run extractors normally (they scan all branch files)
const allElixirModules = extractElixirModules(repoPath, branch);
const allProtoDefinitions = extractProtoDefinitions(repoPath, branch);

// Filter to only changed files for persistence
const changedSet = new Set([...changes.added, ...changes.modified]);
const surgicalModules = allElixirModules.filter(m => changedSet.has(m.filePath));
const surgicalProtos = allProtoDefinitions.filter(p => changedSet.has(p.filePath));

// But use ALL extractors output for edge detection
const eventRelationships = detectEventRelationships(repoPath, branch, allProtoDefinitions, allElixirModules);
```

### Schema V4 Migration

```typescript
function migrateToV4(db: Database.Database): void {
  db.exec(`
    ALTER TABLE events ADD COLUMN file_id INTEGER REFERENCES files(id) ON DELETE SET NULL;
  `);
}
```

### Updated clearRepoFiles with file_id for events

```typescript
// Current: text-based matching (fragile)
const events = db
  .prepare('SELECT id FROM events WHERE repo_id = ? AND source_file = ?')
  .all(repoId, filePath);

// Updated: file_id FK matching (reliable) with fallback
const events = db
  .prepare('SELECT id FROM events WHERE repo_id = ? AND file_id IN (SELECT id FROM files WHERE repo_id = ? AND path = ?)')
  .all(repoId, repoId, filePath);
```

### Surgical Persist Function (Skeleton)

```typescript
export function persistSurgicalData(
  db: Database.Database,
  data: {
    repoId: number;
    metadata: RepoMetadata;
    changedFiles: string[];
    modules: ModuleData[];
    events: EventData[];
  },
): void {
  const txn = db.transaction(() => {
    // 1. Update repo metadata (commit SHA, etc.)
    upsertRepo(db, data.metadata);

    // 2. Clear entities from changed files
    clearRepoFiles(db, data.repoId, data.changedFiles);

    // 3. Insert file records + modules for changed files
    for (const mod of data.modules) {
      const fileRow = insertFile.get(data.repoId, mod.filePath, null);
      const fileId = fileRow?.id ?? null;
      const modInfo = insertModule.run(data.repoId, fileId, mod.name, mod.type, mod.summary);
      indexEntity(db, { type: 'module', id: Number(modInfo.lastInsertRowid), name: mod.name, description: mod.summary });
    }

    // 4. Insert events for changed files (with file_id)
    for (const evt of data.events) {
      const fileRow = insertFile.get(data.repoId, evt.sourceFile, null);
      const fileId = fileRow?.id ?? null;
      const evtInfo = insertEvent.run(data.repoId, evt.name, evt.schemaDefinition, evt.sourceFile, fileId);
      indexEntity(db, { type: 'event', id: Number(evtInfo.lastInsertRowid), name: evt.name, description: evt.schemaDefinition });
    }

    // 5. Clear ALL repo edges (edges recalculated by caller)
    clearRepoEdges(db, data.repoId);
  });

  txn();
}
```

### Edge Cleanup Helper

```typescript
function clearRepoEdges(db: Database.Database, repoId: number): void {
  // Clear edges where repo is source
  db.prepare("DELETE FROM edges WHERE source_type = 'repo' AND source_id = ?").run(repoId);
  // Also clear service-sourced edges for this repo's services
  db.prepare(
    "DELETE FROM edges WHERE source_type = 'service' AND source_id IN (SELECT id FROM services WHERE repo_id = ?)"
  ).run(repoId);
  // Clean up consumer-created events (will be re-created by insertEventEdges if still needed)
  const consumerEvents = db
    .prepare("SELECT id FROM events WHERE repo_id = ? AND schema_definition LIKE 'consumed:%'")
    .all(repoId) as { id: number }[];
  for (const evt of consumerEvents) {
    removeEntity(db, 'event', evt.id);
    db.prepare('DELETE FROM events WHERE id = ?').run(evt.id);
  }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No incremental detection | `isIncremental` flag detects changes but still does full extraction | Phase 6 (v1.1) | Half-way state: detects diffs, only handles deletes |
| `clearRepoEntities()` always | `clearRepoFiles()` for specific files | Phase 6 (v1.1) | Building block exists but not used for add/modify |
| HEAD-based commit tracking | Branch-based commit tracking | Phase 6 (v1.1) | Accurate diffs against default branch |

## Open Questions

1. **Consumer-created events during edge recalculation**
   - What we know: `insertEventEdges()` creates event records for consumers when no producer event exists (lines 253-260 of pipeline.ts). These have `schema_definition` like `'consumed: EventName'`.
   - What's unclear: After clearing all edges and consumer-created events, then re-running `insertEventEdges()`, will the new consumer events get different IDs? This could break any external references to event IDs.
   - Recommendation: Accept ID instability for consumer-created events. They're synthetic records, not primary data. The FTS index will be updated correctly via `indexEntity()`/`removeEntity()`.

2. **File records for unchanged files**
   - What we know: `clearRepoFiles()` deletes the file record for cleared files. Surgical mode only clears changed files, so unchanged file records persist.
   - What's unclear: If a file record from a previous full index has stale data (e.g., old `summary`), will it cause issues?
   - Recommendation: Not a concern for v1.1. `files.summary` is always null currently (never populated). File records only store `path` and `language`.

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
| IDX2-02 | Single changed file -> only that file re-extracted | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "surgical"` | No - Wave 0 |
| IDX2-02 | Surgical mode produces same results as full mode | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "identical"` | No - Wave 0 |
| IDX2-02 | Large diff falls back to full mode silently | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "fallback"` | No - Wave 0 |
| IDX2-02 | Unreachable commit falls back to full mode | integration | `npx vitest run tests/indexer/pipeline.test.ts -t "unreachable"` | No - Wave 0 |
| IDX2-02 | IndexResult.mode reflects actual mode used | unit | `npx vitest run tests/indexer/pipeline.test.ts -t "mode"` | No - Wave 0 |
| IDX2-03 | Deleted file entities + FTS removed | integration | `npx vitest run tests/indexer/writer.test.ts -t "clearRepoFiles"` | Partial - needs file_id event tests |
| IDX2-03 | Events cleaned via file_id FK after migration | integration | `npx vitest run tests/indexer/writer.test.ts -t "file_id"` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/indexer/pipeline.test.ts tests/indexer/writer.test.ts tests/db/schema.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/indexer/pipeline.test.ts` -- new test cases for surgical mode, fallback detection, mode reporting, surgical-vs-full equivalence
- [ ] `tests/indexer/writer.test.ts` -- new test cases for `persistSurgicalData()`, `clearRepoFiles()` with `file_id` on events, edge cleanup
- [ ] `tests/db/schema.test.ts` -- v4 migration test (add `file_id` to events)

## Sources

### Primary (HIGH confidence)
- Direct codebase analysis: `src/indexer/pipeline.ts`, `src/indexer/writer.ts`, `src/indexer/git.ts`, `src/db/migrations.ts`
- Direct codebase analysis: `src/indexer/elixir.ts`, `src/indexer/proto.ts`, `src/indexer/events.ts`
- Direct codebase analysis: `tests/indexer/pipeline.test.ts`, `tests/indexer/writer.test.ts`
- Phase 6 implementation artifacts (completed) - established patterns for branch-aware indexing

### Secondary (MEDIUM confidence)
- None needed -- all research is based on direct codebase analysis

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new libraries, purely internal refactoring
- Architecture: HIGH - all building blocks exist in codebase, patterns clear from Phase 6
- Pitfalls: HIGH - identified from direct code reading (events source_file vs file_id mismatch, consumer-created events, edge orphans)

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable internal codebase, no external dependency concerns)
