import type Database from 'better-sqlite3';
import path from 'path';
import pLimit from 'p-limit';
import { discoverRepos } from './scanner.js';
import { extractMetadata } from './metadata.js';
import type { RepoMetadata } from './metadata.js';
import { resolveDefaultBranch, getBranchCommit, getChangedFilesSinceBranch, isCommitReachable, listBranchFiles, gitRefresh } from './git.js';
import { extractElixirModules } from './elixir.js';
import type { ElixirModule } from './elixir.js';
import { extractProtoDefinitions } from './proto.js';
import type { ProtoDefinition } from './proto.js';
import { extractGraphqlDefinitions } from './graphql.js';
import { detectEventRelationships } from './events.js';
import type { EventRelationship } from './events.js';
import { persistRepoData, persistSurgicalData, insertTopologyEdges } from './writer.js';
import type { ModuleData, EventData, EdgeData, ServiceData } from './writer.js';
import { extractTopologyEdges } from './topology/index.js';
import type { TopologyEdge } from './topology/index.js';
import { enrichFromEventCatalog } from './catalog.js';
/** Options for the indexing pipeline */
export interface IndexOptions {
  force: boolean;
  rootDir: string;
  repos?: string[];
  refresh?: boolean;
}

/** Stats for a single repo index operation */
export interface IndexStats {
  modules: number;
  protos: number;
  events: number;
  services: number;
  graphqlTypes: number;
  topologyEdges: number;
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

/** Snapshot of DB state for a repo, captured before parallel extraction */
interface DbSnapshot {
  repoId?: number;
  lastCommit?: string | null;
}

/** All data extracted from a single repo (no DB dependency) */
interface ExtractedRepoData {
  repoName: string;
  repoPath: string;
  metadata: RepoMetadata;
  mode: 'full' | 'surgical';
  allModules: ModuleData[];
  events: EventData[];
  services: ServiceData[];
  elixirModules: ElixirModule[];
  protoDefinitions: ProtoDefinition[];
  eventRelationships: EventRelationship[];
  topologyEdges: TopologyEdge[];
  // Surgical-specific
  changedFiles?: string[];
  surgicalModules?: ModuleData[];
  surgicalEvents?: EventData[];
  existingRepoId?: number;
}

/** Work item for parallel extraction phase */
interface WorkItem {
  repoPath: string;
  repoName: string;
  branch: string;
  options: IndexOptions;
  dbSnapshot: DbSnapshot;
}

/**
 * Extract all repo data without any DB access.
 * Async because p-limit needs a Promise; internally uses execSync which
 * blocks this slot but not the event loop for other slots.
 */
async function extractRepoData(
  repoPath: string,
  options: IndexOptions,
  branch: string,
  dbSnapshot: DbSnapshot,
): Promise<ExtractedRepoData> {
  // Step 1: Extract metadata from branch
  const metadata = extractMetadata(repoPath, branch);
  const repoName = metadata.name;

  // Step 2: Determine indexing mode from snapshot
  const isIncremental =
    !options.force &&
    dbSnapshot.lastCommit &&
    metadata.currentCommit &&
    dbSnapshot.lastCommit !== metadata.currentCommit &&
    isCommitReachable(repoPath, dbSnapshot.lastCommit);

  // Step 3: Determine surgical vs full mode
  let useSurgical = false;
  let changes: { added: string[]; modified: string[]; deleted: string[] } | null = null;

  if (isIncremental && dbSnapshot.repoId !== undefined) {
    changes = getChangedFilesSinceBranch(
      repoPath,
      dbSnapshot.lastCommit!,
      branch,
    );
    const totalChanged = changes.added.length + changes.modified.length + changes.deleted.length;
    const allFiles = listBranchFiles(repoPath, branch);
    const changeRatio = totalChanged / Math.max(allFiles.length, 1);
    useSurgical = totalChanged > 0 && totalChanged <= 200 && changeRatio <= 0.5;
  }

  // Step 4: Run extractors (all branch-aware)
  const elixirModules = extractElixirModules(repoPath, branch);
  const protoDefinitions = extractProtoDefinitions(repoPath, branch);
  const graphqlDefinitions = extractGraphqlDefinitions(repoPath, branch);

  // Map gRPC services from proto definitions (EXT-01)
  const services: ServiceData[] = protoDefinitions.flatMap((proto) =>
    proto.services.map((svc) => ({
      name: svc.name,
      description: `gRPC service with RPCs: ${svc.rpcs.map((r) => `${r.name}(${r.inputType}) -> ${r.outputType}`).join(', ')}`,
      serviceType: 'grpc',
    })),
  );

  // Map GraphQL types to modules (EXT-03)
  const graphqlModules: ModuleData[] = graphqlDefinitions.flatMap((def) =>
    def.types.map((t) => ({
      name: t.name,
      type: `graphql_${t.kind}`,
      filePath: def.filePath,
      summary: t.body || null,
    })),
  );

  // Map Elixir modules to writer format, including Ecto fields (EXT-02)
  const elixirModuleData: ModuleData[] = elixirModules.map((mod) => ({
    name: mod.name,
    type: mod.type,
    filePath: mod.filePath,
    summary: mod.moduledoc,
    tableName: mod.tableName,
    schemaFields: mod.schemaFields.length > 0 ? JSON.stringify(mod.schemaFields) : null,
  }));

  // Map Absinthe types to additional modules (EXT-04)
  const absintheModules: ModuleData[] = elixirModules.flatMap((mod) =>
    mod.absintheTypes.map((aType) => ({
      name: aType.name,
      type: `absinthe_${aType.kind}`,
      filePath: mod.filePath,
      summary: `Absinthe ${aType.kind} defined in ${mod.name}`,
    })),
  );

  // Combine all modules
  const allModules: ModuleData[] = [...elixirModuleData, ...graphqlModules, ...absintheModules];

  // Detect event relationships
  const eventRelationships = detectEventRelationships(repoPath, branch, protoDefinitions, elixirModules);

  // Extract topology edges (gRPC, HTTP, gateway, Kafka)
  const topologyEdges = extractTopologyEdges(repoPath, branch, elixirModules);

  if (useSurgical && changes && dbSnapshot.repoId !== undefined) {
    // === SURGICAL MODE ===
    const allChangedFiles = [...changes.added, ...changes.modified, ...changes.deleted];
    const changedSet = new Set([...changes.added, ...changes.modified]);

    const surgicalModules: ModuleData[] = allModules.filter(m => changedSet.has(m.filePath));

    const surgicalEvents: EventData[] = protoDefinitions
      .filter(p => changedSet.has(p.filePath))
      .flatMap(proto => proto.messages.map(msg => ({
        name: msg.name,
        schemaDefinition: `message ${msg.name} { ${msg.fields.map(f => `${f.type} ${f.name}`).join('; ')} }`,
        sourceFile: proto.filePath,
      })));

    return {
      repoName,
      repoPath,
      metadata,
      mode: 'surgical',
      allModules,
      events: [], // not used for surgical persist
      services,
      elixirModules,
      protoDefinitions,
      eventRelationships,
      topologyEdges,
      changedFiles: allChangedFiles,
      surgicalModules,
      surgicalEvents,
      existingRepoId: dbSnapshot.repoId,
    };
  }

  // === FULL MODE ===
  const events: EventData[] = protoDefinitions.flatMap((proto) =>
    proto.messages.map((msg) => ({
      name: msg.name,
      schemaDefinition: `message ${msg.name} { ${msg.fields.map((f) => `${f.type} ${f.name}`).join('; ')} }`,
      sourceFile: proto.filePath,
    })),
  );

  return {
    repoName,
    repoPath,
    metadata,
    mode: 'full',
    allModules,
    events,
    services,
    elixirModules,
    protoDefinitions,
    eventRelationships,
    topologyEdges,
  };
}

/**
 * Persist extracted repo data to the database.
 * Handles both full and surgical modes. Synchronous (better-sqlite3 is sync).
 */
function persistExtractedData(
  db: Database.Database,
  extracted: ExtractedRepoData,
): IndexStats & { mode: 'full' | 'surgical' } {
  const graphqlTypeCount = extracted.allModules.filter(m => m.type?.startsWith('graphql_')).length;

  if (extracted.mode === 'surgical' && extracted.changedFiles && extracted.existingRepoId !== undefined) {
    // Surgical persist
    persistSurgicalData(db, {
      repoId: extracted.existingRepoId,
      metadata: extracted.metadata,
      changedFiles: extracted.changedFiles,
      modules: extracted.surgicalModules ?? [],
      events: extracted.surgicalEvents ?? [],
      services: extracted.services,
    });

    // Re-derive ALL edges from full extractor output (not just changed files)
    if (extracted.eventRelationships.length > 0) {
      insertEventEdges(db, extracted.existingRepoId, extracted.eventRelationships);
    }

    insertTopologyEdges(db, extracted.existingRepoId, extracted.topologyEdges);
    insertEctoAssociationEdges(db, extracted.existingRepoId, extracted.elixirModules);

    return {
      modules: extracted.elixirModules.length,
      protos: extracted.protoDefinitions.reduce((sum, p) => sum + p.messages.length, 0),
      events: extracted.eventRelationships.length,
      services: extracted.services.length,
      graphqlTypes: graphqlTypeCount,
      topologyEdges: extracted.topologyEdges.length,
      mode: 'surgical' as const,
    };
  }

  // Full persist: wipe all repo entities and re-insert
  const { repoId } = persistRepoData(db, {
    metadata: extracted.metadata,
    modules: extracted.allModules,
    events: extracted.events,
    services: extracted.services,
  });

  // Insert edges based on event relationships
  if (extracted.eventRelationships.length > 0) {
    insertEventEdges(db, repoId, extracted.eventRelationships);
  }

  insertTopologyEdges(db, repoId, extracted.topologyEdges);
  insertEctoAssociationEdges(db, repoId, extracted.elixirModules);

  return {
    modules: extracted.elixirModules.length,
    protos: extracted.protoDefinitions.reduce((sum, p) => sum + p.messages.length, 0),
    events: extracted.eventRelationships.length,
    services: extracted.services.length,
    graphqlTypes: graphqlTypeCount,
    topologyEdges: extracted.topologyEdges.length,
    mode: 'full' as const,
  };
}

/**
 * Index all repos under the root directory.
 * Returns results per repo with error isolation (IDX-07).
 *
 * Three-phase pipeline:
 * - Phase 1 (sequential): Discover repos, resolve branches, check skips, snapshot DB state
 * - Phase 2 (parallel): Extract repo data concurrently via p-limit
 * - Phase 3 (sequential): Persist results serially for DB consistency
 *
 * Concurrency controlled by KB_CONCURRENCY env var (default: 4).
 * KB_CONCURRENCY=1 produces sequential behavior.
 */
export async function indexAllRepos(
  db: Database.Database,
  options: IndexOptions,
): Promise<IndexResult[]> {
  let repos = discoverRepos(options.rootDir);
  const results: IndexResult[] = [];
  const workItems: WorkItem[] = [];

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

  // Git refresh step (before indexing, so pipeline sees updated branch tips)
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

  // === Phase 1: Sequential preparation (all DB reads) ===
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

      // Snapshot DB state for this repo before parallel phase
      const existingRow = db
        .prepare('SELECT id, last_indexed_commit FROM repos WHERE name = ?')
        .get(repoName) as
        | { id: number; last_indexed_commit: string | null }
        | undefined;

      const dbSnapshot: DbSnapshot = {
        repoId: existingRow?.id,
        lastCommit: existingRow?.last_indexed_commit ?? null,
      };

      workItems.push({ repoPath, repoName, branch, options, dbSnapshot });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`Indexing ${repoName}... ERROR: ${errorMsg}`);
      results.push({ repo: repoName, status: 'error', error: errorMsg });
    }
  }

  // === Phase 2: Parallel extraction (no DB access) ===
  const concurrency = parseInt(process.env.KB_CONCURRENCY ?? '4', 10) || 4;
  const limit = pLimit(concurrency);

  const extractionPromises = workItems.map((item) =>
    limit(() => extractRepoData(item.repoPath, item.options, item.branch, item.dbSnapshot)),
  );

  const settled = await Promise.allSettled(extractionPromises);

  // === Phase 3: Serial persistence (DB writes) ===
  for (let i = 0; i < settled.length; i++) {
    const item = workItems[i]!;
    const result = settled[i]!;

    if (result.status === 'fulfilled') {
      try {
        const stats = persistExtractedData(db, result.value);
        console.log(
          `Indexing ${item.repoName}... done (${stats.modules} modules, ${stats.protos} protos)`,
        );
        results.push({ repo: item.repoName, status: 'success', mode: stats.mode, stats });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Indexing ${item.repoName}... ERROR: ${errorMsg}`);
        results.push({ repo: item.repoName, status: 'error', error: errorMsg });
      }
    } else {
      const errorMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.error(`Indexing ${item.repoName}... ERROR: ${errorMsg}`);
      results.push({ repo: item.repoName, status: 'error', error: errorMsg });
    }
  }

  // Print summary
  const success = results.filter((r) => r.status === 'success').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errors = results.filter((r) => r.status === 'error').length;
  console.log(
    `\nIndexing complete: ${results.length} repos (${success} indexed, ${skipped} skipped, ${errors} errors)`,
  );

  // Event Catalog enrichment: run after all repos indexed (EXT-05)
  // Only on full index runs when at least one repo was actually indexed
  if (success > 0) {
    try {
      enrichFromEventCatalog(db, options.rootDir);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`Event Catalog enrichment failed: ${errorMsg}`);
    }
  }

  // Post-index optimization: compact FTS and reclaim WAL space
  if (success > 0) {
    try {
      db.exec("INSERT INTO knowledge_fts(knowledge_fts) VALUES('optimize')");
    } catch (error) {
      // FTS optimize is best-effort; don't fail the pipeline
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`FTS optimize failed: ${msg}`);
    }
    db.pragma('wal_checkpoint(TRUNCATE)');
  }

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
 * Delegates to extractRepoData + persistExtractedData -- the same path used by indexAllRepos.
 * Async because extractRepoData returns a Promise (for p-limit compatibility in indexAllRepos).
 */
export async function indexSingleRepo(
  db: Database.Database,
  repoPath: string,
  options: IndexOptions,
  branch?: string,
): Promise<IndexStats & { mode: 'full' | 'surgical' }> {
  // Resolve branch if not provided
  if (!branch) {
    branch = resolveDefaultBranch(repoPath) ?? undefined;
    if (!branch) {
      throw new Error('No main or master branch found');
    }
  }

  // Build DB snapshot (same query as indexAllRepos Phase 1)
  const repoName = path.basename(repoPath);
  const existingRow = db
    .prepare('SELECT id, last_indexed_commit FROM repos WHERE name = ?')
    .get(repoName) as { id: number; last_indexed_commit: string | null } | undefined;

  const dbSnapshot: DbSnapshot = {
    repoId: existingRow?.id,
    lastCommit: existingRow?.last_indexed_commit ?? null,
  };

  // Delegate to shared extraction and persistence
  const extracted = await extractRepoData(repoPath, options, branch, dbSnapshot);
  return persistExtractedData(db, extracted);
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

/**
 * Insert Ecto association edges between modules.
 * For each module with associations, look up the target module by name
 * and create edges. Skips if target not found (cross-repo). (EXT-02)
 */
function insertEctoAssociationEdges(
  db: Database.Database,
  repoId: number,
  elixirModules: ElixirModule[],
): void {
  const insertEdge = db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  );

  for (const mod of elixirModules) {
    if (mod.associations.length === 0) continue;

    // Find the source module ID
    const sourceModule = db
      .prepare('SELECT id FROM modules WHERE repo_id = ? AND name = ?')
      .get(repoId, mod.name) as { id: number } | undefined;

    if (!sourceModule) continue;

    for (const assoc of mod.associations) {
      // Look up target module by name (same repo first, then any repo)
      let targetModule = db
        .prepare('SELECT id FROM modules WHERE repo_id = ? AND name = ?')
        .get(repoId, assoc.target) as { id: number } | undefined;

      if (!targetModule) {
        targetModule = db
          .prepare('SELECT id FROM modules WHERE name = ?')
          .get(assoc.target) as { id: number } | undefined;
      }

      if (!targetModule) continue; // Skip cross-repo targets not in DB

      insertEdge.run(
        'module',
        sourceModule.id,
        'module',
        targetModule.id,
        assoc.kind,
        mod.filePath,
      );
    }
  }
}
