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
import { extractGraphqlDefinitions } from './graphql.js';
import { detectEventRelationships } from './events.js';
import type { EventRelationship } from './events.js';
import { persistRepoData, persistSurgicalData } from './writer.js';
import type { ModuleData, EventData, EdgeData, ServiceData } from './writer.js';

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
  services: number;
  graphqlTypes: number;
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

  // Total GraphQL type count for stats
  const graphqlTypeCount = graphqlModules.length;

  if (useSurgical && changes && existingRow) {
    // === SURGICAL MODE ===
    const allChangedFiles = [...changes.added, ...changes.modified, ...changes.deleted];
    const changedSet = new Set([...changes.added, ...changes.modified]);

    // Filter modules to changed files only
    const surgicalModules: ModuleData[] = allModules.filter(m => changedSet.has(m.filePath));

    const surgicalEvents: EventData[] = protoDefinitions
      .filter(p => changedSet.has(p.filePath))
      .flatMap(proto => proto.messages.map(msg => ({
        name: msg.name,
        schemaDefinition: `message ${msg.name} { ${msg.fields.map(f => `${f.type} ${f.name}`).join('; ')} }`,
        sourceFile: proto.filePath,
      })));

    // Persist surgical data (clears changed files, inserts new entities, clears all edges)
    // Services are always fully wiped and re-inserted (no file_id on services table)
    persistSurgicalData(db, {
      repoId: existingRow.id,
      metadata,
      changedFiles: allChangedFiles,
      modules: surgicalModules,
      events: surgicalEvents,
      services,
    });

    // Re-derive ALL edges from full extractor output (not just changed files)
    const eventRelationships = detectEventRelationships(repoPath, branch, protoDefinitions, elixirModules);
    if (eventRelationships.length > 0) {
      insertEventEdges(db, existingRow.id, eventRelationships);
    }

    // Insert gRPC client edges (EXT-06) and Ecto association edges (EXT-02)
    insertGrpcClientEdges(db, existingRow.id, elixirModules);
    insertEctoAssociationEdges(db, existingRow.id, elixirModules);

    return {
      modules: elixirModules.length,
      protos: protoDefinitions.reduce((sum, p) => sum + p.messages.length, 0),
      events: eventRelationships.length,
      services: services.length,
      graphqlTypes: graphqlTypeCount,
      mode: 'surgical' as const,
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

  const eventRelationships = detectEventRelationships(
    repoPath,
    branch,
    protoDefinitions,
    elixirModules,
  );

  // Full persist: wipe all repo entities and re-insert
  const { repoId } = persistRepoData(db, {
    metadata,
    modules: allModules,
    events,
    services,
  });

  // Insert edges based on event relationships
  if (eventRelationships.length > 0) {
    insertEventEdges(db, repoId, eventRelationships);
  }

  // Insert gRPC client edges (EXT-06)
  insertGrpcClientEdges(db, repoId, elixirModules);

  // Insert Ecto association edges (EXT-02)
  insertEctoAssociationEdges(db, repoId, elixirModules);

  return {
    modules: elixirModules.length,
    protos: protoDefinitions.reduce((sum, p) => sum + p.messages.length, 0),
    events: eventRelationships.length,
    services: services.length,
    graphqlTypes: graphqlTypeCount,
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

/**
 * Insert gRPC client edges (calls_grpc) from repo to service.
 * For each Elixir module with grpcStubs, look up matching services
 * and create edges. (EXT-06)
 */
function insertGrpcClientEdges(
  db: Database.Database,
  repoId: number,
  elixirModules: ElixirModule[],
): void {
  const insertEdge = db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const seenServiceIds = new Set<number>();

  for (const mod of elixirModules) {
    for (const stub of mod.grpcStubs) {
      // Extract the service name from the stub reference
      // e.g., "Rpc.Booking.V1.BookingService.Stub" -> try "BookingService"
      // or "Rpc.Booking.V1.BookingService.Stub" -> try matching by LIKE
      const parts = stub.replace(/\.Stub$/, '').split('.');
      const shortName = parts[parts.length - 1]; // Last segment

      // Try exact match on short name first, then LIKE match on full stub path
      let service = db
        .prepare('SELECT id FROM services WHERE name = ?')
        .get(shortName) as { id: number } | undefined;

      if (!service) {
        // Try matching by the full qualified name without .Stub
        const fullName = stub.replace(/\.Stub$/, '');
        service = db
          .prepare('SELECT id FROM services WHERE name = ? OR name LIKE ?')
          .get(fullName, `%${shortName}%`) as { id: number } | undefined;
      }

      if (service && !seenServiceIds.has(service.id)) {
        seenServiceIds.add(service.id);
        insertEdge.run('repo', repoId, 'service', service.id, 'calls_grpc', mod.filePath);
      }
    }
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
