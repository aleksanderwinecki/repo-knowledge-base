import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { explainService } from '../../src/search/explain.js';
import type { ExplainResult } from '../../src/search/explain.js';

let db: Database.Database;
let dbPath: string;

// --- Test helpers (same pattern as trace.test.ts) ---

function insertRepo(database: Database.Database, name: string, description?: string | null): number {
  const result = database
    .prepare('INSERT INTO repos (name, path, description) VALUES (?, ?, ?)')
    .run(name, `/repos/${name}`, description ?? `${name} service`);
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

function insertModule(
  database: Database.Database,
  repoId: number,
  name: string,
  type: string,
): void {
  database
    .prepare('INSERT INTO modules (repo_id, name, type) VALUES (?, ?, ?)')
    .run(repoId, name, type);
}

function insertFile(database: Database.Database, repoId: number, filePath: string): void {
  database
    .prepare('INSERT INTO files (repo_id, path) VALUES (?, ?)')
    .run(repoId, filePath);
}

function insertService(database: Database.Database, repoId: number, name: string): void {
  database
    .prepare('INSERT INTO services (repo_id, name) VALUES (?, ?)')
    .run(repoId, name);
}

// --- Fixtures ---

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-explain-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

// =========================================================================
// explainService - Identity
// =========================================================================

describe('explainService', () => {
  describe('identity', () => {
    it('returns name, description, and path for a known repo', () => {
      insertRepo(db, 'app-payments', 'Handles payment processing');

      const result = explainService(db, 'app-payments');

      expect(result.name).toBe('app-payments');
      expect(result.description).toBe('Handles payment processing');
      expect(result.path).toBe('/repos/app-payments');
    });

    it('returns null description when repo has no description', () => {
      const id = db
        .prepare('INSERT INTO repos (name, path) VALUES (?, ?)')
        .run('app-bare', '/repos/app-bare');

      const result = explainService(db, 'app-bare');

      expect(result.description).toBeNull();
    });

    it('throws "Service not found" for unknown service', () => {
      insertRepo(db, 'app-real');

      expect(() => explainService(db, 'app-ghost')).toThrow(
        'Service not found: app-ghost',
      );
    });
  });

  // =========================================================================
  // Connections - Direct edges
  // =========================================================================

  describe('connections - direct edges', () => {
    it('groups outbound direct edges under talks_to by mechanism', () => {
      const a = insertRepo(db, 'app-api');
      const b = insertRepo(db, 'app-payments');
      const c = insertRepo(db, 'app-gateway');
      insertDirectEdge(db, a, b, 'calls_grpc');
      insertDirectEdge(db, a, c, 'calls_http');

      const result = explainService(db, 'app-api');

      expect(result.talks_to.grpc).toContain('app-payments');
      expect(result.talks_to.http).toContain('app-gateway');
    });

    it('groups inbound direct edges under called_by by mechanism', () => {
      const a = insertRepo(db, 'app-api');
      const b = insertRepo(db, 'app-frontend');
      insertDirectEdge(db, b, a, 'calls_grpc');

      const result = explainService(db, 'app-api');

      expect(result.called_by.grpc).toContain('app-frontend');
    });

    it('normalizes routes_to to gateway mechanism', () => {
      const a = insertRepo(db, 'app-gw');
      const b = insertRepo(db, 'app-backend');
      insertDirectEdge(db, a, b, 'routes_to');

      const result = explainService(db, 'app-gw');

      expect(result.talks_to.gateway).toContain('app-backend');
    });

    it('deduplicates same (target, mechanism) pairs', () => {
      const a = insertRepo(db, 'app-caller');
      const b = insertRepo(db, 'app-target');
      // Two separate gRPC edges to the same target
      insertDirectEdge(db, a, b, 'calls_grpc');
      insertDirectEdge(db, a, b, 'calls_grpc');

      const result = explainService(db, 'app-caller');

      expect(result.talks_to.grpc).toEqual(['app-target']);
    });

    it('excludes self-referencing edges', () => {
      const a = insertRepo(db, 'app-self');
      insertDirectEdge(db, a, a, 'calls_grpc');

      const result = explainService(db, 'app-self');

      expect(result.talks_to).toEqual({});
      expect(result.called_by).toEqual({});
    });
  });

  // =========================================================================
  // Connections - Event-mediated
  // =========================================================================

  describe('connections - event-mediated', () => {
    it('resolves outbound event-mediated connections under talks_to.event', () => {
      const a = insertRepo(db, 'app-orders');
      const b = insertRepo(db, 'app-notifications');
      const evtId = insertEvent(db, a, 'OrderCreated');
      insertEventEdge(db, a, evtId, 'produces_event');
      insertEventEdge(db, b, evtId, 'consumes_event');

      const result = explainService(db, 'app-orders');

      expect(result.talks_to.event).toContain('app-notifications');
    });

    it('resolves inbound event-mediated connections under called_by.event', () => {
      const a = insertRepo(db, 'app-orders');
      const b = insertRepo(db, 'app-notifications');
      const evtId = insertEvent(db, a, 'OrderCreated');
      insertEventEdge(db, a, evtId, 'produces_event');
      insertEventEdge(db, b, evtId, 'consumes_event');

      const result = explainService(db, 'app-notifications');

      expect(result.called_by.event).toContain('app-orders');
    });

    it('does not include self in event-mediated connections', () => {
      const a = insertRepo(db, 'app-selfevt');
      const evtId = insertEvent(db, a, 'SomeEvent');
      insertEventEdge(db, a, evtId, 'produces_event');
      insertEventEdge(db, a, evtId, 'consumes_event');

      const result = explainService(db, 'app-selfevt');

      expect(result.talks_to).toEqual({});
      expect(result.called_by).toEqual({});
    });
  });

  // =========================================================================
  // Connections - Kafka-mediated
  // =========================================================================

  describe('connections - kafka-mediated', () => {
    it('resolves outbound kafka-mediated connections under talks_to.kafka', () => {
      const a = insertRepo(db, 'app-producer');
      const b = insertRepo(db, 'app-consumer');
      insertKafkaEdge(db, a, 'orders-topic', 'produces_kafka');
      insertKafkaEdge(db, b, 'orders-topic', 'consumes_kafka');

      const result = explainService(db, 'app-producer');

      expect(result.talks_to.kafka).toContain('app-consumer');
    });

    it('resolves inbound kafka-mediated connections under called_by.kafka', () => {
      const a = insertRepo(db, 'app-producer');
      const b = insertRepo(db, 'app-consumer');
      insertKafkaEdge(db, a, 'orders-topic', 'produces_kafka');
      insertKafkaEdge(db, b, 'orders-topic', 'consumes_kafka');

      const result = explainService(db, 'app-consumer');

      expect(result.called_by.kafka).toContain('app-producer');
    });
  });

  // =========================================================================
  // Summary line
  // =========================================================================

  describe('summary line', () => {
    it('builds correct summary with mechanism breakdown', () => {
      const a = insertRepo(db, 'app-hub');
      const b = insertRepo(db, 'app-svc1');
      const c = insertRepo(db, 'app-svc2');
      const d = insertRepo(db, 'app-svc3');
      insertDirectEdge(db, a, b, 'calls_grpc');
      insertDirectEdge(db, a, c, 'calls_grpc');
      insertDirectEdge(db, a, d, 'calls_http');

      // One inbound
      const e = insertRepo(db, 'app-caller');
      insertDirectEdge(db, e, a, 'calls_grpc');

      const result = explainService(db, 'app-hub');

      expect(result.summary).toMatch(/^Talks to 3 services/);
      expect(result.summary).toContain('2 via grpc');
      expect(result.summary).toContain('1 via http');
      expect(result.summary).toMatch(/Called by 1 services?\.$/);
    });

    it('handles zero connections gracefully', () => {
      insertRepo(db, 'app-isolated');

      const result = explainService(db, 'app-isolated');

      expect(result.summary).toBe('Talks to 0 services. Called by 0 services.');
    });

    it('includes event and kafka counts in breakdown', () => {
      const a = insertRepo(db, 'app-mixed');
      const b = insertRepo(db, 'app-evt-consumer');
      const c = insertRepo(db, 'app-kafka-consumer');
      const d = insertRepo(db, 'app-grpc-target');

      insertDirectEdge(db, a, d, 'calls_grpc');

      const evtId = insertEvent(db, a, 'MixedEvent');
      insertEventEdge(db, a, evtId, 'produces_event');
      insertEventEdge(db, b, evtId, 'consumes_event');

      insertKafkaEdge(db, a, 'mixed-topic', 'produces_kafka');
      insertKafkaEdge(db, c, 'mixed-topic', 'consumes_kafka');

      const result = explainService(db, 'app-mixed');

      expect(result.summary).toMatch(/^Talks to 3 services/);
      expect(result.summary).toContain('via grpc');
      expect(result.summary).toContain('via event');
      expect(result.summary).toContain('via kafka');
    });
  });

  // =========================================================================
  // Events section
  // =========================================================================

  describe('events section', () => {
    it('returns event names produced by the service', () => {
      const a = insertRepo(db, 'app-evt-producer');
      const evtId1 = insertEvent(db, a, 'OrderCreated');
      const evtId2 = insertEvent(db, a, 'OrderUpdated');
      insertEventEdge(db, a, evtId1, 'produces_event');
      insertEventEdge(db, a, evtId2, 'produces_event');

      const result = explainService(db, 'app-evt-producer');

      expect(result.events.produces).toContain('OrderCreated');
      expect(result.events.produces).toContain('OrderUpdated');
      expect(result.events.produces).toHaveLength(2);
    });

    it('returns event names consumed by the service', () => {
      const a = insertRepo(db, 'app-evt-consumer2');
      const producer = insertRepo(db, 'app-some-producer');
      const evtId = insertEvent(db, producer, 'PaymentProcessed');
      insertEventEdge(db, producer, evtId, 'produces_event');
      insertEventEdge(db, a, evtId, 'consumes_event');

      const result = explainService(db, 'app-evt-consumer2');

      expect(result.events.consumes).toContain('PaymentProcessed');
      expect(result.events.consumes).toHaveLength(1);
    });

    it('returns empty arrays when no events', () => {
      insertRepo(db, 'app-no-events');

      const result = explainService(db, 'app-no-events');

      expect(result.events.produces).toEqual([]);
      expect(result.events.consumes).toEqual([]);
    });
  });

  // =========================================================================
  // Modules section
  // =========================================================================

  describe('modules section', () => {
    it('returns counts per module type with top 5 names', () => {
      const a = insertRepo(db, 'app-modular');
      insertModule(db, a, 'AccountContext', 'context');
      insertModule(db, a, 'BillingContext', 'context');
      insertModule(db, a, 'CatalogContext', 'context');
      insertModule(db, a, 'DeliveryContext', 'context');
      insertModule(db, a, 'EventContext', 'context');
      insertModule(db, a, 'FulfillmentContext', 'context'); // 6th - should not appear in top
      insertModule(db, a, 'UserSchema', 'schema');
      insertModule(db, a, 'OrderSchema', 'schema');

      const result = explainService(db, 'app-modular');

      expect(result.modules.context.count).toBe(6);
      expect(result.modules.context.top).toHaveLength(5);
      // Alphabetical order
      expect(result.modules.context.top[0]).toBe('AccountContext');
      expect(result.modules.context.top[4]).toBe('EventContext');
      expect(result.modules.context.top).not.toContain('FulfillmentContext');

      expect(result.modules.schema.count).toBe(2);
      expect(result.modules.schema.top).toEqual(['OrderSchema', 'UserSchema']);
    });

    it('returns empty modules object for repo with no modules', () => {
      insertRepo(db, 'app-empty-mods');

      const result = explainService(db, 'app-empty-mods');

      expect(result.modules).toEqual({});
    });
  });

  // =========================================================================
  // Counts section
  // =========================================================================

  describe('counts section', () => {
    it('returns file count and gRPC service count', () => {
      const a = insertRepo(db, 'app-counted');
      insertFile(db, a, 'src/main.ex');
      insertFile(db, a, 'src/router.ex');
      insertFile(db, a, 'src/handler.ex');
      insertService(db, a, 'PaymentService');
      insertService(db, a, 'InvoiceService');

      const result = explainService(db, 'app-counted');

      expect(result.counts.files).toBe(3);
      expect(result.counts.grpc_services).toBe(2);
    });

    it('returns zero counts for empty repo', () => {
      insertRepo(db, 'app-zero');

      const result = explainService(db, 'app-zero');

      expect(result.counts.files).toBe(0);
      expect(result.counts.grpc_services).toBe(0);
    });
  });

  // =========================================================================
  // Hints section
  // =========================================================================

  describe('hints section', () => {
    it('returns static hints with service name substituted', () => {
      insertRepo(db, 'app-hinted');

      const result = explainService(db, 'app-hinted');

      expect(result.hints).toHaveLength(3);
      expect(result.hints.some(h => h.includes('app-hinted'))).toBe(true);
      expect(result.hints.some(h => h.includes('kb_impact'))).toBe(true);
      expect(result.hints.some(h => h.includes('kb_trace'))).toBe(true);
      expect(result.hints.some(h => h.includes('kb_deps'))).toBe(true);
      // Should NOT contain the placeholder
      expect(result.hints.every(h => !h.includes('<this-service>'))).toBe(true);
    });
  });

  // =========================================================================
  // Truncation
  // =========================================================================

  describe('truncation', () => {
    it('caps connections at ~20 per direction with "...and N more" entry', () => {
      const hub = insertRepo(db, 'app-mega-hub');
      // Create 25 outbound grpc targets
      for (let i = 0; i < 25; i++) {
        const target = insertRepo(db, `app-target-${String(i).padStart(2, '0')}`);
        insertDirectEdge(db, hub, target, 'calls_grpc');
      }

      const result = explainService(db, 'app-mega-hub');

      // Count total entries across all mechanisms in talks_to
      const totalEntries = Object.values(result.talks_to).flat().length;
      // Should be capped around 20 (could be 20 real + 1 truncation marker = 21)
      expect(totalEntries).toBeLessThanOrEqual(21);
      // Should have truncation marker
      const allNames = Object.values(result.talks_to).flat();
      const truncationEntry = allNames.find(n => n.startsWith('...and'));
      expect(truncationEntry).toBeDefined();
      expect(truncationEntry).toMatch(/\.\.\.and \d+ more/);
    });

    it('does not truncate when under 20 connections', () => {
      const a = insertRepo(db, 'app-normal');
      for (let i = 0; i < 5; i++) {
        const target = insertRepo(db, `app-norm-target-${i}`);
        insertDirectEdge(db, a, target, 'calls_grpc');
      }

      const result = explainService(db, 'app-normal');

      const allNames = Object.values(result.talks_to).flat();
      expect(allNames).toHaveLength(5);
      expect(allNames.every(n => !n.startsWith('...and'))).toBe(true);
    });
  });

  // =========================================================================
  // Full card - integration
  // =========================================================================

  describe('full card', () => {
    it('returns a complete ExplainResult with all sections populated', () => {
      const a = insertRepo(db, 'app-full', 'The full-featured service');
      const b = insertRepo(db, 'app-dep');
      const c = insertRepo(db, 'app-caller2');

      // Direct edges
      insertDirectEdge(db, a, b, 'calls_grpc');
      insertDirectEdge(db, c, a, 'calls_http');

      // Events
      const evtId = insertEvent(db, a, 'FullEvent');
      insertEventEdge(db, a, evtId, 'produces_event');

      // Modules
      insertModule(db, a, 'UserContext', 'context');
      insertModule(db, a, 'UserSchema', 'schema');

      // Files
      insertFile(db, a, 'src/main.ex');
      insertFile(db, a, 'src/router.ex');

      // Services
      insertService(db, a, 'UserService');

      const result = explainService(db, 'app-full');

      // Identity
      expect(result.name).toBe('app-full');
      expect(result.description).toBe('The full-featured service');
      expect(result.path).toBe('/repos/app-full');

      // Connections
      expect(result.talks_to.grpc).toContain('app-dep');
      expect(result.called_by.http).toContain('app-caller2');

      // Summary
      expect(result.summary).toMatch(/Talks to \d+ services?/);
      expect(result.summary).toMatch(/Called by \d+ services?/);

      // Events
      expect(result.events.produces).toContain('FullEvent');

      // Modules
      expect(result.modules.context).toBeDefined();
      expect(result.modules.schema).toBeDefined();

      // Counts
      expect(result.counts.files).toBe(2);
      expect(result.counts.grpc_services).toBe(1);

      // Hints
      expect(result.hints.length).toBeGreaterThan(0);
      expect(result.hints.some(h => h.includes('app-full'))).toBe(true);
    });

    it('returns valid card for repo with zero connections and entities', () => {
      insertRepo(db, 'app-empty', 'Nothing here');

      const result = explainService(db, 'app-empty');

      expect(result.name).toBe('app-empty');
      expect(result.talks_to).toEqual({});
      expect(result.called_by).toEqual({});
      expect(result.events.produces).toEqual([]);
      expect(result.events.consumes).toEqual([]);
      expect(result.modules).toEqual({});
      expect(result.counts.files).toBe(0);
      expect(result.counts.grpc_services).toBe(0);
      expect(result.summary).toBe('Talks to 0 services. Called by 0 services.');
    });
  });
});
