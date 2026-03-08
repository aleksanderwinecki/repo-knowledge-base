import type Database from 'better-sqlite3';
import type { DependencyResult, DependencyNode, DependencyOptions } from './types.js';

const MAX_DEPTH = 10;

/** Map relationship types to human-readable mechanism labels */
const MECHANISM_LABELS: Record<string, string> = {
  produces_event: 'Kafka producer',
  consumes_event: 'Kafka consumer',
  calls_grpc: 'gRPC',
  calls_http: 'HTTP',
  routes_to: 'Gateway',
  produces_kafka: 'Kafka producer',
  consumes_kafka: 'Kafka consumer',
  exposes_graphql: 'GraphQL',
};

/** Map user-facing mechanism names to relationship_type arrays */
const MECHANISM_FILTER_MAP: Record<string, string[]> = {
  grpc: ['calls_grpc'],
  http: ['calls_http'],
  gateway: ['routes_to'],
  kafka: ['produces_kafka', 'consumes_kafka'],
  event: ['produces_event', 'consumes_event'],
};

/** Valid mechanism filter values for CLI/MCP validation */
export const VALID_MECHANISMS = Object.keys(MECHANISM_FILTER_MAP);

/** Relationship types that represent direct repo-to-repo edges */
const DIRECT_EDGE_TYPES = ['calls_grpc', 'calls_http', 'routes_to'];

/** Relationship types for event-mediated edges */
const EVENT_EDGE_TYPES = ['produces_event', 'consumes_event'];

/** Relationship types for kafka topic-mediated edges */
const KAFKA_EDGE_TYPES = ['produces_kafka', 'consumes_kafka'];

/**
 * Extract confidence from edge metadata JSON.
 * Returns null for legacy edges without metadata.
 */
function extractConfidence(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed.confidence ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract a field from edge metadata JSON.
 */
function extractMetadataField(metadata: string | null, field: string): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed[field] ?? null;
  } catch {
    return null;
  }
}

/**
 * Format mechanism display string.
 * - Direct with confidence: "gRPC [high]"
 * - Event-mediated: "event (OrderCreated)"
 * - Kafka: "Kafka consumer [high]"
 * - Unresolved: "gRPC -> [unresolved: TargetName]"
 */
function formatMechanism(
  relType: string,
  confidence: string | null,
  eventName?: string,
  unresolvedTarget?: string,
): string {
  const label = MECHANISM_LABELS[relType] ?? relType;

  if (unresolvedTarget) {
    return `${label} -> [unresolved: ${unresolvedTarget}]`;
  }

  if (eventName) {
    return `event (${eventName})`;
  }

  if (confidence) {
    return `${label} [${confidence}]`;
  }

  return label;
}

interface LinkedRepo {
  repoId: number;
  repoName: string;
  mechanism: string;
  confidence: string | null;
  pathSegment: string; // What to insert in path array between repo names
  unresolvedTarget?: string;
}

/**
 * Build a SQL IN clause with placeholders for the given types.
 * Returns { clause, params } for use in prepared statements.
 */
function buildInClause(types: string[]): string {
  return types.map(() => '?').join(', ');
}

/**
 * Get the allowed relationship types based on mechanism filter and edge category.
 * Returns the intersection of the filter types and the category types,
 * or all category types if no filter is set.
 */
function getAllowedTypes(
  mechanism: string | undefined,
  categoryTypes: string[],
): string[] {
  if (!mechanism) return categoryTypes;
  const filterTypes = MECHANISM_FILTER_MAP[mechanism];
  if (!filterTypes) return [];
  return categoryTypes.filter((t) => filterTypes.includes(t));
}

/**
 * Query service dependencies via the edges graph.
 *
 * Traverses all edge types: direct (gRPC, HTTP, gateway), event-mediated,
 * kafka topic-mediated, and unresolved edges.
 *
 * Supports multi-hop traversal with cycle detection and mechanism filtering.
 */
export function queryDependencies(
  db: Database.Database,
  entityName: string,
  options?: DependencyOptions,
): DependencyResult {
  const direction = options?.direction ?? 'upstream';
  const maxDepth = options?.depth === 'all' ? MAX_DEPTH : (options?.depth ?? 1);
  const repoFilter = options?.repo;
  const mechanism = options?.mechanism;

  // Resolve entity -- try repos first (since edges use repo as source)
  const repo = db
    .prepare('SELECT id, name, path FROM repos WHERE name = ?')
    .get(entityName) as { id: number; name: string; path: string } | undefined;

  if (!repo) {
    return {
      entity: { name: entityName, type: 'repo', repoName: entityName },
      dependencies: [],
    };
  }

  const result: DependencyResult = {
    entity: { name: repo.name, type: 'repo', repoName: repo.name },
    dependencies: [],
  };

  // BFS traversal
  const visited = new Set<string>();
  visited.add(`repo:${repo.id}`);

  // Queue: [repoId, currentDepth, pathSoFar[]]
  const queue: Array<[number, number, string[]]> = [[repo.id, 0, [repo.name]]];

  while (queue.length > 0) {
    const [currentRepoId, currentDepth, currentPath] = queue.shift()!;

    if (currentDepth >= maxDepth) continue;

    // Find linked repos through all edge types at this hop
    const linkedRepos = findLinkedRepos(db, currentRepoId, direction, mechanism);

    for (const linked of linkedRepos) {
      // Unresolved targets are leaf nodes -- add to results but don't traverse
      if (linked.unresolvedTarget) {
        const unresolvedKey = `unresolved:${linked.unresolvedTarget}:${linked.mechanism}`;
        if (visited.has(unresolvedKey)) continue;
        visited.add(unresolvedKey);

        const newPath = [...currentPath, linked.pathSegment, linked.unresolvedTarget];

        if (!repoFilter) {
          result.dependencies.push({
            name: linked.unresolvedTarget,
            type: 'unresolved',
            repoName: linked.unresolvedTarget,
            mechanism: linked.mechanism,
            confidence: linked.confidence,
            depth: currentDepth + 1,
            path: newPath,
          });
        }
        continue;
      }

      const key = `repo:${linked.repoId}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const newPath = [...currentPath, linked.pathSegment, linked.repoName];

      if (!repoFilter || linked.repoName === repoFilter) {
        result.dependencies.push({
          name: linked.repoName,
          type: 'repo',
          repoName: linked.repoName,
          mechanism: linked.mechanism,
          confidence: linked.confidence,
          depth: currentDepth + 1,
          path: newPath,
        });
      }

      // Continue traversal from this repo
      queue.push([linked.repoId, currentDepth + 1, newPath]);
    }
  }

  return result;
}

/**
 * Find repos linked to currentRepoId through all edge types.
 *
 * Handles four edge patterns:
 * a) Direct edges (calls_grpc, calls_http, routes_to) -- repo-to-repo
 * b) Event-mediated edges (produces_event/consumes_event) -- repo-event-repo
 * c) Kafka topic-mediated edges (produces_kafka/consumes_kafka) -- matched by topic name
 * d) Unresolved edges (target_type='service_name') -- leaf nodes
 */
function findLinkedRepos(
  db: Database.Database,
  repoId: number,
  direction: 'upstream' | 'downstream',
  mechanism?: string,
): LinkedRepo[] {
  const results: LinkedRepo[] = [];

  // a) Direct edges (repo -> repo)
  findDirectEdges(db, repoId, direction, mechanism, results);

  // b) Event-mediated edges (repo -> event -> repo)
  findEventMediatedEdges(db, repoId, direction, mechanism, results);

  // c) Kafka topic-mediated edges (matched by topic name)
  findKafkaTopicEdges(db, repoId, direction, mechanism, results);

  // d) Unresolved edges (target_type='service_name', not kafka)
  findUnresolvedEdges(db, repoId, direction, mechanism, results);

  return results;
}

/**
 * Find direct repo-to-repo edges (calls_grpc, calls_http, routes_to).
 *
 * Upstream: source_id = repoId (I call them), follow to target
 * Downstream: target_id = repoId (they call me), follow to source
 */
function findDirectEdges(
  db: Database.Database,
  repoId: number,
  direction: 'upstream' | 'downstream',
  mechanism: string | undefined,
  results: LinkedRepo[],
): void {
  const allowedTypes = getAllowedTypes(mechanism, DIRECT_EDGE_TYPES);
  if (allowedTypes.length === 0) return;

  const placeholders = buildInClause(allowedTypes);

  if (direction === 'upstream') {
    // I call them -> they are my upstream dependencies
    const rows = db.prepare(`
      SELECT e.target_id, e.relationship_type, e.metadata, r.name as repo_name
      FROM edges e
      JOIN repos r ON r.id = e.target_id
      WHERE e.source_type = 'repo' AND e.source_id = ?
        AND e.target_type = 'repo'
        AND e.relationship_type IN (${placeholders})
    `).all(repoId, ...allowedTypes) as Array<{
      target_id: number;
      relationship_type: string;
      metadata: string | null;
      repo_name: string;
    }>;

    for (const row of rows) {
      const confidence = extractConfidence(row.metadata);
      results.push({
        repoId: row.target_id,
        repoName: row.repo_name,
        mechanism: formatMechanism(row.relationship_type, confidence),
        confidence,
        pathSegment: MECHANISM_LABELS[row.relationship_type] ?? row.relationship_type,
      });
    }
  } else {
    // They call me -> they are my downstream dependants
    const rows = db.prepare(`
      SELECT e.source_id, e.relationship_type, e.metadata, r.name as repo_name
      FROM edges e
      JOIN repos r ON r.id = e.source_id
      WHERE e.target_type = 'repo' AND e.target_id = ?
        AND e.source_type = 'repo'
        AND e.relationship_type IN (${placeholders})
    `).all(repoId, ...allowedTypes) as Array<{
      source_id: number;
      relationship_type: string;
      metadata: string | null;
      repo_name: string;
    }>;

    for (const row of rows) {
      const confidence = extractConfidence(row.metadata);
      results.push({
        repoId: row.source_id,
        repoName: row.repo_name,
        mechanism: formatMechanism(row.relationship_type, confidence),
        confidence,
        pathSegment: MECHANISM_LABELS[row.relationship_type] ?? row.relationship_type,
      });
    }
  }
}

/**
 * Find repos linked through event-mediated edges (produces_event/consumes_event).
 *
 * Upstream: I consume events -> find who produces those events
 * Downstream: I produce events -> find who consumes those events
 */
function findEventMediatedEdges(
  db: Database.Database,
  repoId: number,
  direction: 'upstream' | 'downstream',
  mechanism: string | undefined,
  results: LinkedRepo[],
): void {
  const allowedTypes = getAllowedTypes(mechanism, EVENT_EDGE_TYPES);
  if (allowedTypes.length === 0) return;

  // For event-mediated traversal, we need both directions to be allowed
  const consumeAllowed = allowedTypes.includes('consumes_event');
  const produceAllowed = allowedTypes.includes('produces_event');

  // Select the source edge type and target edge type based on direction
  const sourceRelType = direction === 'upstream' ? 'consumes_event' : 'produces_event';
  const targetRelType = direction === 'upstream' ? 'produces_event' : 'consumes_event';

  // Check if the source side of the traversal is in our allowed types
  if ((direction === 'upstream' && !consumeAllowed) || (direction === 'downstream' && !produceAllowed)) {
    return;
  }

  // Find events connected to this repo
  const edges = db.prepare(
    `SELECT target_id, relationship_type, metadata FROM edges
     WHERE source_type = 'repo' AND source_id = ? AND relationship_type = ?`,
  ).all(repoId, sourceRelType) as Array<{ target_id: number; relationship_type: string; metadata: string | null }>;

  const eventNameStmt = db.prepare('SELECT name FROM events WHERE id = ?');
  const repoByIdStmt = db.prepare('SELECT id, name FROM repos WHERE id = ?');

  for (const edge of edges) {
    const event = eventNameStmt.get(edge.target_id) as { name: string } | undefined;
    if (!event) continue;

    // Find repos on the other side of this event
    const targetEdges = db.prepare(
      `SELECT source_id, metadata FROM edges
       WHERE target_type = 'event' AND target_id = ? AND relationship_type = ?`,
    ).all(edge.target_id, targetRelType) as Array<{ source_id: number; metadata: string | null }>;

    for (const target of targetEdges) {
      const repo = repoByIdStmt.get(target.source_id) as { id: number; name: string } | undefined;
      if (!repo) continue;

      results.push({
        repoId: repo.id,
        repoName: repo.name,
        mechanism: formatMechanism(sourceRelType, null, event.name),
        confidence: null, // Legacy event edges have no confidence
        pathSegment: `event(${event.name})`,
      });
    }
  }
}

/**
 * Find repos linked through kafka topic matching.
 *
 * Kafka edges are unresolved (target_type='service_name', target_id=0) but
 * can be matched across repos by topic name from metadata.
 *
 * Upstream: I consume_kafka topic X -> find who produces_kafka topic X
 * Downstream: I produce_kafka topic X -> find who consumes_kafka topic X
 */
function findKafkaTopicEdges(
  db: Database.Database,
  repoId: number,
  direction: 'upstream' | 'downstream',
  mechanism: string | undefined,
  results: LinkedRepo[],
): void {
  const allowedTypes = getAllowedTypes(mechanism, KAFKA_EDGE_TYPES);
  if (allowedTypes.length === 0) return;

  const sourceRelType = direction === 'upstream' ? 'consumes_kafka' : 'produces_kafka';
  const targetRelType = direction === 'upstream' ? 'produces_kafka' : 'consumes_kafka';

  // Check if our source rel type is allowed
  if (!allowedTypes.includes(sourceRelType)) return;

  // Find kafka edges from this repo
  const myKafkaEdges = db.prepare(
    `SELECT metadata FROM edges
     WHERE source_type = 'repo' AND source_id = ?
       AND relationship_type = ?`,
  ).all(repoId, sourceRelType) as Array<{ metadata: string | null }>;

  // Extract topic names
  const topics = new Set<string>();
  for (const edge of myKafkaEdges) {
    const topic = extractMetadataField(edge.metadata, 'topic');
    if (topic) topics.add(topic);
  }

  if (topics.size === 0) return;

  // Find other repos that have the complementary kafka edge for the same topics
  const repoByIdStmt = db.prepare('SELECT id, name FROM repos WHERE id = ?');

  const otherKafkaEdges = db.prepare(
    `SELECT source_id, metadata FROM edges
     WHERE source_type = 'repo' AND source_id != ?
       AND relationship_type = ?`,
  ).all(repoId, targetRelType) as Array<{ source_id: number; metadata: string | null }>;

  for (const edge of otherKafkaEdges) {
    const topic = extractMetadataField(edge.metadata, 'topic');
    if (!topic || !topics.has(topic)) continue;

    const repo = repoByIdStmt.get(edge.source_id) as { id: number; name: string } | undefined;
    if (!repo) continue;

    const confidence = extractConfidence(edge.metadata);
    results.push({
      repoId: repo.id,
      repoName: repo.name,
      mechanism: formatMechanism(targetRelType, confidence),
      confidence,
      pathSegment: `Kafka(${topic})`,
    });
  }
}

/**
 * Find unresolved edges (target_type='service_name', target_id=0).
 * These are leaf nodes -- cannot be traversed further.
 * Excludes kafka edges (handled separately by topic matching).
 */
function findUnresolvedEdges(
  db: Database.Database,
  repoId: number,
  direction: 'upstream' | 'downstream',
  mechanism: string | undefined,
  results: LinkedRepo[],
): void {
  // Unresolved edges only appear in the upstream direction
  // (they represent outgoing calls from this repo that couldn't be resolved)
  if (direction !== 'upstream') return;

  // Get allowed direct types (not kafka -- kafka unresolved is handled by topic matching)
  const allowedTypes = getAllowedTypes(mechanism, DIRECT_EDGE_TYPES);
  if (allowedTypes.length === 0) return;

  const placeholders = buildInClause(allowedTypes);

  const rows = db.prepare(`
    SELECT e.relationship_type, e.metadata
    FROM edges e
    WHERE e.source_type = 'repo' AND e.source_id = ?
      AND e.target_type = 'service_name'
      AND e.relationship_type IN (${placeholders})
  `).all(repoId, ...allowedTypes) as Array<{
    relationship_type: string;
    metadata: string | null;
  }>;

  for (const row of rows) {
    const confidence = extractConfidence(row.metadata);
    const targetName = extractMetadataField(row.metadata, 'targetName') ?? 'unknown';

    results.push({
      repoId: 0,
      repoName: targetName,
      mechanism: formatMechanism(row.relationship_type, confidence, undefined, targetName),
      confidence,
      pathSegment: MECHANISM_LABELS[row.relationship_type] ?? row.relationship_type,
      unresolvedTarget: targetName,
    });
  }
}
