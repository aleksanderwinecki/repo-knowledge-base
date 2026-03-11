import type Database from 'better-sqlite3';
import type { RepoMetadata } from './metadata.js';
import { indexEntity, removeEntity } from '../db/fts.js';
import type { EntityType } from '../types/entities.js';
import type { TopologyEdge } from './topology/types.js';

/**
 * Module-level flag to skip all FTS operations during bulk writes.
 * When true, persistRepoData/persistSurgicalData skip indexEntity/removeEntity calls.
 * Use with rebuildAllFts() after bulk operations to rebuild FTS in one pass.
 */
let _skipFts = false;

/** Enable or disable FTS skip mode for bulk operations. */
export function setSkipFts(skip: boolean): void {
  _skipFts = skip;
}

/** Service data from proto/gRPC extractors */
export interface ServiceData {
  name: string;
  description: string | null;
  serviceType: string;
}

/** Field-level data from extractors (Ecto schemas, proto messages, GraphQL types) */
export interface FieldData {
  parentType: 'ecto_schema' | 'proto_message' | 'graphql_type';
  parentName: string;
  fieldName: string;
  fieldType: string;
  nullable: boolean;
  sourceFile: string;
  moduleId?: number | null;
  eventId?: number | null;
}

/** Data to persist for a single repo */
export interface RepoData {
  metadata: RepoMetadata;
  modules?: ModuleData[];
  events?: EventData[];
  edges?: EdgeData[];
  services?: ServiceData[];
  fields?: FieldData[];
}

/** Module data from extractors (Elixir modules, etc.) */
export interface ModuleData {
  name: string;
  type: string | null;
  filePath: string;
  summary: string | null;
  tableName?: string | null;
  schemaFields?: string | null;
}

/** Event data from proto extractors */
export interface EventData {
  name: string;
  schemaDefinition: string | null;
  sourceFile: string;
}

/** Edge data from event relationship detectors */
export interface EdgeData {
  sourceType: string;
  sourceId: number;
  targetType: string;
  targetId: number;
  relationshipType: string;
  sourceFile: string | null;
}

/**
 * Build FTS description for a field entity.
 * Includes repo name for cross-repo disambiguation and event: prefix for proto fields.
 * Shared by both persistRepoData and persistSurgicalData to ensure dual-path consistency.
 */
function buildFieldDescription(field: FieldData, repoName: string): string {
  const parts = [repoName, field.parentName, field.fieldType];
  if (field.parentType === 'proto_message') {
    parts.push(`event:${field.parentName}`);
  }
  return parts.join(' ');
}

/**
 * Upsert a repo record. Returns the repo ID.
 */
function upsertRepo(db: Database.Database, metadata: RepoMetadata): number {
  const stmt = db.prepare(`
    INSERT INTO repos (name, path, description, last_indexed_commit, default_branch)
    VALUES (@name, @path, @description, @lastIndexedCommit, @defaultBranch)
    ON CONFLICT(name) DO UPDATE SET
      path = @path,
      description = @description,
      last_indexed_commit = @lastIndexedCommit,
      default_branch = @defaultBranch,
      updated_at = datetime('now')
  `);

  stmt.run({
    name: metadata.name,
    path: metadata.path,
    description: metadata.description,
    lastIndexedCommit: metadata.currentCommit,
    defaultBranch: metadata.defaultBranch,
  });

  // Get the repo ID
  const row = db.prepare('SELECT id FROM repos WHERE name = ?').get(metadata.name) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`Failed to upsert repo: ${metadata.name}`);
  return row.id;
}

/**
 * Clear FTS entries for all entities returned by a select statement.
 * Shared helper to avoid repeating the select-then-delete-FTS pattern.
 */
function clearEntityFts(
  selectStmt: Database.Statement,
  deleteFtsStmt: Database.Statement,
  ftsPrefix: string,
  repoId: number,
): void {
  const entities = selectStmt.all(repoId) as { id: number }[];
  for (const entity of entities) {
    deleteFtsStmt.run(ftsPrefix, entity.id);
  }
}

/**
 * Clear all entities associated with a repo.
 * Removes FTS entries before deleting records.
 */
export function clearRepoEntities(db: Database.Database, repoId: number): void {
  // Hoist all prepared statements above loops
  const selectModules = db.prepare('SELECT id FROM modules WHERE repo_id = ?');
  const selectEvents = db.prepare('SELECT id FROM events WHERE repo_id = ?');
  const selectServices = db.prepare('SELECT id FROM services WHERE repo_id = ?');
  const selectFields = db.prepare('SELECT id FROM fields WHERE repo_id = ?');
  const deleteFts = db.prepare('DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id = ?');
  const deleteEdges = db.prepare("DELETE FROM edges WHERE (source_type = 'repo' AND source_id = ?) OR (source_type = 'service' AND source_id IN (SELECT id FROM services WHERE repo_id = ?))");
  const deleteFieldEdgesBySource = db.prepare("DELETE FROM edges WHERE source_type = 'field' AND source_id IN (SELECT id FROM fields WHERE repo_id = ?)");
  const deleteFieldEdgesByTarget = db.prepare("DELETE FROM edges WHERE target_type = 'field' AND target_id IN (SELECT id FROM fields WHERE repo_id = ?)");
  const deleteModules = db.prepare('DELETE FROM modules WHERE repo_id = ?');
  const deleteEvents = db.prepare('DELETE FROM events WHERE repo_id = ?');
  const deleteFiles = db.prepare('DELETE FROM files WHERE repo_id = ?');
  const deleteServices = db.prepare('DELETE FROM services WHERE repo_id = ?');
  const deleteFields = db.prepare('DELETE FROM fields WHERE repo_id = ?');

  // Remove FTS entries for all entity types (skipped in bulk mode — rebuilt at end)
  if (!_skipFts) {
    clearEntityFts(selectModules, deleteFts, 'module:%', repoId);
    clearEntityFts(selectEvents, deleteFts, 'event:%', repoId);
    clearEntityFts(selectServices, deleteFts, 'service:%', repoId);
    clearEntityFts(selectFields, deleteFts, 'field:%', repoId);

    // Remove FTS entry for the repo itself
    deleteFts.run('repo:%', repoId);
  }

  // Delete edges (no FK constraint on polymorphic edges)
  deleteEdges.run(repoId, repoId);

  // Delete field-to-field edges before deleting field rows (both directions)
  deleteFieldEdgesBySource.run(repoId);
  deleteFieldEdgesByTarget.run(repoId);

  // Delete dependent entities (CASCADE handles most, but be explicit)
  deleteModules.run(repoId);
  deleteEvents.run(repoId);
  deleteFiles.run(repoId);
  deleteServices.run(repoId);
  deleteFields.run(repoId);
}

/**
 * Clear entities extracted from specific files in a repo.
 * Used for incremental indexing when files are deleted.
 */
export function clearRepoFiles(
  db: Database.Database,
  repoId: number,
  filePaths: string[],
): void {
  // Hoist all prepared statements above the filePath loop
  const selectModulesByFile = db.prepare('SELECT id FROM modules WHERE repo_id = ? AND file_id IN (SELECT id FROM files WHERE repo_id = ? AND path = ?)');
  const deleteFts = db.prepare('DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id = ?');
  const deleteModuleById = db.prepare('DELETE FROM modules WHERE id = ?');
  const selectEventsByFileId = db.prepare('SELECT id FROM events WHERE repo_id = ? AND file_id IN (SELECT id FROM files WHERE repo_id = ? AND path = ?)');
  const deleteEventById = db.prepare('DELETE FROM events WHERE id = ?');
  const selectEventsBySourceFile = db.prepare('SELECT id FROM events WHERE repo_id = ? AND file_id IS NULL AND source_file = ?');
  const selectFieldsByFile = db.prepare('SELECT id FROM fields WHERE repo_id = ? AND source_file = ?');
  const deleteEdgesByFile = db.prepare('DELETE FROM edges WHERE source_file = ?');
  const deleteFieldsByFile = db.prepare('DELETE FROM fields WHERE repo_id = ? AND source_file = ?');
  const deleteFileRecord = db.prepare('DELETE FROM files WHERE repo_id = ? AND path = ?');

  for (const filePath of filePaths) {
    // Remove modules from this file
    const modules = selectModulesByFile.all(repoId, repoId, filePath) as { id: number }[];
    for (const mod of modules) {
      if (!_skipFts) deleteFts.run('module:%', mod.id);
      deleteModuleById.run(mod.id);
    }

    // Remove events from this file via file_id FK join (primary path)
    const eventsViaFileId = selectEventsByFileId.all(repoId, repoId, filePath) as { id: number }[];
    for (const evt of eventsViaFileId) {
      if (!_skipFts) deleteFts.run('event:%', evt.id);
      deleteEventById.run(evt.id);
    }

    // Fallback: remove events without file_id via source_file text match (backward compat for pre-v4 data)
    const eventsViaSourceFile = selectEventsBySourceFile.all(repoId, filePath) as { id: number }[];
    for (const evt of eventsViaSourceFile) {
      if (!_skipFts) deleteFts.run('event:%', evt.id);
      deleteEventById.run(evt.id);
    }

    // Remove edges from this file
    deleteEdgesByFile.run(filePath);

    // Remove field FTS entries before deleting field rows
    if (!_skipFts) {
      const fieldIds = selectFieldsByFile.all(repoId, filePath) as { id: number }[];
      for (const f of fieldIds) {
        deleteFts.run('field:%', f.id);
      }
    }

    // Remove fields from this file
    deleteFieldsByFile.run(repoId, filePath);

    // Remove the file record itself
    deleteFileRecord.run(repoId, filePath);
  }
}

/**
 * Insert a module record with its file record and FTS entry.
 * Accepts pre-prepared statements to preserve hoisting optimization.
 */
function insertModuleWithFts(
  insertFileStmt: Database.Statement,
  insertModuleStmt: Database.Statement,
  db: Database.Database,
  repoId: number,
  mod: ModuleData,
  repoName: string,
): void {
  const fileRow = insertFileStmt.get(repoId, mod.filePath, null) as { id: number } | undefined;
  const fileId = fileRow?.id ?? null;
  const modInfo = insertModuleStmt.run(repoId, fileId, mod.name, mod.type, mod.summary, mod.tableName ?? null, mod.schemaFields ?? null);
  const modId = Number(modInfo.lastInsertRowid);

  // Build FTS description: repo name + summary + optional table name
  // CRITICAL: Do NOT add field names (schemaFields) — that would collapse BM25 rank spread
  const parts: string[] = [];
  parts.push(repoName);
  if (mod.summary) parts.push(mod.summary);
  if (mod.tableName) parts.push(`table:${mod.tableName}`);
  const ftsDescription = parts.join(' ') || null;

  if (!_skipFts) {
    indexEntity(db, {
      type: 'module' as EntityType,
      id: modId,
      name: mod.name,
      description: ftsDescription,
      subType: mod.type ?? 'module',
    });
  }
}

/**
 * Insert an event record with its file record and FTS entry.
 * Accepts pre-prepared statements to preserve hoisting optimization.
 */
function insertEventWithFts(
  insertFileStmt: Database.Statement,
  insertEventStmt: Database.Statement,
  db: Database.Database,
  repoId: number,
  evt: EventData,
  repoName: string,
): void {
  const fileRow = insertFileStmt.get(repoId, evt.sourceFile, null) as { id: number } | undefined;
  const fileId = fileRow?.id ?? null;
  const evtInfo = insertEventStmt.run(repoId, evt.name, evt.schemaDefinition, evt.sourceFile, fileId);
  const evtId = Number(evtInfo.lastInsertRowid);

  if (!_skipFts) {
    indexEntity(db, {
      type: 'event' as EntityType,
      id: evtId,
      name: evt.name,
      description: evt.schemaDefinition ? `${repoName} ${evt.schemaDefinition}` : repoName,
      subType: 'event',
    });
  }
}

/**
 * Insert a service record with FTS entry.
 * Accepts pre-prepared statement to preserve hoisting optimization.
 * Uses named parameters (@repoId etc) matching the service INSERT pattern.
 */
function insertServiceWithFts(
  insertServiceStmt: Database.Statement,
  db: Database.Database,
  repoId: number,
  svc: ServiceData,
  repoName: string,
): void {
  const svcInfo = insertServiceStmt.run({
    repoId,
    name: svc.name,
    description: svc.description,
    serviceType: svc.serviceType,
  });
  const svcId = Number(svcInfo.lastInsertRowid);

  if (!_skipFts) {
    indexEntity(db, {
      type: 'service' as EntityType,
      id: svcId,
      name: svc.name,
      description: svc.description ? `${repoName} ${svc.description}` : repoName,
      subType: svc.serviceType ?? 'service',
    });
  }
}

/**
 * Create maps_to edges between ecto_schema and proto_message fields
 * that share the same field_name within the same repo.
 */
export function insertFieldEdges(db: Database.Database, repoId: number): void {
  const matches = db.prepare(`
    SELECT e.id AS ecto_id, p.id AS proto_id
    FROM fields e
    JOIN fields p ON e.field_name = p.field_name AND e.repo_id = p.repo_id
    WHERE e.repo_id = ?
      AND e.parent_type = 'ecto_schema'
      AND p.parent_type = 'proto_message'
  `).all(repoId) as Array<{ ecto_id: number; proto_id: number }>;

  if (matches.length === 0) return;

  const insertEdge = db.prepare(
    `INSERT INTO edges (source_type, source_id, target_type, target_id,
                        relationship_type, source_file)
     VALUES ('field', ?, 'field', ?, 'maps_to', NULL)`,
  );

  for (const match of matches) {
    insertEdge.run(match.ecto_id, match.proto_id);
  }
}

/**
 * Persist all extracted data for a repo in a single transaction.
 * Upserts the repo, clears old data, inserts new data, and syncs FTS.
 */
export function persistRepoData(
  db: Database.Database,
  data: RepoData,
): { repoId: number } {
  const result = db.transaction(() => {
    // Upsert repo
    const repoId = upsertRepo(db, data.metadata);

    // Clear old entities for full re-index
    clearRepoEntities(db, repoId);

    // Index repo itself in FTS (skipped in bulk mode — rebuilt at end)
    if (!_skipFts) {
      indexEntity(db, {
        type: 'repo' as EntityType,
        id: repoId,
        name: data.metadata.name,
        description: data.metadata.description,
        subType: 'repo',
      });
    }

    // Capture repo name for FTS description enrichment
    const repoName = data.metadata.name;

    // Insert modules
    if (data.modules) {
      const insertFile = db.prepare(
        'INSERT INTO files (repo_id, path, language) VALUES (?, ?, ?) ON CONFLICT(repo_id, path) DO UPDATE SET updated_at = datetime(\'now\') RETURNING id',
      );
      const insertModule = db.prepare(
        'INSERT INTO modules (repo_id, file_id, name, type, summary, table_name, schema_fields) VALUES (?, ?, ?, ?, ?, ?, ?)',
      );

      for (const mod of data.modules) {
        insertModuleWithFts(insertFile, insertModule, db, repoId, mod, repoName);
      }
    }

    // Insert events (from proto definitions) with file_id FK
    if (data.events) {
      const insertEventFile = db.prepare(
        'INSERT INTO files (repo_id, path, language) VALUES (?, ?, ?) ON CONFLICT(repo_id, path) DO UPDATE SET updated_at = datetime(\'now\') RETURNING id',
      );
      const insertEvent = db.prepare(
        'INSERT INTO events (repo_id, name, schema_definition, source_file, file_id) VALUES (?, ?, ?, ?, ?)',
      );

      for (const evt of data.events) {
        insertEventWithFts(insertEventFile, insertEvent, db, repoId, evt, repoName);
      }
    }

    // Insert services (from proto/gRPC extractors)
    if (data.services) {
      const insertService = db.prepare(`
        INSERT INTO services (repo_id, name, description, service_type)
        VALUES (@repoId, @name, @description, @serviceType)
        ON CONFLICT(repo_id, name) DO UPDATE SET
          description = @description,
          service_type = @serviceType,
          updated_at = datetime('now')
      `);

      for (const svc of data.services) {
        insertServiceWithFts(insertService, db, repoId, svc, repoName);
      }
    }

    // Insert fields (after modules and events so parent IDs can be resolved)
    if (data.fields && data.fields.length > 0) {
      const insertField = db.prepare(`
        INSERT INTO fields (repo_id, parent_type, parent_name, field_name, field_type,
                            nullable, source_file, module_id, event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const lookupModule = db.prepare('SELECT id FROM modules WHERE repo_id = ? AND name = ?');
      const lookupEvent = db.prepare('SELECT id FROM events WHERE repo_id = ? AND name = ?');

      for (const field of data.fields) {
        let moduleId: number | null = null;
        let eventId: number | null = null;

        if (field.parentType === 'ecto_schema' || field.parentType === 'graphql_type') {
          const mod = lookupModule.get(repoId, field.parentName) as { id: number } | undefined;
          moduleId = mod?.id ?? null;
        } else if (field.parentType === 'proto_message') {
          const evt = lookupEvent.get(repoId, field.parentName) as { id: number } | undefined;
          eventId = evt?.id ?? null;
        }

        const fieldInfo = insertField.run(
          repoId,
          field.parentType,
          field.parentName,
          field.fieldName,
          field.fieldType,
          field.nullable ? 1 : 0,
          field.sourceFile,
          moduleId,
          eventId,
        );
        const fieldId = Number(fieldInfo.lastInsertRowid);
        if (!_skipFts) {
          indexEntity(db, {
            type: 'field' as EntityType,
            id: fieldId,
            name: field.fieldName,
            description: buildFieldDescription(field, repoName),
            subType: field.parentType,
          });
        }
      }
    }

    // Create field-to-field maps_to edges (ecto <-> proto matching by name)
    insertFieldEdges(db, repoId);

    // Insert edges
    if (data.edges) {
      const insertEdge = db.prepare(
        'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
      );

      for (const edge of data.edges) {
        insertEdge.run(
          edge.sourceType,
          edge.sourceId,
          edge.targetType,
          edge.targetId,
          edge.relationshipType,
          edge.sourceFile,
        );
      }
    }

    return { repoId };
  })();

  return result;
}

/**
 * Clear all edges sourced from a repo or its services, and remove
 * consumer-created events (schema_definition LIKE 'consumed:%').
 * Called during surgical persist to reset edges before re-insertion.
 */
export function clearRepoEdges(db: Database.Database, repoId: number): void {
  // Hoist all prepared statements above loops
  const deleteRepoEdges = db.prepare("DELETE FROM edges WHERE source_type = 'repo' AND source_id = ?");
  const deleteServiceEdges = db.prepare("DELETE FROM edges WHERE source_type = 'service' AND source_id IN (SELECT id FROM services WHERE repo_id = ?)");
  const deleteFieldEdgesBySource = db.prepare("DELETE FROM edges WHERE source_type = 'field' AND source_id IN (SELECT id FROM fields WHERE repo_id = ?)");
  const deleteFieldEdgesByTarget = db.prepare("DELETE FROM edges WHERE target_type = 'field' AND target_id IN (SELECT id FROM fields WHERE repo_id = ?)");
  const selectConsumerEvents = db.prepare("SELECT id FROM events WHERE repo_id = ? AND schema_definition LIKE 'consumed:%'");
  const deleteFts = db.prepare('DELETE FROM knowledge_fts WHERE entity_type LIKE ? AND entity_id = ?');
  const deleteEventById = db.prepare('DELETE FROM events WHERE id = ?');

  // Clear edges where repo is source
  deleteRepoEdges.run(repoId);

  // Clear service-sourced edges for this repo's services
  deleteServiceEdges.run(repoId);

  // Clear field-to-field edges for this repo (both directions since either end may be deleted)
  deleteFieldEdgesBySource.run(repoId);
  deleteFieldEdgesByTarget.run(repoId);

  // Clean up consumer-created events (will be re-created by insertEventEdges if still relevant)
  const consumerEvents = selectConsumerEvents.all(repoId) as { id: number }[];
  for (const evt of consumerEvents) {
    if (!_skipFts) deleteFts.run('event:%', evt.id);
    deleteEventById.run(evt.id);
  }
}

/**
 * Persist extracted data for only the changed files in a repo.
 * Surgically clears entities from changed files, inserts new data,
 * and clears all edges (caller re-inserts via insertEventEdges).
 * Unchanged files' entities are left untouched.
 */
export function persistSurgicalData(
  db: Database.Database,
  data: {
    repoId: number;
    metadata: RepoMetadata;
    changedFiles: string[];
    modules: ModuleData[];
    events: EventData[];
    services?: ServiceData[];
    fields?: FieldData[];
  },
): void {
  const txn = db.transaction(() => {
    // 1. Update repo metadata (commit SHA, description, etc.)
    upsertRepo(db, data.metadata);

    // 2. Clear entities from changed files only
    clearRepoFiles(db, data.repoId, data.changedFiles);

    // Capture repo name for FTS description enrichment
    const repoName = data.metadata.name;

    // 3. Insert file records + modules for changed files
    const insertFile = db.prepare(
      "INSERT INTO files (repo_id, path, language) VALUES (?, ?, ?) ON CONFLICT(repo_id, path) DO UPDATE SET updated_at = datetime('now') RETURNING id",
    );
    const insertModule = db.prepare(
      'INSERT INTO modules (repo_id, file_id, name, type, summary, table_name, schema_fields) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );

    for (const mod of data.modules) {
      insertModuleWithFts(insertFile, insertModule, db, data.repoId, mod, repoName);
    }

    // 4. Insert events for changed files (with file_id)
    const insertEvent = db.prepare(
      'INSERT INTO events (repo_id, name, schema_definition, source_file, file_id) VALUES (?, ?, ?, ?, ?)',
    );

    for (const evt of data.events) {
      insertEventWithFts(insertFile, insertEvent, db, data.repoId, evt, repoName);
    }

    // 5. Insert fields for changed files (after modules and events for parent ID resolution)
    if (data.fields && data.fields.length > 0) {
      const insertField = db.prepare(`
        INSERT INTO fields (repo_id, parent_type, parent_name, field_name, field_type,
                            nullable, source_file, module_id, event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const lookupModule = db.prepare('SELECT id FROM modules WHERE repo_id = ? AND name = ?');
      const lookupEvent = db.prepare('SELECT id FROM events WHERE repo_id = ? AND name = ?');

      for (const field of data.fields) {
        let moduleId: number | null = null;
        let eventId: number | null = null;

        if (field.parentType === 'ecto_schema' || field.parentType === 'graphql_type') {
          const mod = lookupModule.get(data.repoId, field.parentName) as { id: number } | undefined;
          moduleId = mod?.id ?? null;
        } else if (field.parentType === 'proto_message') {
          const evt = lookupEvent.get(data.repoId, field.parentName) as { id: number } | undefined;
          eventId = evt?.id ?? null;
        }

        const fieldInfo = insertField.run(
          data.repoId,
          field.parentType,
          field.parentName,
          field.fieldName,
          field.fieldType,
          field.nullable ? 1 : 0,
          field.sourceFile,
          moduleId,
          eventId,
        );
        const fieldId = Number(fieldInfo.lastInsertRowid);
        if (!_skipFts) {
          indexEntity(db, {
            type: 'field' as EntityType,
            id: fieldId,
            name: field.fieldName,
            description: buildFieldDescription(field, repoName),
            subType: field.parentType,
          });
        }
      }
    }

    // 6. Wipe and re-insert services if provided (services have no file_id, so full replace)
    if (data.services) {
      // Remove FTS entries for existing services
      if (!_skipFts) {
        const existingServices = db
          .prepare('SELECT id FROM services WHERE repo_id = ?')
          .all(data.repoId) as { id: number }[];
        for (const svc of existingServices) {
          removeEntity(db, 'service', svc.id);
        }
      }

      // Delete all repo services
      db.prepare('DELETE FROM services WHERE repo_id = ?').run(data.repoId);

      // Re-insert from extractor output
      const insertService = db.prepare(`
        INSERT INTO services (repo_id, name, description, service_type)
        VALUES (@repoId, @name, @description, @serviceType)
        ON CONFLICT(repo_id, name) DO UPDATE SET
          description = @description,
          service_type = @serviceType,
          updated_at = datetime('now')
      `);

      for (const svc of data.services) {
        insertServiceWithFts(insertService, db, data.repoId, svc, repoName);
      }
    }

    // 7. Clear ALL repo edges (caller will re-insert via insertEventEdges)
    clearRepoEdges(db, data.repoId);

    // 8. Re-create field-to-field maps_to edges after edge cleanup
    insertFieldEdges(db, data.repoId);
  });
  txn();
}

/**
 * Resolve a topology target service name to a DB entity.
 * Returns { type, id } or null if unresolved.
 *
 * Strategy varies by mechanism:
 * - gRPC: Extract short name from qualified Elixir path, look up in services table
 * - gateway: targetServiceName is a repo name, look up in repos table
 * - HTTP: Try to match hostname to repo name
 * - Kafka: Topic-based, no target resolution (returns null)
 */
function resolveTopologyTarget(
  db: Database.Database,
  targetServiceName: string,
): { type: string; id: number } | null {
  // Try exact match in repos table (covers gateway repo references and HTTP hostnames)
  const repo = db
    .prepare('SELECT id FROM repos WHERE name = ?')
    .get(targetServiceName) as { id: number } | undefined;
  if (repo) return { type: 'repo', id: repo.id };

  // Try LIKE match for partial repo name (HTTP hostnames may be partial)
  const repoLike = db
    .prepare('SELECT id FROM repos WHERE name LIKE ?')
    .get(`%${targetServiceName}%`) as { id: number } | undefined;
  if (repoLike) return { type: 'repo', id: repoLike.id };

  // For gRPC qualified names: extract short service name and look up services
  const parts = targetServiceName.split('.');
  if (parts.length > 1) {
    const shortName = parts[parts.length - 1]!;

    // Try exact match on short service name
    let service = db
      .prepare('SELECT id FROM services WHERE name = ?')
      .get(shortName) as { id: number } | undefined;

    if (!service) {
      // Try LIKE fallback
      service = db
        .prepare('SELECT id FROM services WHERE name LIKE ?')
        .get(`%${shortName}%`) as { id: number } | undefined;
    }

    if (service) {
      // Found a service -- resolve to the repo that owns it
      const ownerRepo = db
        .prepare('SELECT repo_id FROM services WHERE id = ?')
        .get(service.id) as { repo_id: number } | undefined;
      if (ownerRepo) return { type: 'repo', id: ownerRepo.repo_id };
      return { type: 'service', id: service.id };
    }
  }

  return null;
}

/**
 * Insert topology edges into the edges table with JSON metadata.
 * Handles dedup and target resolution for gRPC, HTTP, gateway, and Kafka edges.
 */
export function insertTopologyEdges(
  db: Database.Database,
  repoId: number,
  edges: TopologyEdge[],
): void {
  if (edges.length === 0) return;

  const insertEdge = db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  // Map mechanism to relationship_type
  const mechanismToRelType: Record<string, string> = {
    grpc: 'calls_grpc',
    http: 'calls_http',
    gateway: 'routes_to',
  };

  const seenTargets = new Set<string>();

  for (const edge of edges) {
    // Determine relationship type
    const relType = edge.mechanism === 'kafka'
      ? (edge.metadata.role === 'consumer' ? 'consumes_kafka' : 'produces_kafka')
      : mechanismToRelType[edge.mechanism] ?? edge.mechanism;

    // Resolve target: try to find a repo or service by name
    const target = resolveTopologyTarget(db, edge.targetServiceName);

    // Dedup key: mechanism + target + relationship
    const dedupKey = `${relType}:${target?.type ?? 'unresolved'}:${target?.id ?? edge.targetServiceName}`;
    if (seenTargets.has(dedupKey)) continue;
    seenTargets.add(dedupKey);

    if (target) {
      insertEdge.run(
        'repo', repoId,
        target.type, target.id,
        relType,
        edge.sourceFile,
        JSON.stringify({ ...edge.metadata, confidence: edge.confidence }),
      );
    } else {
      // Unresolved target -- still insert so the edge is visible
      // even if the target repo isn't indexed yet.
      // Use target_type 'service_name' to indicate unresolved.
      insertEdge.run(
        'repo', repoId,
        'service_name', 0,
        relType,
        edge.sourceFile,
        JSON.stringify({
          ...edge.metadata,
          confidence: edge.confidence,
          unresolved: 'true',
          targetName: edge.targetServiceName,
        }),
      );
    }
  }
}
