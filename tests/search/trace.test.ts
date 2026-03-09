import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { traceRoute } from '../../src/search/trace.js';
import type { TraceResult, TraceHop } from '../../src/search/trace.js';

let db: Database.Database;
let dbPath: string;

// --- Test helpers (same pattern as impact.test.ts) ---

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

// --- Fixtures ---

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-trace-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

// =========================================================================
// traceRoute - Response shape
// =========================================================================

describe('traceRoute', () => {
  describe('response shape', () => {
    it('returns correct result for a 2-hop path with mechanisms', () => {
      // A -[grpc]-> B -[http]-> C
      const a = insertRepo(db, 'app-api');
      const b = insertRepo(db, 'app-gateway');
      const c = insertRepo(db, 'app-payments');
      insertDirectEdge(db, a, b, 'calls_grpc');
      insertDirectEdge(db, b, c, 'calls_http');

      const result = traceRoute(db, 'app-api', 'app-payments');

      expect(result.from).toBe('app-api');
      expect(result.to).toBe('app-payments');
      expect(result.hop_count).toBe(2);
      expect(result.hops).toHaveLength(2);
      expect(result.hops[0]).toEqual({ from: 'app-api', to: 'app-gateway', mechanism: 'grpc' });
      expect(result.hops[1]).toEqual({ from: 'app-gateway', to: 'app-payments', mechanism: 'http' });
    });

    it('hops contain only from, to, mechanism (no IDs, no confidence)', () => {
      const a = insertRepo(db, 'svc-a');
      const b = insertRepo(db, 'svc-b');
      insertDirectEdge(db, a, b, 'calls_grpc', JSON.stringify({ confidence: 'high' }));

      const result = traceRoute(db, 'svc-a', 'svc-b');
      const hop = result.hops[0];

      // Should have exactly from, to, mechanism
      expect(Object.keys(hop).sort()).toEqual(['from', 'mechanism', 'to']);
      // No IDs or confidence
      expect(hop).not.toHaveProperty('fromRepoId');
      expect(hop).not.toHaveProperty('toRepoId');
      expect(hop).not.toHaveProperty('confidence');
    });

    it('returns single-hop result for directly connected services', () => {
      const a = insertRepo(db, 'direct-a');
      const b = insertRepo(db, 'direct-b');
      insertDirectEdge(db, a, b, 'calls_grpc');

      const result = traceRoute(db, 'direct-a', 'direct-b');

      expect(result.hop_count).toBe(1);
      expect(result.hops).toHaveLength(1);
      expect(result.hops[0].from).toBe('direct-a');
      expect(result.hops[0].to).toBe('direct-b');
    });
  });

  // =========================================================================
  // Arrow chain path_summary
  // =========================================================================

  describe('path_summary arrow chain', () => {
    it('uses arrow notation for grpc hops: "A -[grpc]-> B"', () => {
      const a = insertRepo(db, 'arrow-a');
      const b = insertRepo(db, 'arrow-b');
      insertDirectEdge(db, a, b, 'calls_grpc');

      const result = traceRoute(db, 'arrow-a', 'arrow-b');

      expect(result.path_summary).toBe('arrow-a -[grpc]-> arrow-b');
    });

    it('uses arrow notation for multi-hop: "A -[grpc]-> B -[http]-> C"', () => {
      const a = insertRepo(db, 'multi-a');
      const b = insertRepo(db, 'multi-b');
      const c = insertRepo(db, 'multi-c');
      insertDirectEdge(db, a, b, 'calls_grpc');
      insertDirectEdge(db, b, c, 'calls_http');

      const result = traceRoute(db, 'multi-a', 'multi-c');

      expect(result.path_summary).toBe('multi-a -[grpc]-> multi-b -[http]-> multi-c');
    });

    it('includes via for event hops: "A -[event: OrderCreated]-> B"', () => {
      const a = insertRepo(db, 'evt-producer');
      const b = insertRepo(db, 'evt-consumer');
      const evtId = insertEvent(db, a, 'OrderCreated');
      insertEventEdge(db, a, evtId, 'produces_event');
      insertEventEdge(db, b, evtId, 'consumes_event');

      const result = traceRoute(db, 'evt-producer', 'evt-consumer');

      expect(result.path_summary).toBe('evt-producer -[event: OrderCreated]-> evt-consumer');
    });

    it('includes via for kafka hops: "A -[kafka: orders-topic]-> B"', () => {
      const a = insertRepo(db, 'kafka-producer');
      const b = insertRepo(db, 'kafka-consumer');
      insertKafkaEdge(db, a, 'orders-topic', 'produces_kafka');
      insertKafkaEdge(db, b, 'orders-topic', 'consumes_kafka');

      const result = traceRoute(db, 'kafka-producer', 'kafka-consumer');

      expect(result.path_summary).toBe('kafka-producer -[kafka: orders-topic]-> kafka-consumer');
    });

    it('omits via for event hops with null via: "A -[event]-> B"', () => {
      // This tests the edge case where via is null for an event hop.
      // In practice this shouldn't happen with well-formed data, but the code should handle it.
      // We'll create a direct edge with event mechanism to simulate this.
      // Actually, the graph resolves event edges from produces_event/consumes_event,
      // and event edges always have via (event name). To get a null via, we'd need
      // a direct repo->repo edge with event mechanism. That's unusual but we test the formatting logic.
      const a = insertRepo(db, 'evt-null-a');
      const b = insertRepo(db, 'evt-null-b');
      // Insert a direct repo->repo edge with relationship_type that maps to 'event'
      // but no via (null metadata target)
      insertDirectEdge(db, a, b, 'produces_event');

      const result = traceRoute(db, 'evt-null-a', 'evt-null-b');

      // With null via, should just show mechanism without colon
      expect(result.path_summary).toBe('evt-null-a -[event]-> evt-null-b');
    });
  });

  // =========================================================================
  // via field in hops
  // =========================================================================

  describe('via field in hops', () => {
    it('includes via for event hops when non-null', () => {
      const a = insertRepo(db, 'via-evt-a');
      const b = insertRepo(db, 'via-evt-b');
      const evtId = insertEvent(db, a, 'PaymentProcessed');
      insertEventEdge(db, a, evtId, 'produces_event');
      insertEventEdge(db, b, evtId, 'consumes_event');

      const result = traceRoute(db, 'via-evt-a', 'via-evt-b');

      expect(result.hops[0].via).toBe('PaymentProcessed');
      expect(Object.keys(result.hops[0]).sort()).toEqual(['from', 'mechanism', 'to', 'via']);
    });

    it('includes via for kafka hops when non-null', () => {
      const a = insertRepo(db, 'via-kafka-a');
      const b = insertRepo(db, 'via-kafka-b');
      insertKafkaEdge(db, a, 'payment-events', 'produces_kafka');
      insertKafkaEdge(db, b, 'payment-events', 'consumes_kafka');

      const result = traceRoute(db, 'via-kafka-a', 'via-kafka-b');

      expect(result.hops[0].via).toBe('payment-events');
    });

    it('omits via field entirely for grpc hops', () => {
      const a = insertRepo(db, 'no-via-a');
      const b = insertRepo(db, 'no-via-b');
      insertDirectEdge(db, a, b, 'calls_grpc');

      const result = traceRoute(db, 'no-via-a', 'no-via-b');

      expect(result.hops[0]).not.toHaveProperty('via');
    });

    it('omits via field entirely for http hops', () => {
      const a = insertRepo(db, 'no-via-http-a');
      const b = insertRepo(db, 'no-via-http-b');
      insertDirectEdge(db, a, b, 'calls_http');

      const result = traceRoute(db, 'no-via-http-a', 'no-via-http-b');

      expect(result.hops[0]).not.toHaveProperty('via');
    });

    it('omits via field entirely for gateway hops', () => {
      const a = insertRepo(db, 'no-via-gw-a');
      const b = insertRepo(db, 'no-via-gw-b');
      insertDirectEdge(db, a, b, 'routes_to');

      const result = traceRoute(db, 'no-via-gw-a', 'no-via-gw-b');

      expect(result.hops[0]).not.toHaveProperty('via');
    });
  });

  // =========================================================================
  // Same-service
  // =========================================================================

  describe('same-service', () => {
    it('returns zero-hop success with "(same service)" summary', () => {
      insertRepo(db, 'app-api');

      const result = traceRoute(db, 'app-api', 'app-api');

      expect(result.from).toBe('app-api');
      expect(result.to).toBe('app-api');
      expect(result.path_summary).toBe('app-api (same service)');
      expect(result.hop_count).toBe(0);
      expect(result.hops).toEqual([]);
    });

    it('is checked before calling shortestPath (does not require graph edges)', () => {
      // Service exists but has no edges at all
      insertRepo(db, 'isolated-svc');

      // Should still succeed for same-service query
      const result = traceRoute(db, 'isolated-svc', 'isolated-svc');

      expect(result.hop_count).toBe(0);
      expect(result.path_summary).toBe('isolated-svc (same service)');
    });
  });

  // =========================================================================
  // Error: service not found
  // =========================================================================

  describe('error: service not found', () => {
    it('throws "Service not found: X" for single missing service', () => {
      insertRepo(db, 'real-svc');

      expect(() => traceRoute(db, 'real-svc', 'ghost-svc')).toThrow(
        'Service not found: ghost-svc',
      );
    });

    it('throws "Services not found: X, Y" when both services missing', () => {
      insertRepo(db, 'some-other-svc');

      expect(() => traceRoute(db, 'app-foo', 'app-bar')).toThrow(
        'Services not found: app-foo, app-bar',
      );
    });

    it('validates both upfront and reports both in one error', () => {
      // Even with one real service, if both from and to are missing, report both
      insertRepo(db, 'existing');

      try {
        traceRoute(db, 'missing-from', 'missing-to');
        expect.unreachable('Should have thrown');
      } catch (e: any) {
        expect(e.message).toContain('missing-from');
        expect(e.message).toContain('missing-to');
        expect(e.message).toMatch(/^Services not found:/);
      }
    });

    it('throws for missing "from" service even when "to" exists', () => {
      insertRepo(db, 'exists-svc');

      expect(() => traceRoute(db, 'no-such-svc', 'exists-svc')).toThrow(
        'Service not found: no-such-svc',
      );
    });
  });

  // =========================================================================
  // Error: no path
  // =========================================================================

  describe('error: no path', () => {
    it('throws "No path between X and Y" when services exist but are disconnected', () => {
      insertRepo(db, 'island-a');
      insertRepo(db, 'island-b');

      expect(() => traceRoute(db, 'island-a', 'island-b')).toThrow(
        'No path between island-a and island-b',
      );
    });
  });

  // =========================================================================
  // Confidence
  // =========================================================================

  describe('confidence', () => {
    it('no confidence fields appear anywhere in TraceResult', () => {
      const a = insertRepo(db, 'conf-a');
      const b = insertRepo(db, 'conf-b');
      insertDirectEdge(db, a, b, 'calls_grpc', JSON.stringify({ confidence: 'high' }));

      const result = traceRoute(db, 'conf-a', 'conf-b');

      // Stringify and check no confidence anywhere
      const json = JSON.stringify(result);
      expect(json).not.toContain('confidence');

      // Check individual hop
      expect(result.hops[0]).not.toHaveProperty('confidence');

      // Check top-level
      expect(result).not.toHaveProperty('min_confidence');
    });
  });
});
