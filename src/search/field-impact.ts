import type Database from 'better-sqlite3';
import { buildGraph } from './graph.js';

// ─── Types ───────────────────────────────────────────────────────────────

export interface FieldHop {
  repoName: string;
  parentType: string;
  parentName: string;
  fieldType: string;
  nullable: boolean;
}

export interface FieldBoundary {
  repoName: string;
  parentName: string;
  fieldType: string;
  nullable: boolean;
  topics: string[];
}

export interface FieldImpactResult {
  fieldName: string;
  origins: FieldHop[];
  boundaries: FieldBoundary[];
  consumers: FieldHop[];
  summary: string;
}

export interface FieldImpactCompact {
  summary: string;
  field: string;
  origins: Array<{ repo: string; schema: string; type: string; nullable: boolean }>;
  boundaries: Array<{ repo: string; proto: string; type: string; nullable: boolean; topics: string[] }>;
  consumers: Array<{ repo: string; schema: string; type: string; nullable: boolean }>;
}

// ─── Core function ───────────────────────────────────────────────────────

/**
 * Trace a field name from ecto origins through proto/event boundaries
 * to consuming services, with nullability at each hop.
 */
export function analyzeFieldImpact(
  db: Database.Database,
  fieldName: string,
): FieldImpactResult {
  // Step 1: Find all field occurrences
  const occurrences = db.prepare(`
    SELECT f.id, f.parent_type, f.parent_name, f.field_type, f.nullable,
           f.source_file, f.repo_id, r.name AS repo_name
    FROM fields f JOIN repos r ON f.repo_id = r.id
    WHERE f.field_name = ?
    ORDER BY r.name, f.parent_type
  `).all(fieldName) as Array<{
    id: number;
    parent_type: string;
    parent_name: string;
    field_type: string;
    nullable: number;
    source_file: string | null;
    repo_id: number;
    repo_name: string;
  }>;

  if (occurrences.length === 0) {
    return {
      fieldName,
      origins: [],
      boundaries: [],
      consumers: [],
      summary: `${fieldName}: no occurrences found`,
    };
  }

  // Step 2: Classify occurrences — group by repo/type
  const boundaryMap = new Map<string, {
    repoName: string;
    repoId: number;
    parentName: string;
    fieldType: string;
    nullable: boolean;
  }>();
  const boundaryRepoIds = new Set<number>();

  // Collect all ecto/graphql fields and proto fields separately
  const ectoFields: Array<typeof occurrences[0]> = [];

  for (const occ of occurrences) {
    if (occ.parent_type === 'ecto_schema' || occ.parent_type === 'graphql_type') {
      ectoFields.push(occ);
    } else if (occ.parent_type === 'proto_message') {
      const key = `${occ.repo_name}:${occ.parent_name}`;
      if (!boundaryMap.has(key)) {
        boundaryMap.set(key, {
          repoName: occ.repo_name,
          repoId: occ.repo_id,
          parentName: occ.parent_name,
          fieldType: occ.field_type,
          nullable: occ.nullable === 1,
        });
        boundaryRepoIds.add(occ.repo_id);
      }
    }
  }

  // If no proto boundaries, all ecto fields are origins
  if (boundaryMap.size === 0) {
    const origins = ectoFields.map(occ => ({
      repoName: occ.repo_name,
      parentType: occ.parent_type,
      parentName: occ.parent_name,
      fieldType: occ.field_type,
      nullable: occ.nullable === 1,
    }));
    const repoSet = new Set(origins.map(o => o.repoName));
    return {
      fieldName,
      origins,
      boundaries: [],
      consumers: [],
      summary: `${fieldName}: ${origins.length} origins, 0 boundaries, 0 consumers across ${repoSet.size} repos`,
    };
  }

  // Step 3: Build service graph and find downstream consumers
  const graph = buildGraph(db);

  // Step 4: For each boundary repo, find Kafka topics and downstream repo IDs
  const boundaries: FieldBoundary[] = [];
  const consumerRepoIds = new Set<number>();

  for (const boundary of boundaryMap.values()) {
    const topics: string[] = [];
    const forwardEdges = graph.forward.get(boundary.repoId) ?? [];

    for (const edge of forwardEdges) {
      if (edge.mechanism === 'kafka' || edge.mechanism === 'event') {
        if (edge.via) {
          topics.push(edge.via);
        }
        if (edge.targetRepoId !== 0) {
          consumerRepoIds.add(edge.targetRepoId);
        }
      }
    }

    boundaries.push({
      repoName: boundary.repoName,
      parentName: boundary.parentName,
      fieldType: boundary.fieldType,
      nullable: boundary.nullable,
      topics: [...new Set(topics)],
    });
  }

  // Remove boundary repos from consumer set (they are boundaries, not consumers)
  for (const bId of boundaryRepoIds) {
    consumerRepoIds.delete(bId);
  }

  // Step 5: Classify ecto fields — origins vs consumers
  // Origins: ecto fields in repos that are NOT downstream consumers
  // Consumers: ecto fields in repos that ARE downstream consumers
  const origins: FieldHop[] = [];
  const consumers: FieldHop[] = [];

  // Build repo_id -> repo_name map from ecto occurrences
  const ectoByRepo = new Map<number, typeof ectoFields>();
  for (const occ of ectoFields) {
    let list = ectoByRepo.get(occ.repo_id);
    if (!list) {
      list = [];
      ectoByRepo.set(occ.repo_id, list);
    }
    list.push(occ);
  }

  for (const [repoId, fields] of ectoByRepo) {
    const isConsumer = consumerRepoIds.has(repoId);
    for (const occ of fields) {
      const hop: FieldHop = {
        repoName: occ.repo_name,
        parentType: occ.parent_type,
        parentName: occ.parent_name,
        fieldType: occ.field_type,
        nullable: occ.nullable === 1,
      };
      if (isConsumer) {
        consumers.push(hop);
      } else {
        origins.push(hop);
      }
    }
  }

  // Step 6: Build summary
  const allRepos = new Set([
    ...origins.map(o => o.repoName),
    ...boundaries.map(b => b.repoName),
    ...consumers.map(c => c.repoName),
  ]);

  const summary = `${fieldName}: ${origins.length} origins, ${boundaries.length} boundaries, ${consumers.length} consumers across ${allRepos.size} repos`;

  return { fieldName, origins, boundaries, consumers, summary };
}

// ─── Formatters ──────────────────────────────────────────────────────────

/**
 * Compact formatter for MCP responses.
 * Budget: 4000 chars. Truncates origins/consumers if needed.
 */
export function formatFieldImpactCompact(result: FieldImpactResult): FieldImpactCompact {
  const MAX_CHARS = 4000;

  const originsCompact = result.origins.map(o => ({
    repo: o.repoName,
    schema: o.parentName,
    type: o.fieldType,
    nullable: o.nullable,
  }));

  const boundariesCompact = result.boundaries.map(b => ({
    repo: b.repoName,
    proto: b.parentName,
    type: b.fieldType,
    nullable: b.nullable,
    topics: b.topics,
  }));

  const consumersCompact = result.consumers.map(c => ({
    repo: c.repoName,
    schema: c.parentName,
    type: c.fieldType,
    nullable: c.nullable,
  }));

  const compact: FieldImpactCompact = {
    summary: result.summary,
    field: result.fieldName,
    origins: originsCompact,
    boundaries: boundariesCompact,
    consumers: consumersCompact,
  };

  // Check budget and truncate if needed
  let serialized = JSON.stringify(compact);
  if (serialized.length <= MAX_CHARS) {
    return compact;
  }

  // Truncate consumers first, then origins
  while (compact.consumers.length > 0 && serialized.length > MAX_CHARS) {
    compact.consumers.pop();
    serialized = JSON.stringify(compact);
  }

  while (compact.origins.length > 0 && serialized.length > MAX_CHARS) {
    compact.origins.pop();
    serialized = JSON.stringify(compact);
  }

  return compact;
}
