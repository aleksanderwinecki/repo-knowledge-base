import type Database from 'better-sqlite3';
import type { GraphEdge, ServiceGraph, BfsNode, GraphHop } from './types.js';
import { extractConfidence, extractMetadataField } from './edge-utils.js';

/**
 * Build an in-memory service graph from the edges table.
 *
 * Loads all edge types via bulk SQL, then resolves event and kafka two-hop
 * paths in JS. Returns forward and reverse adjacency lists keyed by repo ID.
 *
 * Performance: single bulk load + pure JS resolution, targeting <10ms for 12K raw edges.
 */
export function buildGraph(db: Database.Database): ServiceGraph {
  const forward = new Map<number, GraphEdge[]>();
  const reverse = new Map<number, GraphEdge[]>();
  const repoNames = new Map<number, string>();
  const repoIds = new Map<string, number>();

  // Load repos
  const repos = db.prepare('SELECT id, name FROM repos').all() as Array<{ id: number; name: string }>;
  for (const repo of repos) {
    repoNames.set(repo.id, repo.name);
    repoIds.set(repo.name, repo.id);
  }

  // Helper to add an edge to the graph
  function addEdge(fromId: number, edge: GraphEdge): void {
    let fwdList = forward.get(fromId);
    if (!fwdList) {
      fwdList = [];
      forward.set(fromId, fwdList);
    }
    fwdList.push(edge);

    // Only add reverse entries for resolved edges (targetRepoId !== 0)
    if (edge.targetRepoId !== 0) {
      let revList = reverse.get(edge.targetRepoId);
      if (!revList) {
        revList = [];
        reverse.set(edge.targetRepoId, revList);
      }
      revList.push({ ...edge, targetRepoId: fromId });
    }
  }

  // --- Direct edges (repo -> repo) ---
  const directEdges = db.prepare(
    `SELECT source_id, target_id, relationship_type, metadata
     FROM edges
     WHERE source_type = 'repo' AND target_type = 'repo'`,
  ).all() as Array<{
    source_id: number;
    target_id: number;
    relationship_type: string;
    metadata: string | null;
  }>;

  for (const row of directEdges) {
    const confidence = extractConfidence(row.metadata);
    const mechanism = relTypeToMechanism(row.relationship_type);
    addEdge(row.source_id, {
      targetRepoId: row.target_id,
      mechanism,
      confidence,
      via: null,
      relationshipType: row.relationship_type,
    });
  }

  // --- Event-mediated edges (repo -> event -> repo) ---
  const eventProducers = db.prepare(
    `SELECT DISTINCT e.source_id AS repo_id, e.target_id AS event_id, ev.name AS event_name
     FROM edges e
     JOIN events ev ON ev.id = e.target_id
     WHERE e.relationship_type = 'produces_event'`,
  ).all() as Array<{ repo_id: number; event_id: number; event_name: string }>;

  const eventConsumers = db.prepare(
    `SELECT DISTINCT e.source_id AS repo_id, e.target_id AS event_id
     FROM edges e
     WHERE e.relationship_type = 'consumes_event'`,
  ).all() as Array<{ repo_id: number; event_id: number }>;

  // Build producer map: eventId -> [{ repoId, eventName }]
  const producersByEvent = new Map<number, Array<{ repoId: number; eventName: string }>>();
  for (const p of eventProducers) {
    let list = producersByEvent.get(p.event_id);
    if (!list) {
      list = [];
      producersByEvent.set(p.event_id, list);
    }
    list.push({ repoId: p.repo_id, eventName: p.event_name });
  }

  // Build consumer map: eventId -> [repoId]
  const consumersByEvent = new Map<number, number[]>();
  for (const c of eventConsumers) {
    let list = consumersByEvent.get(c.event_id);
    if (!list) {
      list = [];
      consumersByEvent.set(c.event_id, list);
    }
    list.push(c.repo_id);
  }

  // Resolve event edges
  const eventDedup = new Set<string>();
  for (const [eventId, producers] of producersByEvent) {
    const consumers = consumersByEvent.get(eventId);
    if (!consumers) continue;
    for (const producer of producers) {
      for (const consumerId of consumers) {
        // Skip self-loops
        if (producer.repoId === consumerId) continue;
        const key = `${producer.repoId}-${consumerId}-${producer.eventName}`;
        if (eventDedup.has(key)) continue;
        eventDedup.add(key);

        addEdge(producer.repoId, {
          targetRepoId: consumerId,
          mechanism: 'event',
          confidence: null,
          via: producer.eventName,
          relationshipType: 'produces_event',
        });
      }
    }
  }

  // --- Kafka topic-mediated edges (repo -> topic -> repo) ---
  const kafkaProducers = db.prepare(
    `SELECT source_id AS repo_id, json_extract(metadata, '$.topic') AS topic, metadata
     FROM edges
     WHERE relationship_type = 'produces_kafka'
       AND json_extract(metadata, '$.topic') IS NOT NULL`,
  ).all() as Array<{ repo_id: number; topic: string; metadata: string | null }>;

  const kafkaConsumers = db.prepare(
    `SELECT source_id AS repo_id, json_extract(metadata, '$.topic') AS topic, metadata
     FROM edges
     WHERE relationship_type = 'consumes_kafka'
       AND json_extract(metadata, '$.topic') IS NOT NULL`,
  ).all() as Array<{ repo_id: number; topic: string; metadata: string | null }>;

  // Build kafka producer map: topic -> [repoId]
  const kafkaProducersByTopic = new Map<string, number[]>();
  for (const kp of kafkaProducers) {
    let list = kafkaProducersByTopic.get(kp.topic);
    if (!list) {
      list = [];
      kafkaProducersByTopic.set(kp.topic, list);
    }
    if (!list.includes(kp.repo_id)) {
      list.push(kp.repo_id);
    }
  }

  // Build kafka consumer map: topic -> [repoId]
  const kafkaConsumersByTopic = new Map<string, number[]>();
  for (const kc of kafkaConsumers) {
    let list = kafkaConsumersByTopic.get(kc.topic);
    if (!list) {
      list = [];
      kafkaConsumersByTopic.set(kc.topic, list);
    }
    if (!list.includes(kc.repo_id)) {
      list.push(kc.repo_id);
    }
  }

  // Resolve kafka edges
  const kafkaDedup = new Set<string>();
  for (const [topic, producers] of kafkaProducersByTopic) {
    const consumers = kafkaConsumersByTopic.get(topic);
    if (!consumers) continue;
    for (const producerId of producers) {
      for (const consumerId of consumers) {
        if (producerId === consumerId) continue;
        const key = `${producerId}-${consumerId}-${topic}`;
        if (kafkaDedup.has(key)) continue;
        kafkaDedup.add(key);

        addEdge(producerId, {
          targetRepoId: consumerId,
          mechanism: 'kafka',
          confidence: null,
          via: topic,
          relationshipType: 'produces_kafka',
        });
      }
    }
  }

  // --- Unresolved edges (target_type='service_name') ---
  // Exclude kafka edges (already handled by topic resolution above)
  const unresolvedEdges = db.prepare(
    `SELECT source_id, relationship_type, metadata
     FROM edges
     WHERE source_type = 'repo' AND target_type = 'service_name'
       AND relationship_type NOT IN ('produces_kafka', 'consumes_kafka')`,
  ).all() as Array<{
    source_id: number;
    relationship_type: string;
    metadata: string | null;
  }>;

  for (const row of unresolvedEdges) {
    const targetName = extractMetadataField(row.metadata, 'targetName');
    addEdge(row.source_id, {
      targetRepoId: 0,
      mechanism: relTypeToMechanism(row.relationship_type),
      confidence: extractConfidence(row.metadata),
      via: targetName,
      relationshipType: row.relationship_type,
    });
  }

  return { forward, reverse, repoNames, repoIds };
}

/**
 * BFS downstream traversal: find all repos reachable from startRepoId.
 *
 * Uses the forward adjacency list to traverse outgoing call edges.
 * Does not include the starting node. Does not traverse from unresolved (id=0) nodes.
 */
export function bfsDownstream(
  graph: ServiceGraph,
  startRepoId: number,
  maxDepth: number = Infinity,
): BfsNode[] {
  const visited = new Set<number>();
  visited.add(startRepoId);

  const results: BfsNode[] = [];
  // Queue: [repoId, depth]
  const queue: Array<[number, number]> = [];

  // Seed with forward neighbors of startRepoId
  const forwardNeighbors = graph.forward.get(startRepoId);
  if (forwardNeighbors) {
    for (const edge of forwardNeighbors) {
      if (edge.targetRepoId === 0) continue;
      if (!visited.has(edge.targetRepoId)) {
        queue.push([edge.targetRepoId, 1]);
      }
    }
  }

  while (queue.length > 0) {
    const [repoId, depth] = queue.shift()!;

    if (repoId === 0) continue;
    if (visited.has(repoId)) continue;
    visited.add(repoId);

    const repoName = graph.repoNames.get(repoId) ?? `unknown-${repoId}`;
    results.push({ repoId, repoName, depth });

    if (depth < maxDepth) {
      const neighbors = graph.forward.get(repoId);
      if (neighbors) {
        for (const edge of neighbors) {
          if (edge.targetRepoId !== 0 && !visited.has(edge.targetRepoId)) {
            queue.push([edge.targetRepoId, depth + 1]);
          }
        }
      }
    }
  }

  return results;
}

/**
 * Find the shortest path between two repos using undirected BFS.
 *
 * Traverses both forward and reverse edges (treating the graph as undirected).
 * Returns the path as GraphHop[] with actual edge direction preserved,
 * or null if no path exists. Returns [] if from === to.
 */
export function shortestPath(
  graph: ServiceGraph,
  fromRepoId: number,
  toRepoId: number,
): GraphHop[] | null {
  if (fromRepoId === toRepoId) return [];

  // BFS with parent tracking
  const parent = new Map<number, { parentId: number; edge: GraphEdge; edgeIsForward: boolean }>();
  const visited = new Set<number>();
  visited.add(fromRepoId);

  const queue: number[] = [fromRepoId];

  while (queue.length > 0) {
    const current = queue.shift()!;

    // Forward neighbors: current -> edge.targetRepoId
    const fwdEdges = graph.forward.get(current) ?? [];
    for (const edge of fwdEdges) {
      const neighbor = edge.targetRepoId;
      if (neighbor === 0 || visited.has(neighbor)) continue;
      visited.add(neighbor);
      parent.set(neighbor, { parentId: current, edge, edgeIsForward: true });
      if (neighbor === toRepoId) {
        return reconstructPath(parent, fromRepoId, toRepoId, graph.repoNames);
      }
      queue.push(neighbor);
    }

    // Reverse neighbors: current <- edge.targetRepoId (targetRepoId is the one calling current)
    const revEdges = graph.reverse.get(current) ?? [];
    for (const edge of revEdges) {
      const neighbor = edge.targetRepoId;
      if (neighbor === 0 || visited.has(neighbor)) continue;
      visited.add(neighbor);
      parent.set(neighbor, { parentId: current, edge, edgeIsForward: false });
      if (neighbor === toRepoId) {
        return reconstructPath(parent, fromRepoId, toRepoId, graph.repoNames);
      }
      queue.push(neighbor);
    }
  }

  return null;
}

/**
 * Reconstruct the shortest path from parent pointers.
 * Preserves actual edge direction in the hops.
 */
function reconstructPath(
  parent: Map<number, { parentId: number; edge: GraphEdge; edgeIsForward: boolean }>,
  fromRepoId: number,
  toRepoId: number,
  repoNames: Map<number, string>,
): GraphHop[] {
  const hops: GraphHop[] = [];
  let current = toRepoId;

  while (current !== fromRepoId) {
    const p = parent.get(current)!;
    if (p.edgeIsForward) {
      // Edge goes from parentId -> current (forward edge)
      hops.push({
        fromRepoId: p.parentId,
        fromRepoName: repoNames.get(p.parentId) ?? `unknown-${p.parentId}`,
        toRepoId: current,
        toRepoName: repoNames.get(current) ?? `unknown-${current}`,
        mechanism: p.edge.mechanism,
        confidence: p.edge.confidence,
        via: p.edge.via,
      });
    } else {
      // We traversed a reverse edge: actual edge is current -> parentId
      // But in reverse map, edge.targetRepoId is the "other" node.
      // The actual direction is: neighbor calls current, so from=neighbor, to=current
      // In reverse adjacency, edge stored at current has targetRepoId = the caller
      // So actual edge: edge.targetRepoId -> current, but we traversed from current to edge.targetRepoId
      // Wait -- let me re-think. In reverse map at node X, edges have targetRepoId = Y meaning Y -> X exists.
      // When we do BFS from current, we look at reverse[current] and get neighbor = edge.targetRepoId.
      // The actual edge is: neighbor -> current. So from=neighbor, to=current.
      // But neighbor = p.parentId? No -- neighbor is the NEW node we discovered (which is `current` in the loop).
      // Actually: p.parentId is where BFS was at, p.edge comes from reverse[p.parentId], neighbor is edge.targetRepoId = current.
      // The actual original edge is: current -> p.parentId (current calls p.parentId).
      // No wait. reverse[p.parentId] stores edges where targetRepoId is the source of the original forward edge.
      // Original forward: targetRepoId -> p.parentId. So reverse at p.parentId has edge with targetRepoId meaning "targetRepoId calls p.parentId".
      // In BFS, neighbor = edge.targetRepoId = current. So actual edge direction is current -> p.parentId.
      hops.push({
        fromRepoId: current,
        fromRepoName: repoNames.get(current) ?? `unknown-${current}`,
        toRepoId: p.parentId,
        toRepoName: repoNames.get(p.parentId) ?? `unknown-${p.parentId}`,
        mechanism: p.edge.mechanism,
        confidence: p.edge.confidence,
        via: p.edge.via,
      });
    }
    current = p.parentId;
  }

  hops.reverse();
  return hops;
}

/** Map relationship type to a normalized mechanism label for the graph */
function relTypeToMechanism(relType: string): string {
  switch (relType) {
    case 'calls_grpc': return 'grpc';
    case 'calls_http': return 'http';
    case 'routes_to': return 'gateway';
    case 'produces_event':
    case 'consumes_event': return 'event';
    case 'produces_kafka':
    case 'consumes_kafka': return 'kafka';
    default: return relType;
  }
}
