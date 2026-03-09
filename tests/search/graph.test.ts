import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { buildGraph, bfsDownstream, shortestPath, bfsUpstream } from '../../src/search/graph.js';
import type { ImpactNode } from '../../src/search/types.js';

let db: Database.Database;
let dbPath: string;

// --- Test helpers ---

function insertRepo(database: Database.Database, name: string): number {
  const result = database
    .prepare('INSERT INTO repos (name, path, description) VALUES (?, ?, ?)')
    .run(name, `/repos/${name}`, `${name} service`);
  return Number(result.lastInsertRowid);
}

function insertDirectEdge(
  database: Database.Database,
  sourceRepoId: number,
  targetRepoId: number,
  relType: string,
  metadata?: string,
): void {
  database
    .prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run('repo', sourceRepoId, 'repo', targetRepoId, relType, 'src/client.ex', metadata ?? null);
}

function insertEvent(database: Database.Database, repoId: number, name: string): number {
  const result = database
    .prepare('INSERT INTO events (repo_id, name, schema_definition, source_file) VALUES (?, ?, ?, ?)')
    .run(repoId, name, `message ${name} {}`, 'proto/events.proto');
  return Number(result.lastInsertRowid);
}

function insertEventEdge(
  database: Database.Database,
  repoId: number,
  eventId: number,
  relType: 'produces_event' | 'consumes_event',
): void {
  database
    .prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run('repo', repoId, 'event', eventId, relType, 'proto/events.proto');
}

function insertKafkaEdge(
  database: Database.Database,
  repoId: number,
  topic: string,
  relType: 'produces_kafka' | 'consumes_kafka',
): void {
  database
    .prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      'repo', repoId, 'service_name', 0, relType, 'lib/kafka.ex',
      JSON.stringify({ confidence: 'high', topic, targetName: topic }),
    );
}

function insertUnresolvedEdge(
  database: Database.Database,
  sourceRepoId: number,
  relType: string,
  targetName: string,
): void {
  database
    .prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      'repo', sourceRepoId, 'service_name', 0, relType, 'lib/client.ex',
      JSON.stringify({ confidence: 'high', unresolved: 'true', targetName }),
    );
}

// --- Fixtures ---

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-graph-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

// =========================================================================
// buildGraph
// =========================================================================

describe('buildGraph', () => {
  it('returns ServiceGraph with forward and reverse maps', () => {
    const a = insertRepo(db, 'svc-a');
    const b = insertRepo(db, 'svc-b');
    insertDirectEdge(db, a, b, 'calls_grpc', JSON.stringify({ confidence: 'high' }));

    const graph = buildGraph(db);

    expect(graph.forward).toBeInstanceOf(Map);
    expect(graph.reverse).toBeInstanceOf(Map);
    expect(graph.repoNames).toBeInstanceOf(Map);
    expect(graph.repoIds).toBeInstanceOf(Map);
  });

  it('direct repo-to-repo edges appear in both forward and reverse maps', () => {
    const a = insertRepo(db, 'svc-a');
    const b = insertRepo(db, 'svc-b');
    insertDirectEdge(db, a, b, 'calls_grpc', JSON.stringify({ confidence: 'high' }));

    const graph = buildGraph(db);

    // Forward: a -> b
    const fwd = graph.forward.get(a);
    expect(fwd).toBeDefined();
    expect(fwd!.some((e) => e.targetRepoId === b && e.mechanism === 'grpc')).toBe(true);

    // Reverse: b -> a
    const rev = graph.reverse.get(b);
    expect(rev).toBeDefined();
    expect(rev!.some((e) => e.targetRepoId === a)).toBe(true);
  });

  it('event-mediated edges resolve to single repo-to-repo edge with via metadata', () => {
    const a = insertRepo(db, 'producer-svc');
    const b = insertRepo(db, 'consumer-svc');
    const eventId = insertEvent(db, a, 'OrderCreated');
    insertEventEdge(db, a, eventId, 'produces_event');
    insertEventEdge(db, b, eventId, 'consumes_event');

    const graph = buildGraph(db);

    // Forward: producer -> consumer via event
    const fwd = graph.forward.get(a);
    expect(fwd).toBeDefined();
    const eventEdge = fwd!.find((e) => e.targetRepoId === b && e.mechanism === 'event');
    expect(eventEdge).toBeDefined();
    expect(eventEdge!.via).toBe('OrderCreated');
  });

  it('kafka edges resolve to single repo-to-repo edge with via metadata', () => {
    const a = insertRepo(db, 'kafka-prod');
    const b = insertRepo(db, 'kafka-cons');
    insertKafkaEdge(db, a, 'order-events', 'produces_kafka');
    insertKafkaEdge(db, b, 'order-events', 'consumes_kafka');

    const graph = buildGraph(db);

    const fwd = graph.forward.get(a);
    expect(fwd).toBeDefined();
    const kafkaEdge = fwd!.find((e) => e.targetRepoId === b && e.mechanism === 'kafka');
    expect(kafkaEdge).toBeDefined();
    expect(kafkaEdge!.via).toBe('order-events');
  });

  it('self-loops from event resolution are excluded', () => {
    const a = insertRepo(db, 'self-loop-svc');
    const eventId = insertEvent(db, a, 'InternalEvent');
    insertEventEdge(db, a, eventId, 'produces_event');
    insertEventEdge(db, a, eventId, 'consumes_event');

    const graph = buildGraph(db);

    const fwd = graph.forward.get(a) ?? [];
    expect(fwd.every((e) => e.targetRepoId !== a)).toBe(true);
  });

  it('duplicate event edges (same from/to/event) are deduplicated', () => {
    const a = insertRepo(db, 'dup-prod');
    const b = insertRepo(db, 'dup-cons');
    const eventId = insertEvent(db, a, 'DupEvent');
    // Two produce edges for same event from same repo
    insertEventEdge(db, a, eventId, 'produces_event');
    insertEventEdge(db, a, eventId, 'produces_event');
    insertEventEdge(db, b, eventId, 'consumes_event');

    const graph = buildGraph(db);

    const fwd = graph.forward.get(a) ?? [];
    const eventEdges = fwd.filter((e) => e.targetRepoId === b && e.mechanism === 'event' && e.via === 'DupEvent');
    expect(eventEdges.length).toBe(1);
  });

  it('duplicate kafka edges (same from/to/topic) are deduplicated', () => {
    const a = insertRepo(db, 'kafka-dup-prod');
    const b = insertRepo(db, 'kafka-dup-cons');
    // Two produce edges for same topic
    insertKafkaEdge(db, a, 'dup-topic', 'produces_kafka');
    insertKafkaEdge(db, a, 'dup-topic', 'produces_kafka');
    insertKafkaEdge(db, b, 'dup-topic', 'consumes_kafka');

    const graph = buildGraph(db);

    const fwd = graph.forward.get(a) ?? [];
    const kafkaEdges = fwd.filter((e) => e.targetRepoId === b && e.mechanism === 'kafka' && e.via === 'dup-topic');
    expect(kafkaEdges.length).toBe(1);
  });

  it('multiple edges between same pair with different mechanisms are kept', () => {
    const a = insertRepo(db, 'multi-a');
    const b = insertRepo(db, 'multi-b');
    insertDirectEdge(db, a, b, 'calls_grpc', JSON.stringify({ confidence: 'high' }));
    insertDirectEdge(db, a, b, 'calls_http', JSON.stringify({ confidence: 'low' }));

    const graph = buildGraph(db);

    const fwd = graph.forward.get(a) ?? [];
    const toB = fwd.filter((e) => e.targetRepoId === b);
    expect(toB.length).toBe(2);
    expect(toB.map((e) => e.mechanism).sort()).toEqual(['grpc', 'http']);
  });

  it('unresolved edges included in forward map with targetRepoId=0', () => {
    const a = insertRepo(db, 'unresolved-caller');
    insertUnresolvedEdge(db, a, 'calls_grpc', 'Rpc.Unknown.Service');

    const graph = buildGraph(db);

    const fwd = graph.forward.get(a) ?? [];
    const unresolved = fwd.filter((e) => e.targetRepoId === 0);
    expect(unresolved.length).toBe(1);
    expect(unresolved[0].via).toBe('Rpc.Unknown.Service');
  });

  it('repoNames maps id->name and repoIds maps name->id', () => {
    const a = insertRepo(db, 'name-test-svc');

    const graph = buildGraph(db);

    expect(graph.repoNames.get(a)).toBe('name-test-svc');
    expect(graph.repoIds.get('name-test-svc')).toBe(a);
  });

  it('confidence is extracted from metadata JSON for direct edges', () => {
    const a = insertRepo(db, 'conf-a');
    const b = insertRepo(db, 'conf-b');
    insertDirectEdge(db, a, b, 'calls_grpc', JSON.stringify({ confidence: 'medium' }));

    const graph = buildGraph(db);

    const fwd = graph.forward.get(a) ?? [];
    const edge = fwd.find((e) => e.targetRepoId === b);
    expect(edge).toBeDefined();
    expect(edge!.confidence).toBe('medium');
  });
});

// =========================================================================
// bfsDownstream
// =========================================================================

describe('bfsDownstream', () => {
  it('returns all reachable nodes via reverse adjacency with correct depth', () => {
    // A -> B -> C (forward). Downstream of A = {B at 1, C at 2}
    const a = insertRepo(db, 'root');
    const b = insertRepo(db, 'mid');
    const c = insertRepo(db, 'leaf');
    insertDirectEdge(db, a, b, 'calls_grpc');
    insertDirectEdge(db, b, c, 'calls_grpc');

    const graph = buildGraph(db);
    const result = bfsDownstream(graph, a);

    expect(result.length).toBe(2);
    const bNode = result.find((n) => n.repoId === b);
    const cNode = result.find((n) => n.repoId === c);
    expect(bNode).toBeDefined();
    expect(bNode!.depth).toBe(1);
    expect(cNode).toBeDefined();
    expect(cNode!.depth).toBe(2);
  });

  it('does not include the starting node', () => {
    const a = insertRepo(db, 'start');
    const b = insertRepo(db, 'dep');
    insertDirectEdge(db, a, b, 'calls_grpc');

    const graph = buildGraph(db);
    const result = bfsDownstream(graph, a);

    expect(result.every((n) => n.repoId !== a)).toBe(true);
  });

  it('respects maxDepth limit', () => {
    const a = insertRepo(db, 'depth-a');
    const b = insertRepo(db, 'depth-b');
    const c = insertRepo(db, 'depth-c');
    insertDirectEdge(db, a, b, 'calls_grpc');
    insertDirectEdge(db, b, c, 'calls_grpc');

    const graph = buildGraph(db);
    const result = bfsDownstream(graph, a, 1);

    expect(result.length).toBe(1);
    expect(result[0].repoId).toBe(b);
  });

  it('does not traverse from unresolved nodes (repoId=0)', () => {
    const a = insertRepo(db, 'unres-root');
    insertUnresolvedEdge(db, a, 'calls_grpc', 'UnknownService');

    const graph = buildGraph(db);
    const result = bfsDownstream(graph, a);

    // Unresolved node should not appear in downstream results
    expect(result.every((n) => n.repoId !== 0)).toBe(true);
  });

  it('handles cycles without infinite loops', () => {
    const a = insertRepo(db, 'cycle-a');
    const b = insertRepo(db, 'cycle-b');
    const c = insertRepo(db, 'cycle-c');
    insertDirectEdge(db, a, b, 'calls_grpc');
    insertDirectEdge(db, b, c, 'calls_grpc');
    insertDirectEdge(db, c, a, 'calls_grpc'); // cycle

    const graph = buildGraph(db);
    const result = bfsDownstream(graph, a);

    // Should terminate and include b and c exactly once
    expect(result.length).toBe(2);
    const ids = result.map((n) => n.repoId).sort();
    expect(ids).toEqual([b, c].sort());
  });

  it('returns empty array for unknown repoId', () => {
    insertRepo(db, 'some-svc');
    const graph = buildGraph(db);
    const result = bfsDownstream(graph, 99999);
    expect(result).toEqual([]);
  });
});

// =========================================================================
// shortestPath
// =========================================================================

describe('shortestPath', () => {
  it('returns empty array when from === to', () => {
    const a = insertRepo(db, 'same-node');
    const graph = buildGraph(db);
    const result = shortestPath(graph, a, a);
    expect(result).toEqual([]);
  });

  it('returns null when no path exists', () => {
    const a = insertRepo(db, 'island-a');
    const b = insertRepo(db, 'island-b');
    // No edges between them
    const graph = buildGraph(db);
    const result = shortestPath(graph, a, b);
    expect(result).toBeNull();
  });

  it('returns single hop for directly connected services', () => {
    const a = insertRepo(db, 'direct-a');
    const b = insertRepo(db, 'direct-b');
    insertDirectEdge(db, a, b, 'calls_grpc', JSON.stringify({ confidence: 'high' }));

    const graph = buildGraph(db);
    const result = shortestPath(graph, a, b);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    expect(result![0].fromRepoId).toBe(a);
    expect(result![0].toRepoId).toBe(b);
    expect(result![0].mechanism).toBe('grpc');
    expect(result![0].confidence).toBe('high');
  });

  it('returns shortest multi-hop path', () => {
    const a = insertRepo(db, 'path-a');
    const b = insertRepo(db, 'path-b');
    const c = insertRepo(db, 'path-c');
    insertDirectEdge(db, a, b, 'calls_grpc');
    insertDirectEdge(db, b, c, 'calls_http');

    const graph = buildGraph(db);
    const result = shortestPath(graph, a, c);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(2);
    expect(result![0].fromRepoId).toBe(a);
    expect(result![0].toRepoId).toBe(b);
    expect(result![1].fromRepoId).toBe(b);
    expect(result![1].toRepoId).toBe(c);
  });

  it('treats graph as undirected (traverses both forward and reverse edges)', () => {
    // A -> B exists. Path from B to A should work (reverse traversal).
    const a = insertRepo(db, 'undir-a');
    const b = insertRepo(db, 'undir-b');
    insertDirectEdge(db, a, b, 'calls_grpc');

    const graph = buildGraph(db);
    const result = shortestPath(graph, b, a);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
  });

  it('each hop has fromRepoName, toRepoName, mechanism, confidence, via', () => {
    const a = insertRepo(db, 'hop-a');
    const b = insertRepo(db, 'hop-b');
    insertDirectEdge(db, a, b, 'calls_grpc', JSON.stringify({ confidence: 'high' }));

    const graph = buildGraph(db);
    const result = shortestPath(graph, a, b);

    expect(result).not.toBeNull();
    const hop = result![0];
    expect(hop.fromRepoName).toBe('hop-a');
    expect(hop.toRepoName).toBe('hop-b');
    expect(hop.mechanism).toBe('grpc');
    expect(hop.confidence).toBe('high');
    expect(hop).toHaveProperty('via');
  });

  it('hops show actual edge direction (who calls whom), not traversal direction', () => {
    // A -> B (A calls B). Query path from B to A.
    // Hop should show from=A, to=B (actual call direction), not from=B, to=A.
    const a = insertRepo(db, 'dir-a');
    const b = insertRepo(db, 'dir-b');
    insertDirectEdge(db, a, b, 'calls_grpc');

    const graph = buildGraph(db);
    const result = shortestPath(graph, b, a);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(1);
    // The actual edge is A -> B, so hop should reflect that regardless of traversal direction
    expect(result![0].fromRepoId).toBe(a);
    expect(result![0].toRepoId).toBe(b);
  });
});

// =========================================================================
// bfsUpstream
// =========================================================================

describe('bfsUpstream', () => {
  // --- Core traversal ---

  it('returns all upstream dependents with correct depth', () => {
    // C -> B -> A (forward). Upstream of A = {B at 1, C at 2}
    const a = insertRepo(db, 'up-target');
    const b = insertRepo(db, 'up-mid');
    const c = insertRepo(db, 'up-root');
    insertDirectEdge(db, c, b, 'calls_grpc');
    insertDirectEdge(db, b, a, 'calls_grpc');

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a);

    expect(result.length).toBe(2);
    const bNode = result.find((n: ImpactNode) => n.repoId === b);
    const cNode = result.find((n: ImpactNode) => n.repoId === c);
    expect(bNode).toBeDefined();
    expect(bNode!.depth).toBe(1);
    expect(cNode).toBeDefined();
    expect(cNode!.depth).toBe(2);
  });

  it('does not include the starting node in results', () => {
    const a = insertRepo(db, 'up-start');
    const b = insertRepo(db, 'up-caller');
    insertDirectEdge(db, b, a, 'calls_grpc');

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a);

    expect(result.every((n: ImpactNode) => n.repoId !== a)).toBe(true);
  });

  it('traverses graph.reverse (not graph.forward)', () => {
    // B -> A (forward). Upstream of A should find B.
    // Downstream of A should NOT find B.
    const a = insertRepo(db, 'up-check-a');
    const b = insertRepo(db, 'up-check-b');
    insertDirectEdge(db, b, a, 'calls_grpc');

    const graph = buildGraph(db);
    const upstream = bfsUpstream(graph, a);
    const downstream = bfsDownstream(graph, a);

    expect(upstream.length).toBe(1);
    expect(upstream[0].repoId).toBe(b);
    expect(downstream.length).toBe(0);
  });

  it('does not traverse from unresolved nodes (repoId=0)', () => {
    const a = insertRepo(db, 'up-unres');
    insertUnresolvedEdge(db, a, 'calls_grpc', 'UnknownUpstream');

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a);

    expect(result.every((n: ImpactNode) => n.repoId !== 0)).toBe(true);
  });

  it('handles cycles without infinite loops', () => {
    const a = insertRepo(db, 'up-cyc-a');
    const b = insertRepo(db, 'up-cyc-b');
    const c = insertRepo(db, 'up-cyc-c');
    insertDirectEdge(db, b, a, 'calls_grpc');
    insertDirectEdge(db, c, b, 'calls_grpc');
    insertDirectEdge(db, a, c, 'calls_grpc'); // cycle

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a);

    expect(result.length).toBe(2);
    const ids = result.map((n: ImpactNode) => n.repoId).sort();
    expect(ids).toEqual([b, c].sort());
  });

  // --- Mechanism filtering ---

  it('mechanism filter only follows matching edges during traversal', () => {
    // C -grpc-> B -grpc-> A, D -event-> A
    // Upstream of A filtered by "grpc" should return B and C, NOT D
    const a = insertRepo(db, 'mech-target');
    const b = insertRepo(db, 'mech-grpc-1');
    const c = insertRepo(db, 'mech-grpc-2');
    const d = insertRepo(db, 'mech-event');
    insertDirectEdge(db, b, a, 'calls_grpc');
    insertDirectEdge(db, c, b, 'calls_grpc');
    insertDirectEdge(db, d, a, 'calls_http');

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a, 3, 'grpc');

    expect(result.length).toBe(2);
    const ids = result.map((n: ImpactNode) => n.repoId).sort();
    expect(ids).toEqual([b, c].sort());
  });

  it('mechanism filter stops traversal at non-matching edges', () => {
    // C -event-> B -grpc-> A.
    // Upstream of A filtered by "grpc" returns only B (depth 1), NOT C
    const a = insertRepo(db, 'mech-stop-a');
    const b = insertRepo(db, 'mech-stop-b');
    const c = insertRepo(db, 'mech-stop-c');
    insertDirectEdge(db, b, a, 'calls_grpc');
    insertDirectEdge(db, c, b, 'calls_http');

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a, 3, 'grpc');

    expect(result.length).toBe(1);
    expect(result[0].repoId).toBe(b);
  });

  it('without mechanism filter returns all upstream dependents', () => {
    // C -event-> B -grpc-> A
    const a = insertRepo(db, 'no-mech-a');
    const b = insertRepo(db, 'no-mech-b');
    const c = insertRepo(db, 'no-mech-c');
    insertDirectEdge(db, b, a, 'calls_grpc');
    insertDirectEdge(db, c, b, 'calls_http');

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a);

    expect(result.length).toBe(2);
  });

  // --- Depth limiting ---

  it('defaults to maxDepth=3', () => {
    // Build chain: E -> D -> C -> B -> A. Default depth=3 should return B, C, D but not E.
    const a = insertRepo(db, 'depth-def-a');
    const b = insertRepo(db, 'depth-def-b');
    const c = insertRepo(db, 'depth-def-c');
    const d = insertRepo(db, 'depth-def-d');
    const e = insertRepo(db, 'depth-def-e');
    insertDirectEdge(db, b, a, 'calls_grpc');
    insertDirectEdge(db, c, b, 'calls_grpc');
    insertDirectEdge(db, d, c, 'calls_grpc');
    insertDirectEdge(db, e, d, 'calls_grpc');

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a); // default maxDepth=3

    expect(result.length).toBe(3);
    const ids = result.map((n: ImpactNode) => n.repoId).sort();
    expect(ids).toEqual([b, c, d].sort());
  });

  it('maxDepth=1 returns only direct callers', () => {
    const a = insertRepo(db, 'depth1-a');
    const b = insertRepo(db, 'depth1-b');
    const c = insertRepo(db, 'depth1-c');
    insertDirectEdge(db, b, a, 'calls_grpc');
    insertDirectEdge(db, c, b, 'calls_grpc');

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a, 1);

    expect(result.length).toBe(1);
    expect(result[0].repoId).toBe(b);
    expect(result[0].depth).toBe(1);
  });

  it('maxDepth=2 returns direct and indirect callers', () => {
    const a = insertRepo(db, 'depth2-a');
    const b = insertRepo(db, 'depth2-b');
    const c = insertRepo(db, 'depth2-c');
    const d = insertRepo(db, 'depth2-d');
    insertDirectEdge(db, b, a, 'calls_grpc');
    insertDirectEdge(db, c, b, 'calls_grpc');
    insertDirectEdge(db, d, c, 'calls_grpc');

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a, 2);

    expect(result.length).toBe(2);
    const ids = result.map((n: ImpactNode) => n.repoId).sort();
    expect(ids).toEqual([b, c].sort());
  });

  // --- Multi-edge collection ---

  it('collects ALL edges from affected node to nodes in the BFS subgraph', () => {
    // B depends on A via BOTH grpc and http. Upstream of A should find B with 2 edges.
    const a = insertRepo(db, 'multi-edge-a');
    const b = insertRepo(db, 'multi-edge-b');
    insertDirectEdge(db, b, a, 'calls_grpc', JSON.stringify({ confidence: 'high' }));
    insertDirectEdge(db, b, a, 'calls_http', JSON.stringify({ confidence: 'low' }));

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a);

    expect(result.length).toBe(1);
    expect(result[0].repoId).toBe(b);
    expect(result[0].edges.length).toBe(2);
    const mechanisms = result[0].edges.map((e: { mechanism: string }) => e.mechanism).sort();
    expect(mechanisms).toEqual(['grpc', 'http']);
  });

  it('edge collection uses graph.forward to find outgoing edges into the subgraph', () => {
    // C -> B -> A. Upstream of A = {B, C}.
    // B's forward edges pointing into subgraph: B -> A
    // C's forward edges pointing into subgraph: C -> B
    const a = insertRepo(db, 'fwd-coll-a');
    const b = insertRepo(db, 'fwd-coll-b');
    const c = insertRepo(db, 'fwd-coll-c');
    insertDirectEdge(db, b, a, 'calls_grpc');
    insertDirectEdge(db, c, b, 'calls_http');

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a);

    const bNode = result.find((n: ImpactNode) => n.repoId === b);
    const cNode = result.find((n: ImpactNode) => n.repoId === c);
    expect(bNode).toBeDefined();
    expect(bNode!.edges.length).toBe(1);
    expect(bNode!.edges[0].mechanism).toBe('grpc');
    expect(cNode).toBeDefined();
    expect(cNode!.edges.length).toBe(1);
    expect(cNode!.edges[0].mechanism).toBe('http');
  });

  it('mechanism filter also filters collected edges', () => {
    // B depends on A via grpc and http. Filter for grpc should only collect grpc edge.
    const a = insertRepo(db, 'mech-edge-a');
    const b = insertRepo(db, 'mech-edge-b');
    insertDirectEdge(db, b, a, 'calls_grpc', JSON.stringify({ confidence: 'high' }));
    insertDirectEdge(db, b, a, 'calls_http', JSON.stringify({ confidence: 'low' }));

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a, 3, 'grpc');

    expect(result.length).toBe(1);
    expect(result[0].edges.length).toBe(1);
    expect(result[0].edges[0].mechanism).toBe('grpc');
    expect(result[0].edges[0].confidence).toBe('high');
  });

  // --- Edge cases ---

  it('returns empty array for unknown repoId', () => {
    insertRepo(db, 'up-unknown');
    const graph = buildGraph(db);
    const result = bfsUpstream(graph, 99999);
    expect(result).toEqual([]);
  });

  it('returns empty array when no upstream dependents exist', () => {
    const a = insertRepo(db, 'up-isolated');
    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a);
    expect(result).toEqual([]);
  });

  it('returns empty array when graph has only unresolved edges', () => {
    const a = insertRepo(db, 'up-unres-only');
    insertUnresolvedEdge(db, a, 'calls_grpc', 'GhostService');

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a);

    expect(result).toEqual([]);
  });

  it('each ImpactNode has repoId, repoName, depth, and edges array', () => {
    const a = insertRepo(db, 'impact-shape-a');
    const b = insertRepo(db, 'impact-shape-b');
    insertDirectEdge(db, b, a, 'calls_grpc', JSON.stringify({ confidence: 'high' }));

    const graph = buildGraph(db);
    const result = bfsUpstream(graph, a);

    expect(result.length).toBe(1);
    const node = result[0];
    expect(node).toHaveProperty('repoId', b);
    expect(node).toHaveProperty('repoName', 'impact-shape-b');
    expect(node).toHaveProperty('depth', 1);
    expect(node).toHaveProperty('edges');
    expect(Array.isArray(node.edges)).toBe(true);
    expect(node.edges[0]).toHaveProperty('mechanism');
    expect(node.edges[0]).toHaveProperty('confidence');
  });
});
