import type Database from 'better-sqlite3';
import type { RepoMetadata } from './metadata.js';
import { indexEntity, removeEntity } from '../db/fts.js';
import type { EntityType } from '../types/entities.js';

/** Data to persist for a single repo */
export interface RepoData {
  metadata: RepoMetadata;
  modules?: ModuleData[];
  events?: EventData[];
  edges?: EdgeData[];
}

/** Module data from extractors (Elixir modules, etc.) */
export interface ModuleData {
  name: string;
  type: string | null;
  filePath: string;
  summary: string | null;
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
 * Clear all entities associated with a repo.
 * Removes FTS entries before deleting records.
 */
export function clearRepoEntities(db: Database.Database, repoId: number): void {
  // Remove FTS entries for modules
  const modules = db
    .prepare('SELECT id FROM modules WHERE repo_id = ?')
    .all(repoId) as { id: number }[];
  for (const mod of modules) {
    removeEntity(db, 'module', mod.id);
  }

  // Remove FTS entries for events
  const events = db
    .prepare('SELECT id FROM events WHERE repo_id = ?')
    .all(repoId) as { id: number }[];
  for (const evt of events) {
    removeEntity(db, 'event', evt.id);
  }

  // Remove FTS entry for the repo itself
  removeEntity(db, 'repo', repoId);

  // Delete edges (no FK constraint on polymorphic edges)
  db.prepare(
    "DELETE FROM edges WHERE (source_type = 'repo' AND source_id = ?) OR (source_type = 'service' AND source_id IN (SELECT id FROM services WHERE repo_id = ?))",
  ).run(repoId, repoId);

  // Delete dependent entities (CASCADE handles most, but be explicit)
  db.prepare('DELETE FROM modules WHERE repo_id = ?').run(repoId);
  db.prepare('DELETE FROM events WHERE repo_id = ?').run(repoId);
  db.prepare('DELETE FROM files WHERE repo_id = ?').run(repoId);
  db.prepare('DELETE FROM services WHERE repo_id = ?').run(repoId);
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
  for (const filePath of filePaths) {
    // Remove modules from this file
    const modules = db
      .prepare('SELECT id FROM modules WHERE repo_id = ? AND file_id IN (SELECT id FROM files WHERE repo_id = ? AND path = ?)')
      .all(repoId, repoId, filePath) as { id: number }[];
    for (const mod of modules) {
      removeEntity(db, 'module', mod.id);
      db.prepare('DELETE FROM modules WHERE id = ?').run(mod.id);
    }

    // Remove events from this file
    const events = db
      .prepare('SELECT id FROM events WHERE repo_id = ? AND source_file = ?')
      .all(repoId, filePath) as { id: number }[];
    for (const evt of events) {
      removeEntity(db, 'event', evt.id);
      db.prepare('DELETE FROM events WHERE id = ?').run(evt.id);
    }

    // Remove edges from this file
    db.prepare('DELETE FROM edges WHERE source_file = ?').run(filePath);

    // Remove the file record itself
    db.prepare('DELETE FROM files WHERE repo_id = ? AND path = ?').run(repoId, filePath);
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

    // Index repo itself in FTS
    indexEntity(db, {
      type: 'repo' as EntityType,
      id: repoId,
      name: data.metadata.name,
      description: data.metadata.description,
    });

    // Insert modules
    if (data.modules) {
      const insertFile = db.prepare(
        'INSERT INTO files (repo_id, path, language) VALUES (?, ?, ?) ON CONFLICT(repo_id, path) DO UPDATE SET updated_at = datetime(\'now\') RETURNING id',
      );
      const insertModule = db.prepare(
        'INSERT INTO modules (repo_id, file_id, name, type, summary) VALUES (?, ?, ?, ?, ?)',
      );

      for (const mod of data.modules) {
        // Ensure file record exists
        const fileRow = insertFile.get(repoId, mod.filePath, null) as { id: number } | undefined;
        const fileId = fileRow?.id ?? null;

        const modInfo = insertModule.run(repoId, fileId, mod.name, mod.type, mod.summary);
        const modId = Number(modInfo.lastInsertRowid);

        // Index in FTS
        indexEntity(db, {
          type: 'module' as EntityType,
          id: modId,
          name: mod.name,
          description: mod.summary,
        });
      }
    }

    // Insert events (from proto definitions)
    if (data.events) {
      const insertEvent = db.prepare(
        'INSERT INTO events (repo_id, name, schema_definition, source_file) VALUES (?, ?, ?, ?)',
      );

      for (const evt of data.events) {
        const evtInfo = insertEvent.run(repoId, evt.name, evt.schemaDefinition, evt.sourceFile);
        const evtId = Number(evtInfo.lastInsertRowid);

        // Index in FTS
        indexEntity(db, {
          type: 'event' as EntityType,
          id: evtId,
          name: evt.name,
          description: evt.schemaDefinition,
        });
      }
    }

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
