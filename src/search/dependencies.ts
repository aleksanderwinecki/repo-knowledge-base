import type Database from 'better-sqlite3';
import type { DependencyResult, DependencyNode, DependencyOptions } from './types.js';

const MAX_DEPTH = 10;

/** Map relationship types to human-readable mechanism labels */
const MECHANISM_LABELS: Record<string, string> = {
  produces_event: 'Kafka producer',
  consumes_event: 'Kafka consumer',
  calls_grpc: 'gRPC',
  exposes_graphql: 'GraphQL',
};

/**
 * Query service dependencies via the edges graph.
 *
 * For upstream (default): "What does X depend on?" — follows X's consumes_event
 * edges to events, then finds who produces those events.
 *
 * For downstream: "What depends on X?" — follows X's produces_event edges to
 * events, then finds who consumes those events.
 *
 * Supports multi-hop traversal with cycle detection.
 */
export function queryDependencies(
  db: Database.Database,
  entityName: string,
  options?: DependencyOptions,
): DependencyResult {
  const direction = options?.direction ?? 'upstream';
  const maxDepth = options?.depth === 'all' ? MAX_DEPTH : (options?.depth ?? 1);
  const repoFilter = options?.repo;

  // Resolve entity — try repos first (since edges use repo as source)
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

    // Find linked repos through events at this hop
    const linkedRepos = findLinkedRepos(db, currentRepoId, direction);

    for (const linked of linkedRepos) {
      const key = `repo:${linked.repoId}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const newPath = [...currentPath, linked.eventName, linked.repoName];

      if (!repoFilter || linked.repoName === repoFilter) {
        result.dependencies.push({
          name: linked.repoName,
          type: 'repo',
          repoName: linked.repoName,
          mechanism: linked.mechanism,
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

interface LinkedRepo {
  repoId: number;
  repoName: string;
  eventName: string;
  mechanism: string;
}

/**
 * Find repos linked to currentRepoId through event edges.
 *
 * For upstream: currentRepo consumes events -> find who produces those events
 * For downstream: currentRepo produces events -> find who consumes those events
 */
function findLinkedRepos(
  db: Database.Database,
  repoId: number,
  direction: 'upstream' | 'downstream',
): LinkedRepo[] {
  const results: LinkedRepo[] = [];

  // Hoist all prepared statements above the traversal logic
  const consumedEdgesStmt = db.prepare(
    "SELECT target_id, relationship_type FROM edges WHERE source_type = 'repo' AND source_id = ? AND relationship_type = 'consumes_event'",
  );
  const producedEdgesStmt = db.prepare(
    "SELECT target_id, relationship_type FROM edges WHERE source_type = 'repo' AND source_id = ? AND relationship_type = 'produces_event'",
  );
  const eventNameStmt = db.prepare('SELECT name FROM events WHERE id = ?');
  const producerEdgesStmt = db.prepare(
    "SELECT source_id FROM edges WHERE target_type = 'event' AND target_id = ? AND relationship_type = 'produces_event'",
  );
  const consumerEdgesStmt = db.prepare(
    "SELECT source_id FROM edges WHERE target_type = 'event' AND target_id = ? AND relationship_type = 'consumes_event'",
  );
  const repoByIdStmt = db.prepare('SELECT id, name FROM repos WHERE id = ?');

  // Parameterized traversal: select statements based on direction
  const sourceEdgesStmt = direction === 'upstream' ? consumedEdgesStmt : producedEdgesStmt;
  const targetEdgesStmt = direction === 'upstream' ? producerEdgesStmt : consumerEdgesStmt;
  const mechanismKey = direction === 'upstream' ? 'consumes_event' : 'produces_event';

  const edges = sourceEdgesStmt.all(repoId) as Array<{ target_id: number; relationship_type: string }>;

  for (const edge of edges) {
    const event = eventNameStmt.get(edge.target_id) as { name: string } | undefined;
    if (!event) continue;

    const targetEdges = targetEdgesStmt.all(edge.target_id) as Array<{ source_id: number }>;
    for (const target of targetEdges) {
      const repo = repoByIdStmt.get(target.source_id) as { id: number; name: string } | undefined;
      if (!repo) continue;

      results.push({
        repoId: repo.id,
        repoName: repo.name,
        eventName: event.name,
        mechanism: `${MECHANISM_LABELS[mechanismKey] ?? mechanismKey} (${event.name})`,
      });
    }
  }

  return results;
}
