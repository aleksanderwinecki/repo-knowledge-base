import type Database from 'better-sqlite3';
import path from 'path';
import { discoverRepos } from './scanner.js';
import { extractMetadata } from './metadata.js';
import type { RepoMetadata } from './metadata.js';
import { resolveDefaultBranch, getBranchCommit, getChangedFilesSinceBranch, isCommitReachable, listBranchFiles } from './git.js';
import { extractElixirModules } from './elixir.js';
import type { ElixirModule } from './elixir.js';
import { extractProtoDefinitions } from './proto.js';
import type { ProtoDefinition } from './proto.js';
import { detectEventRelationships } from './events.js';
import type { EventRelationship } from './events.js';
import { persistRepoData, persistSurgicalData } from './writer.js';
import type { ModuleData, EventData, EdgeData } from './writer.js';

/** Options for the indexing pipeline */
export interface IndexOptions {
  force: boolean;
  rootDir: string;
}

/** Stats for a single repo index operation */
export interface IndexStats {
  modules: number;
  protos: number;
  events: number;
}

/** Result of indexing a single repo */
export interface IndexResult {
  repo: string;
  status: 'success' | 'skipped' | 'error';
  mode?: 'full' | 'surgical' | 'skipped';
  stats?: IndexStats;
  error?: string;
  skipReason?: string;
}

/**
 * Index all repos under the root directory.
 * Returns results per repo with error isolation (IDX-07).
 * Resolves default branch (main/master) for each repo before indexing.
 */
export function indexAllRepos(
  db: Database.Database,
  options: IndexOptions,
): IndexResult[] {
  const repos = discoverRepos(options.rootDir);
  const results: IndexResult[] = [];

  for (const repoPath of repos) {
    const repoName = path.basename(repoPath);

    try {
      // Resolve default branch (main or master)
      const branch = resolveDefaultBranch(repoPath);
      if (!branch) {
        console.warn(`Skipping ${repoName}: no main or master branch`);
        results.push({ repo: repoName, status: 'skipped', mode: 'skipped', skipReason: 'no main or master branch' });
        continue;
      }

      // Check if we can skip (incremental indexing)
      if (!options.force) {
        const skipResult = checkSkip(db, repoPath, repoName, branch);
        if (skipResult) {
          results.push(skipResult);
          continue;
        }
      }

      // Index the repo
      const stats = indexSingleRepo(db, repoPath, options, branch);
      console.log(
        `Indexing ${repoName}... done (${stats.modules} modules, ${stats.protos} protos)`,
      );
      results.push({ repo: repoName, status: 'success', mode: stats.mode, stats });
    } catch (error) {
      const errorMsg =
        error instanceof Error ? error.message : String(error);
      console.error(`Indexing ${repoName}... ERROR: ${errorMsg}`);
      results.push({ repo: repoName, status: 'error', error: errorMsg });
    }
  }

  // Print summary
  const success = results.filter((r) => r.status === 'success').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errors = results.filter((r) => r.status === 'error').length;
  console.log(
    `\nIndexing complete: ${results.length} repos (${success} indexed, ${skipped} skipped, ${errors} errors)`,
  );

  return results;
}

/**
 * Check if a repo can be skipped (branch commit unchanged).
 * Compares against the default branch tip, not HEAD.
 */
function checkSkip(
  db: Database.Database,
  repoPath: string,
  repoName: string,
  branch: string,
): IndexResult | null {
  const row = db
    .prepare('SELECT last_indexed_commit FROM repos WHERE name = ?')
    .get(repoName) as { last_indexed_commit: string | null } | undefined;

  if (!row?.last_indexed_commit) return null; // New repo, can't skip

  const branchCommit = getBranchCommit(repoPath, branch);
  if (!branchCommit) return null; // Can't determine commit, re-index

  if (row.last_indexed_commit === branchCommit) {
    return {
      repo: repoName,
      status: 'skipped',
      mode: 'skipped',
      skipReason: 'no new commits',
    };
  }

  return null; // Commit changed, need to re-index
}

/**
 * Index a single repo from its default branch. Runs all extractors and persists results.
 * If branch is not provided, resolves it (used when called directly, not via indexAllRepos).
 *
 * Supports two modes:
 * - **full**: wipe all repo entities and re-insert from scratch
 * - **surgical**: only clear entities from changed files, leave others untouched
 *
 * Surgical mode is used when: not forced, commit is reachable, and the diff is small
 * (<=200 files changed AND <=50% of repo files). Otherwise falls back to full.
 */
export function indexSingleRepo(
  db: Database.Database,
  repoPath: string,
  options: IndexOptions,
  branch?: string,
): IndexStats & { mode: 'full' | 'surgical' } {
  // Resolve branch if not provided
  if (!branch) {
    branch = resolveDefaultBranch(repoPath) ?? undefined;
    if (!branch) {
      throw new Error('No main or master branch found');
    }
  }

  // Step 1: Extract metadata from branch
  const metadata = extractMetadata(repoPath, branch);
  const repoName = metadata.name;

  // Step 2: Determine indexing mode
  const existingRow = db
    .prepare('SELECT id, last_indexed_commit FROM repos WHERE name = ?')
    .get(repoName) as
    | { id: number; last_indexed_commit: string | null }
    | undefined;

  const isIncremental =
    !options.force &&
    existingRow?.last_indexed_commit &&
    metadata.currentCommit &&
    existingRow.last_indexed_commit !== metadata.currentCommit &&
    isCommitReachable(repoPath, existingRow.last_indexed_commit);

  // Step 3: Determine surgical vs full mode
  let useSurgical = false;
  let changes: { added: string[]; modified: string[]; deleted: string[] } | null = null;

  if (isIncremental && existingRow) {
    changes = getChangedFilesSinceBranch(
      repoPath,
      existingRow.last_indexed_commit!,
      branch,
    );
    const totalChanged = changes.added.length + changes.modified.length + changes.deleted.length;
    const allFiles = listBranchFiles(repoPath, branch);
    const changeRatio = totalChanged / Math.max(allFiles.length, 1);
    useSurgical = totalChanged > 0 && totalChanged <= 200 && changeRatio <= 0.5;
  }

  // Step 4: Run extractors (all branch-aware) -- needed for both modes
  const elixirModules = extractElixirModules(repoPath, branch);
  const protoDefinitions = extractProtoDefinitions(repoPath, branch);

  if (useSurgical && changes && existingRow) {
    // === SURGICAL MODE ===
    const allChangedFiles = [...changes.added, ...changes.modified, ...changes.deleted];

    // Filter to changed files only for persistence
    const changedSet = new Set([...changes.added, ...changes.modified]);
    const surgicalModules: ModuleData[] = elixirModules
      .filter(m => changedSet.has(m.filePath))
      .map(mod => ({ name: mod.name, type: mod.type, filePath: mod.filePath, summary: mod.moduledoc }));
    const surgicalEvents: EventData[] = protoDefinitions
      .filter(p => changedSet.has(p.filePath))
      .flatMap(proto => proto.messages.map(msg => ({
        name: msg.name,
        schemaDefinition: `message ${msg.name} { ${msg.fields.map(f => `${f.type} ${f.name}`).join('; ')} }`,
        sourceFile: proto.filePath,
      })));

    // Persist surgical data (clears changed files, inserts new entities, clears all edges)
    persistSurgicalData(db, {
      repoId: existingRow.id,
      metadata,
      changedFiles: allChangedFiles,
      modules: surgicalModules,
      events: surgicalEvents,
    });

    // Re-derive ALL edges from full extractor output (not just changed files)
    const eventRelationships = detectEventRelationships(repoPath, branch, protoDefinitions, elixirModules);
    if (eventRelationships.length > 0) {
      insertEventEdges(db, existingRow.id, eventRelationships);
    }

    return {
      modules: elixirModules.length,
      protos: protoDefinitions.reduce((sum, p) => sum + p.messages.length, 0),
      events: eventRelationships.length,
      mode: 'surgical' as const,
    };
  }

  // === FULL MODE ===

  // Map extractor output to writer format
  const modules: ModuleData[] = elixirModules.map((mod) => ({
    name: mod.name,
    type: mod.type,
    filePath: mod.filePath,
    summary: mod.moduledoc,
  }));

  const events: EventData[] = protoDefinitions.flatMap((proto) =>
    proto.messages.map((msg) => ({
      name: msg.name,
      schemaDefinition: `message ${msg.name} { ${msg.fields.map((f) => `${f.type} ${f.name}`).join('; ')} }`,
      sourceFile: proto.filePath,
    })),
  );

  const eventRelationships = detectEventRelationships(
    repoPath,
    branch,
    protoDefinitions,
    elixirModules,
  );

  // Full persist: wipe all repo entities and re-insert
  const { repoId } = persistRepoData(db, {
    metadata,
    modules,
    events,
  });

  // Insert edges based on event relationships
  if (eventRelationships.length > 0) {
    insertEventEdges(db, repoId, eventRelationships);
  }

  return {
    modules: elixirModules.length,
    protos: protoDefinitions.reduce((sum, p) => sum + p.messages.length, 0),
    events: eventRelationships.length,
    mode: 'full' as const,
  };
}

/**
 * Insert edges for event relationships.
 * Resolves entity IDs from the database.
 * For consumer relationships, creates event entities if they don't exist
 * (consumer event names may differ from producer proto message names).
 */
function insertEventEdges(
  db: Database.Database,
  repoId: number,
  relationships: EventRelationship[],
): void {
  const insertEdge = db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertEvent = db.prepare(
    'INSERT INTO events (name, schema_definition, source_file, repo_id) VALUES (?, ?, ?, ?)',
  );

  for (const rel of relationships) {
    // Find the event entity by name (same repo first, then cross-repo)
    let event = db
      .prepare('SELECT id FROM events WHERE name = ? AND repo_id = ?')
      .get(rel.eventName, repoId) as { id: number } | undefined;

    if (!event) {
      event = db
        .prepare('SELECT id FROM events WHERE name = ?')
        .get(rel.eventName) as { id: number } | undefined;
    }

    // For consumers: create event entity if it doesn't exist
    // (consumer names may be topic names or Elixir schema aliases)
    if (!event && rel.type === 'consumes_event') {
      const result = insertEvent.run(
        rel.eventName,
        `consumed: ${rel.eventName}`,
        rel.sourceFile,
        repoId,
      );
      event = { id: Number(result.lastInsertRowid) };
    }

    if (!event) continue;

    insertEdge.run(
      'repo',
      repoId,
      'event',
      event.id,
      rel.type,
      rel.sourceFile,
    );
  }
}
