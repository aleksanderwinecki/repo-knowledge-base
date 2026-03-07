import type Database from 'better-sqlite3';
import type { EntityType } from '../types/entities.js';
import type { EntityCard, EntityFilters, EntityRelationship } from './types.js';
import { tokenizeForFts } from '../db/tokenizer.js';
import { COARSE_TYPES, resolveTypeFilter, parseCompositeType, executeFtsWithFallback } from '../db/fts.js';

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

/** Known module sub-types that map to the modules table */
const MODULE_SUB_TYPES = new Set([
  'schema', 'context', 'command', 'query',
  'graphql_type', 'graphql_query', 'graphql_mutation',
  'absinthe_object', 'absinthe_query', 'absinthe_mutation',
]);

/** Known service sub-types that map to the services table */
const SERVICE_SUB_TYPES = new Set(['grpc']);

/**
 * Map a sub-type to its parent EntityType.
 * Returns null if not a known sub-type (will fall back to querying all tables).
 */
function subTypeToParent(subType: string): EntityType | null {
  if (MODULE_SUB_TYPES.has(subType)) return 'module';
  if (SERVICE_SUB_TYPES.has(subType)) return 'service';
  return null;
}

/** Search entity tables by exact name */
function findExact(
  db: Database.Database,
  name: string,
  filters?: EntityFilters,
): EntityCard[] {
  const cards: EntityCard[] = [];

  let types: EntityType[];
  let subTypeColumnFilter: string | undefined;

  if (filters?.type) {
    if (COARSE_TYPES.has(filters.type)) {
      // Coarse type: query that table directly
      types = [filters.type as EntityType];
    } else {
      // Granular sub-type: determine parent table and add column filter
      const parent = subTypeToParent(filters.type);
      if (parent) {
        types = [parent];
        subTypeColumnFilter = filters.type;
      } else {
        // Unknown sub-type: query all tables (fallback)
        types = ['repo', 'module', 'event', 'service'] as EntityType[];
      }
    }
  } else {
    types = ['repo', 'module', 'event', 'service'] as EntityType[];
  }

  // Create pre-prepared relationship lookup for the entity loop
  const lookupRelationships = createRelationshipLookup(db);

  for (const type of types) {
    const entities = getEntitiesByExactName(db, type, name, filters?.repo, subTypeColumnFilter);
    for (const entity of entities) {
      const relationships = lookupRelationships(type, entity.id);
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

/** Create a pre-prepared entity-by-id lookup to avoid db.prepare() per FTS result */
function createEntityByIdLookup(db: Database.Database) {
  const stmts = {
    repo: db.prepare('SELECT id, name, path, description FROM repos WHERE id = ?'),
    module: db.prepare(
      `SELECT m.id, m.name, m.summary, r.name as repo_name, f.path as file_path
       FROM modules m JOIN repos r ON m.repo_id = r.id LEFT JOIN files f ON m.file_id = f.id
       WHERE m.id = ?`,
    ),
    event: db.prepare(
      `SELECT e.id, e.name, e.schema_definition, e.source_file, r.name as repo_name
       FROM events e JOIN repos r ON e.repo_id = r.id WHERE e.id = ?`,
    ),
    service: db.prepare(
      `SELECT s.id, s.name, s.description, r.name as repo_name
       FROM services s JOIN repos r ON s.repo_id = r.id WHERE s.id = ?`,
    ),
  };

  return (type: EntityType, id: number, repoFilter?: string): EntityInfo[] => {
    switch (type) {
      case 'repo': {
        const row = stmts.repo.get(id) as {
          id: number; name: string; path: string; description: string | null;
        } | undefined;
        if (!row) return [];
        if (repoFilter && row.name !== repoFilter) return [];
        return [{ id: row.id, name: row.name, repoName: row.name, filePath: null, description: row.description }];
      }
      case 'module': {
        const row = stmts.module.get(id) as {
          id: number; name: string; summary: string | null; repo_name: string; file_path: string | null;
        } | undefined;
        if (!row) return [];
        if (repoFilter && row.repo_name !== repoFilter) return [];
        return [{ id: row.id, name: row.name, repoName: row.repo_name, filePath: row.file_path, description: row.summary }];
      }
      case 'event': {
        const row = stmts.event.get(id) as {
          id: number; name: string; schema_definition: string | null; source_file: string | null; repo_name: string;
        } | undefined;
        if (!row) return [];
        if (repoFilter && row.repo_name !== repoFilter) return [];
        return [{ id: row.id, name: row.name, repoName: row.repo_name, filePath: row.source_file, description: row.schema_definition }];
      }
      case 'service': {
        const row = stmts.service.get(id) as {
          id: number; name: string; description: string | null; repo_name: string;
        } | undefined;
        if (!row) return [];
        if (repoFilter && row.repo_name !== repoFilter) return [];
        return [{ id: row.id, name: row.name, repoName: row.repo_name, filePath: null, description: row.description }];
      }
      default:
        return [];
    }
  };
}

/** Create a pre-prepared relationship lookup to avoid db.prepare() per entity */
function createRelationshipLookup(db: Database.Database) {
  const outgoingStmt = db.prepare(
    'SELECT target_type, target_id, relationship_type FROM edges WHERE source_type = ? AND source_id = ?',
  );
  const incomingStmt = db.prepare(
    'SELECT source_type, source_id, relationship_type FROM edges WHERE target_type = ? AND target_id = ?',
  );
  // Pre-prepared name resolution statements per entity type
  const nameStmts: Record<string, Database.Statement> = {
    repo: db.prepare('SELECT name FROM repos WHERE id = ?'),
    module: db.prepare('SELECT name FROM modules WHERE id = ?'),
    event: db.prepare('SELECT name FROM events WHERE id = ?'),
    service: db.prepare('SELECT name FROM services WHERE id = ?'),
    file: db.prepare('SELECT path as name FROM files WHERE id = ?'),
  };

  const resolveName = (type: EntityType, id: number): string | null => {
    const stmt = nameStmts[type];
    if (!stmt) return null;
    const row = stmt.get(id) as { name: string } | undefined;
    return row?.name ?? null;
  };

  return (entityType: EntityType, entityId: number): EntityRelationship[] => {
    const relationships: EntityRelationship[] = [];

    // Outgoing edges: this entity is the source
    const outgoing = outgoingStmt.all(entityType, entityId) as Array<{
      target_type: string; target_id: number; relationship_type: string;
    }>;

    for (const edge of outgoing) {
      const targetName = resolveName(edge.target_type as EntityType, edge.target_id);
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
    const incoming = incomingStmt.all(entityType, entityId) as Array<{
      source_type: string; source_id: number; relationship_type: string;
    }>;

    for (const edge of incoming) {
      const sourceName = resolveName(edge.source_type as EntityType, edge.source_id);
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
  };
}

/** Search entity tables via FTS for partial matches */
function findByFts(
  db: Database.Database,
  name: string,
  filters?: EntityFilters,
): EntityCard[] {
  const processedQuery = tokenizeForFts(name);
  if (!processedQuery) return [];

  let typeFilterSql = '';
  let typeFilterParam: string | undefined;
  if (filters?.type) {
    const resolved = resolveTypeFilter(filters.type);
    typeFilterSql = ` AND ${resolved.sql}`;
    typeFilterParam = resolved.param;
  }

  const sql = `
    SELECT entity_type, entity_id, name
    FROM knowledge_fts
    WHERE knowledge_fts MATCH ?${typeFilterSql}
    ORDER BY rank
    LIMIT 20
  `;

  const buildParams = (query: string): (string | number)[] => {
    const p: (string | number)[] = [query];
    if (typeFilterParam) p.push(typeFilterParam);
    return p;
  };

  const rows = executeFtsWithFallback<{ entity_type: string; entity_id: number; name: string }>(
    db, sql, processedQuery, buildParams,
  );

  // Create pre-prepared lookups for the hydration loop
  const lookupEntityById = createEntityByIdLookup(db);
  const lookupRelationships = createRelationshipLookup(db);

  const cards: EntityCard[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    // Parse composite entity_type (e.g., 'module:schema' -> entityType='module')
    const { entityType } = parseCompositeType(row.entity_type);
    const key = `${entityType}:${row.entity_id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const entities = lookupEntityById(entityType, row.entity_id, filters?.repo);
    for (const entity of entities) {
      const relationships = lookupRelationships(entityType, entity.id);
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
  subTypeFilter?: string,
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
      if (subTypeFilter) { sql += ' AND m.type = ?'; params.push(subTypeFilter); }
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
      if (subTypeFilter) { sql += ' AND s.service_type = ?'; params.push(subTypeFilter); }
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

