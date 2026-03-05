import type Database from 'better-sqlite3';
import type { EntityType } from '../types/entities.js';
import type { EntityCard, EntityFilters, EntityRelationship } from './types.js';
import { tokenizeForFts } from '../db/tokenizer.js';

/**
 * Find entities by name with optional filters.
 * First tries exact name match across all entity tables,
 * then falls back to FTS search for partial matches.
 *
 * Results include relationship data from the edges table.
 * Sorted by repo name, then alphabetical within each group.
 */
export function findEntity(
  db: Database.Database,
  name: string,
  filters?: EntityFilters,
): EntityCard[] {
  if (!name || !name.trim()) return [];

  // Try exact match first
  let cards = findExact(db, name, filters);

  // Fall back to FTS search if no exact match
  if (cards.length === 0) {
    cards = findByFts(db, name, filters);
  }

  // Apply relationship filter
  if (filters?.relationship) {
    cards = cards.filter((card) =>
      card.relationships.some((r) => r.type === filters.relationship),
    );
  }

  // Sort: group by repo, then alphabetical within group
  cards.sort((a, b) => {
    const repoCompare = a.repoName.localeCompare(b.repoName);
    if (repoCompare !== 0) return repoCompare;
    return a.name.localeCompare(b.name);
  });

  return cards;
}

/** Search entity tables by exact name */
function findExact(
  db: Database.Database,
  name: string,
  filters?: EntityFilters,
): EntityCard[] {
  const cards: EntityCard[] = [];
  const types = filters?.type ? [filters.type] : (['repo', 'module', 'event', 'service'] as EntityType[]);

  for (const type of types) {
    const entities = getEntitiesByExactName(db, type, name, filters?.repo);
    for (const entity of entities) {
      const relationships = getRelationships(db, type, entity.id);
      cards.push({
        name: entity.name,
        type,
        repoName: entity.repoName,
        filePath: entity.filePath,
        description: entity.description,
        relationships,
      });
    }
  }

  return cards;
}

/** Search entity tables via FTS for partial matches */
function findByFts(
  db: Database.Database,
  name: string,
  filters?: EntityFilters,
): EntityCard[] {
  const processedQuery = tokenizeForFts(name);
  if (!processedQuery) return [];

  const typeFilter = filters?.type ? ' AND entity_type = ?' : '';
  const sql = `
    SELECT entity_type, entity_id, name
    FROM knowledge_fts
    WHERE knowledge_fts MATCH ?${typeFilter}
    ORDER BY rank
    LIMIT 20
  `;

  const params: (string | number)[] = [processedQuery];
  if (filters?.type) params.push(filters.type);

  let rows: Array<{ entity_type: string; entity_id: number; name: string }>;
  try {
    rows = db.prepare(sql).all(...params) as typeof rows;
  } catch {
    // FTS syntax error
    try {
      const phraseQuery = `"${processedQuery.replace(/"/g, '')}"`;
      const fallbackParams: (string | number)[] = [phraseQuery];
      if (filters?.type) fallbackParams.push(filters.type);
      rows = db.prepare(sql).all(...fallbackParams) as typeof rows;
    } catch {
      return [];
    }
  }

  const cards: EntityCard[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const entityType = row.entity_type as EntityType;
    const key = `${entityType}:${row.entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const entities = getEntityById(db, entityType, row.entity_id, filters?.repo);
    for (const entity of entities) {
      const relationships = getRelationships(db, entityType, entity.id);
      cards.push({
        name: entity.name,
        type: entityType,
        repoName: entity.repoName,
        filePath: entity.filePath,
        description: entity.description,
        relationships,
      });
    }
  }

  return cards;
}

interface EntityInfo {
  id: number;
  name: string;
  repoName: string;
  filePath: string | null;
  description: string | null;
}

function getEntitiesByExactName(
  db: Database.Database,
  type: EntityType,
  name: string,
  repoFilter?: string,
): EntityInfo[] {
  switch (type) {
    case 'repo': {
      const sql = repoFilter
        ? 'SELECT id, name, path, description FROM repos WHERE name = ? AND name = ?'
        : 'SELECT id, name, path, description FROM repos WHERE name = ?';
      const params = repoFilter ? [name, repoFilter] : [name];
      const rows = db.prepare(sql).all(...params) as Array<{
        id: number; name: string; path: string; description: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id, name: r.name, repoName: r.name, filePath: null, description: r.description,
      }));
    }
    case 'module': {
      let sql = `SELECT m.id, m.name, m.summary, r.name as repo_name, f.path as file_path
                  FROM modules m JOIN repos r ON m.repo_id = r.id LEFT JOIN files f ON m.file_id = f.id
                  WHERE m.name = ?`;
      const params: string[] = [name];
      if (repoFilter) { sql += ' AND r.name = ?'; params.push(repoFilter); }
      const rows = db.prepare(sql).all(...params) as Array<{
        id: number; name: string; summary: string | null; repo_name: string; file_path: string | null;
      }>;
      return rows.map((r) => ({
        id: r.id, name: r.name, repoName: r.repo_name, filePath: r.file_path, description: r.summary,
      }));
    }
    case 'event': {
      let sql = `SELECT e.id, e.name, e.schema_definition, e.source_file, r.name as repo_name
                  FROM events e JOIN repos r ON e.repo_id = r.id
                  WHERE e.name = ?`;
      const params: string[] = [name];
      if (repoFilter) { sql += ' AND r.name = ?'; params.push(repoFilter); }
      const rows = db.prepare(sql).all(...params) as Array<{
        id: number; name: string; schema_definition: string | null; source_file: string | null; repo_name: string;
      }>;
      return rows.map((r) => ({
        id: r.id, name: r.name, repoName: r.repo_name, filePath: r.source_file, description: r.schema_definition,
      }));
    }
    case 'service': {
      let sql = `SELECT s.id, s.name, s.description, r.name as repo_name
                  FROM services s JOIN repos r ON s.repo_id = r.id
                  WHERE s.name = ?`;
      const params: string[] = [name];
      if (repoFilter) { sql += ' AND r.name = ?'; params.push(repoFilter); }
      const rows = db.prepare(sql).all(...params) as Array<{
        id: number; name: string; description: string | null; repo_name: string;
      }>;
      return rows.map((r) => ({
        id: r.id, name: r.name, repoName: r.repo_name, filePath: null, description: r.description,
      }));
    }
    default:
      return [];
  }
}

function getEntityById(
  db: Database.Database,
  type: EntityType,
  id: number,
  repoFilter?: string,
): EntityInfo[] {
  switch (type) {
    case 'repo': {
      const row = db.prepare('SELECT id, name, path, description FROM repos WHERE id = ?').get(id) as {
        id: number; name: string; path: string; description: string | null;
      } | undefined;
      if (!row) return [];
      if (repoFilter && row.name !== repoFilter) return [];
      return [{ id: row.id, name: row.name, repoName: row.name, filePath: null, description: row.description }];
    }
    case 'module': {
      const row = db.prepare(
        `SELECT m.id, m.name, m.summary, r.name as repo_name, f.path as file_path
         FROM modules m JOIN repos r ON m.repo_id = r.id LEFT JOIN files f ON m.file_id = f.id
         WHERE m.id = ?`,
      ).get(id) as {
        id: number; name: string; summary: string | null; repo_name: string; file_path: string | null;
      } | undefined;
      if (!row) return [];
      if (repoFilter && row.repo_name !== repoFilter) return [];
      return [{ id: row.id, name: row.name, repoName: row.repo_name, filePath: row.file_path, description: row.summary }];
    }
    case 'event': {
      const row = db.prepare(
        `SELECT e.id, e.name, e.schema_definition, e.source_file, r.name as repo_name
         FROM events e JOIN repos r ON e.repo_id = r.id WHERE e.id = ?`,
      ).get(id) as {
        id: number; name: string; schema_definition: string | null; source_file: string | null; repo_name: string;
      } | undefined;
      if (!row) return [];
      if (repoFilter && row.repo_name !== repoFilter) return [];
      return [{ id: row.id, name: row.name, repoName: row.repo_name, filePath: row.source_file, description: row.schema_definition }];
    }
    case 'service': {
      const row = db.prepare(
        `SELECT s.id, s.name, s.description, r.name as repo_name
         FROM services s JOIN repos r ON s.repo_id = r.id WHERE s.id = ?`,
      ).get(id) as {
        id: number; name: string; description: string | null; repo_name: string;
      } | undefined;
      if (!row) return [];
      if (repoFilter && row.repo_name !== repoFilter) return [];
      return [{ id: row.id, name: row.name, repoName: row.repo_name, filePath: null, description: row.description }];
    }
    default:
      return [];
  }
}

/**
 * Get relationships for an entity from the edges table.
 * Returns both incoming and outgoing edges with resolved target names.
 */
function getRelationships(
  db: Database.Database,
  entityType: EntityType,
  entityId: number,
): EntityRelationship[] {
  const relationships: EntityRelationship[] = [];

  // Outgoing edges: this entity is the source
  const outgoing = db
    .prepare(
      'SELECT target_type, target_id, relationship_type FROM edges WHERE source_type = ? AND source_id = ?',
    )
    .all(entityType, entityId) as Array<{
    target_type: string; target_id: number; relationship_type: string;
  }>;

  for (const edge of outgoing) {
    const targetName = resolveEntityName(db, edge.target_type as EntityType, edge.target_id);
    if (targetName) {
      relationships.push({
        direction: 'outgoing',
        type: edge.relationship_type,
        targetName,
        targetType: edge.target_type,
      });
    }
  }

  // Incoming edges: this entity is the target
  const incoming = db
    .prepare(
      'SELECT source_type, source_id, relationship_type FROM edges WHERE target_type = ? AND target_id = ?',
    )
    .all(entityType, entityId) as Array<{
    source_type: string; source_id: number; relationship_type: string;
  }>;

  for (const edge of incoming) {
    const sourceName = resolveEntityName(db, edge.source_type as EntityType, edge.source_id);
    if (sourceName) {
      relationships.push({
        direction: 'incoming',
        type: edge.relationship_type,
        targetName: sourceName,
        targetType: edge.source_type,
      });
    }
  }

  return relationships;
}

/** Resolve an entity's name from its type and ID */
function resolveEntityName(db: Database.Database, type: EntityType, id: number): string | null {
  const tableMap: Record<string, string> = {
    repo: 'repos',
    module: 'modules',
    event: 'events',
    service: 'services',
    file: 'files',
  };

  const table = tableMap[type];
  if (!table) return null;

  const nameCol = type === 'file' ? 'path' : 'name';
  const row = db.prepare(`SELECT ${nameCol} as name FROM ${table} WHERE id = ?`).get(id) as { name: string } | undefined;
  return row?.name ?? null;
}
