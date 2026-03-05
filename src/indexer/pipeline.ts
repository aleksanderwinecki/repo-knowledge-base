import type Database from 'better-sqlite3';
import path from 'path';
import { discoverRepos } from './scanner.js';
import { extractMetadata } from './metadata.js';
import type { RepoMetadata } from './metadata.js';
import { getCurrentCommit, getChangedFiles, isCommitReachable } from './git.js';
import { extractElixirModules } from './elixir.js';
import type { ElixirModule } from './elixir.js';
import { extractProtoDefinitions } from './proto.js';
import type { ProtoDefinition } from './proto.js';
import { detectEventRelationships } from './events.js';
import type { EventRelationship } from './events.js';
import { persistRepoData, clearRepoFiles } from './writer.js';
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
  stats?: IndexStats;
  error?: string;
  skipReason?: string;
}

/**
 * Index all repos under the root directory.
 * Returns results per repo with error isolation (IDX-07).
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
      // Check if we can skip (incremental indexing)
      if (!options.force) {
        const skipResult = checkSkip(db, repoPath, repoName);
        if (skipResult) {
          results.push(skipResult);
          continue;
        }
      }

      // Index the repo
      const stats = indexSingleRepo(db, repoPath, options);
      console.log(
        `Indexing ${repoName}... done (${stats.modules} modules, ${stats.protos} protos)`,
      );
      results.push({ repo: repoName, status: 'success', stats });
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
 * Check if a repo can be skipped (commit unchanged).
 */
function checkSkip(
  db: Database.Database,
  repoPath: string,
  repoName: string,
): IndexResult | null {
  const row = db
    .prepare('SELECT last_indexed_commit FROM repos WHERE name = ?')
    .get(repoName) as { last_indexed_commit: string | null } | undefined;

  if (!row?.last_indexed_commit) return null; // New repo, can't skip

  const currentCommit = getCurrentCommit(repoPath);
  if (!currentCommit) return null; // Can't determine commit, re-index

  if (row.last_indexed_commit === currentCommit) {
    return {
      repo: repoName,
      status: 'skipped',
      skipReason: 'no new commits',
    };
  }

  return null; // Commit changed, need to re-index
}

/**
 * Index a single repo. Runs all extractors and persists results.
 */
export function indexSingleRepo(
  db: Database.Database,
  repoPath: string,
  options: IndexOptions,
): IndexStats {
  // Step 1: Extract metadata
  const metadata = extractMetadata(repoPath);
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

  // Step 3: Handle incremental deleted files
  if (isIncremental && existingRow) {
    const changes = getChangedFiles(
      repoPath,
      existingRow.last_indexed_commit!,
    );
    if (changes.deleted.length > 0) {
      clearRepoFiles(db, existingRow.id, changes.deleted);
    }
  }

  // Step 4: Run extractors
  const elixirModules = extractElixirModules(repoPath);
  const protoDefinitions = extractProtoDefinitions(repoPath);
  const eventRelationships = detectEventRelationships(
    repoPath,
    protoDefinitions,
    elixirModules,
  );

  // Step 5: Map extractor output to writer format
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

  // Step 6: Build edges from event relationships
  // We need to resolve entity IDs after persistence, so we persist repo first,
  // then build edges based on the newly inserted entities.
  const { repoId } = persistRepoData(db, {
    metadata,
    modules,
    events,
  });

  // Now insert edges based on event relationships
  if (eventRelationships.length > 0) {
    insertEventEdges(db, repoId, eventRelationships);
  }

  return {
    modules: elixirModules.length,
    protos: protoDefinitions.reduce((sum, p) => sum + p.messages.length, 0),
    events: eventRelationships.length,
  };
}

/**
 * Insert edges for event relationships.
 * Resolves entity IDs from the database.
 */
function insertEventEdges(
  db: Database.Database,
  repoId: number,
  relationships: EventRelationship[],
): void {
  const insertEdge = db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  );

  for (const rel of relationships) {
    // Find the event entity by name
    const event = db
      .prepare('SELECT id FROM events WHERE name = ? AND repo_id = ?')
      .get(rel.eventName, repoId) as { id: number } | undefined;

    if (!event) {
      // Try cross-repo event lookup
      const crossEvent = db
        .prepare('SELECT id FROM events WHERE name = ?')
        .get(rel.eventName) as { id: number } | undefined;

      if (!crossEvent) continue; // Event not found anywhere, skip

      // For consumers: edge from repo -> event
      if (rel.type === 'consumes_event') {
        insertEdge.run(
          'repo',
          repoId,
          'event',
          crossEvent.id,
          rel.type,
          rel.sourceFile,
        );
      }
      continue;
    }

    if (rel.type === 'produces_event') {
      // Producer: repo -> event
      insertEdge.run(
        'repo',
        repoId,
        'event',
        event.id,
        rel.type,
        rel.sourceFile,
      );
    } else {
      // Consumer: repo -> event
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
}
