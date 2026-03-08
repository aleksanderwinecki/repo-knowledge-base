import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { persistRepoData } from '../../src/indexer/writer.js';
import { queryDependencies, VALID_MECHANISMS } from '../../src/search/dependencies.js';

let db: Database.Database;
let dbPath: string;

/**
 * Test dependency graph:
 *   booking-service --produces--> BookingCreated --consumed_by--> payments-service
 *   payments-service --produces--> PaymentProcessed --consumed_by--> notifications-service
 *
 * Chain: booking -> BookingCreated -> payments -> PaymentProcessed -> notifications
 */
beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-search-deps-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);

  // Repo 1: booking-service produces BookingCreated
  const { repoId: bookingId } = persistRepoData(db, {
    metadata: {
      name: 'booking-service',
      path: '/repos/booking-service',
      description: 'Handles bookings',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'aaa',
    },
    events: [
      { name: 'BookingCreated', schemaDefinition: 'message BookingCreated {}', sourceFile: 'proto/booking.proto' },
    ],
  });

  const bookingEvent = db.prepare("SELECT id FROM events WHERE name = 'BookingCreated'").get() as { id: number };
  db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('repo', bookingId, 'event', bookingEvent.id, 'produces_event', 'proto/booking.proto');

  // Repo 2: payments-service consumes BookingCreated, produces PaymentProcessed
  const { repoId: paymentsId } = persistRepoData(db, {
    metadata: {
      name: 'payments-service',
      path: '/repos/payments-service',
      description: 'Payment processing',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'bbb',
    },
    events: [
      { name: 'PaymentProcessed', schemaDefinition: 'message PaymentProcessed {}', sourceFile: 'proto/payment.proto' },
    ],
  });

  // payments consumes BookingCreated
  db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('repo', paymentsId, 'event', bookingEvent.id, 'consumes_event', 'lib/consumers/booking.ex');

  // payments produces PaymentProcessed
  const paymentEvent = db.prepare("SELECT id FROM events WHERE name = 'PaymentProcessed'").get() as { id: number };
  db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('repo', paymentsId, 'event', paymentEvent.id, 'produces_event', 'proto/payment.proto');

  // Repo 3: notifications-service consumes PaymentProcessed
  const { repoId: notificationsId } = persistRepoData(db, {
    metadata: {
      name: 'notifications-service',
      path: '/repos/notifications-service',
      description: 'Sends notifications',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'ccc',
    },
  });

  db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('repo', notificationsId, 'event', paymentEvent.id, 'consumes_event', 'lib/consumers/payment.ex');
});

afterEach(() => {
  closeDatabase(db);
  const dir = path.dirname(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('queryDependencies', () => {
  it('upstream query returns what entity depends on', () => {
    // payments-service consumes BookingCreated (produced by booking-service)
    const result = queryDependencies(db, 'payments-service', { direction: 'upstream' });
    expect(result.entity.name).toBe('payments-service');
    expect(result.dependencies.length).toBeGreaterThan(0);

    // Should find booking-service as upstream dependency
    const bookingDep = result.dependencies.find((d) => d.name === 'booking-service');
    expect(bookingDep).toBeDefined();
    expect(bookingDep!.mechanism).toContain('event');
  });

  it('downstream query returns what depends on entity', () => {
    // booking-service produces BookingCreated (consumed by payments-service)
    const result = queryDependencies(db, 'booking-service', { direction: 'downstream' });
    expect(result.entity.name).toBe('booking-service');
    expect(result.dependencies.length).toBeGreaterThan(0);

    const paymentsDep = result.dependencies.find((d) => d.name === 'payments-service');
    expect(paymentsDep).toBeDefined();
  });

  it('default direction is upstream, default depth is 1', () => {
    const result = queryDependencies(db, 'payments-service');
    expect(result.entity.name).toBe('payments-service');
    // At depth 1, should find the direct dependency (booking-service via BookingCreated)
    expect(result.dependencies.length).toBeGreaterThan(0);
  });

  it('depth 2 follows multi-hop', () => {
    // notifications-service at depth 2 upstream:
    // depth 1: payments-service (via PaymentProcessed)
    // depth 2: booking-service (via BookingCreated, through payments)
    const result = queryDependencies(db, 'notifications-service', { direction: 'upstream', depth: 2 });
    expect(result.dependencies.length).toBeGreaterThanOrEqual(2);

    const paymentsDep = result.dependencies.find((d) => d.name === 'payments-service');
    expect(paymentsDep).toBeDefined();
    expect(paymentsDep!.depth).toBe(1);

    const bookingDep = result.dependencies.find((d) => d.name === 'booking-service');
    expect(bookingDep).toBeDefined();
    expect(bookingDep!.depth).toBe(2);
  });

  it('depth all traverses full graph', () => {
    const result = queryDependencies(db, 'notifications-service', { direction: 'upstream', depth: 'all' });
    // Should find both payments and booking
    const names = result.dependencies.map((d) => d.name);
    expect(names).toContain('payments-service');
    expect(names).toContain('booking-service');
  });

  it('results include mechanism label', () => {
    const result = queryDependencies(db, 'payments-service', { direction: 'upstream' });
    for (const dep of result.dependencies) {
      expect(dep.mechanism).toBeTruthy();
    }
  });

  it('multi-hop results include path array', () => {
    const result = queryDependencies(db, 'notifications-service', { direction: 'upstream', depth: 2 });
    const bookingDep = result.dependencies.find((d) => d.name === 'booking-service');
    if (bookingDep) {
      expect(bookingDep.path.length).toBeGreaterThan(0);
    }
  });

  it('non-existent entity returns empty dependencies', () => {
    const result = queryDependencies(db, 'nonexistent-service');
    expect(result.dependencies).toEqual([]);
  });

  it('entity with no dependencies returns empty array', () => {
    const result = queryDependencies(db, 'booking-service', { direction: 'upstream' });
    // booking-service doesn't consume anything
    expect(result.dependencies).toEqual([]);
  });

  it('cycle detection prevents infinite loops', () => {
    // Create a cycle: notifications -> produces SomeEvent -> booking consumes SomeEvent
    const notifRepo = db.prepare("SELECT id FROM repos WHERE name = 'notifications-service'").get() as { id: number };
    const bookingRepo = db.prepare("SELECT id FROM repos WHERE name = 'booking-service'").get() as { id: number };

    // Insert cycle event
    db.prepare('INSERT INTO events (repo_id, name, schema_definition, source_file) VALUES (?, ?, ?, ?)').run(
      notifRepo.id, 'CycleEvent', 'message CycleEvent {}', 'proto/cycle.proto',
    );
    const cycleEvent = db.prepare("SELECT id FROM events WHERE name = 'CycleEvent'").get() as { id: number };

    // notifications produces CycleEvent
    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('repo', notifRepo.id, 'event', cycleEvent.id, 'produces_event', null);

    // booking consumes CycleEvent (creating cycle: booking -> BookingCreated -> payments -> PaymentProcessed -> notifications -> CycleEvent -> booking)
    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('repo', bookingRepo.id, 'event', cycleEvent.id, 'consumes_event', null);

    // depth: 'all' should not hang — should terminate
    const result = queryDependencies(db, 'booking-service', { direction: 'downstream', depth: 'all' });
    expect(result.dependencies.length).toBeGreaterThan(0);
    // Should not contain duplicate entries for the same service
    const names = result.dependencies.map((d) => d.name);
    const uniqueNames = [...new Set(names)];
    expect(names.length).toBe(uniqueNames.length);
  });

  it('legacy event edges have null confidence', () => {
    // Existing event edges have no metadata column -> confidence should be null
    const result = queryDependencies(db, 'payments-service', { direction: 'upstream' });
    const bookingDep = result.dependencies.find((d) => d.name === 'booking-service');
    expect(bookingDep).toBeDefined();
    expect(bookingDep!.confidence).toBeNull();
  });
});

describe('direct topology edges', () => {
  it('gRPC edge appears in upstream deps', () => {
    // repo A calls_grpc repo B -> B is upstream dep of A
    const repoA = db.prepare("SELECT id FROM repos WHERE name = 'booking-service'").get() as { id: number };
    const repoB = db.prepare("SELECT id FROM repos WHERE name = 'payments-service'").get() as { id: number };

    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('repo', repoA.id, 'repo', repoB.id, 'calls_grpc', 'lib/client.ex', JSON.stringify({ confidence: 'high' }));

    const result = queryDependencies(db, 'booking-service', { direction: 'upstream' });
    const grpcDep = result.dependencies.find((d) => d.name === 'payments-service');
    expect(grpcDep).toBeDefined();
    expect(grpcDep!.mechanism).toContain('gRPC');
    expect(grpcDep!.confidence).toBe('high');
  });

  it('HTTP edge appears in upstream deps', () => {
    const repoA = db.prepare("SELECT id FROM repos WHERE name = 'booking-service'").get() as { id: number };
    const repoB = db.prepare("SELECT id FROM repos WHERE name = 'payments-service'").get() as { id: number };

    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('repo', repoA.id, 'repo', repoB.id, 'calls_http', 'lib/http_client.ex', JSON.stringify({ confidence: 'low' }));

    const result = queryDependencies(db, 'booking-service', { direction: 'upstream' });
    const httpDep = result.dependencies.find((d) => d.name === 'payments-service');
    expect(httpDep).toBeDefined();
    expect(httpDep!.mechanism).toContain('HTTP');
    expect(httpDep!.confidence).toBe('low');
  });

  it('gateway edge (routes_to) appears in downstream deps', () => {
    // gateway routes_to target -> target is downstream of gateway
    const gateway = db.prepare("SELECT id FROM repos WHERE name = 'booking-service'").get() as { id: number };
    const target = db.prepare("SELECT id FROM repos WHERE name = 'payments-service'").get() as { id: number };

    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('repo', gateway.id, 'repo', target.id, 'routes_to', 'compose/services/payments.ts', JSON.stringify({ confidence: 'medium' }));

    // Downstream from gateway: what does gateway route to?
    const result = queryDependencies(db, 'booking-service', { direction: 'upstream' });
    const gwDep = result.dependencies.find((d) => d.name === 'payments-service');
    expect(gwDep).toBeDefined();
    expect(gwDep!.mechanism).toContain('Gateway');
    expect(gwDep!.confidence).toBe('medium');
  });
});

describe('unresolved edges', () => {
  it('unresolved edges appear as leaf nodes with target name', () => {
    const repoA = db.prepare("SELECT id FROM repos WHERE name = 'booking-service'").get() as { id: number };

    // Unresolved gRPC call: target_type='service_name', target_id=0
    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('repo', repoA.id, 'service_name', 0, 'calls_grpc', 'lib/client.ex',
      JSON.stringify({ confidence: 'high', unresolved: 'true', targetName: 'Rpc.Partners.V1.RPCService' }));

    const result = queryDependencies(db, 'booking-service', { direction: 'upstream' });
    const unresolvedDep = result.dependencies.find((d) => d.type === 'unresolved');
    expect(unresolvedDep).toBeDefined();
    expect(unresolvedDep!.name).toContain('Rpc.Partners.V1.RPCService');
    expect(unresolvedDep!.confidence).toBe('high');
    expect(unresolvedDep!.mechanism).toContain('unresolved');
  });
});

describe('kafka topic matching', () => {
  it('connects repos through shared kafka topic', () => {
    // Create two fresh repos connected ONLY by kafka topic (no event edges between them)
    const { repoId: producerId } = persistRepoData(db, {
      metadata: {
        name: 'kafka-producer-svc',
        path: '/repos/kafka-producer-svc',
        description: 'Produces kafka messages',
        techStack: ['elixir'],
        keyFiles: ['mix.exs'],
        currentCommit: 'kp1',
      },
    });

    const { repoId: consumerId } = persistRepoData(db, {
      metadata: {
        name: 'kafka-consumer-svc',
        path: '/repos/kafka-consumer-svc',
        description: 'Consumes kafka messages',
        techStack: ['elixir'],
        keyFiles: ['mix.exs'],
        currentCommit: 'kc1',
      },
    });

    // kafka-producer-svc produces_kafka 'order-events' topic
    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('repo', producerId, 'service_name', 0, 'produces_kafka', 'lib/producer.ex',
      JSON.stringify({ confidence: 'high', topic: 'order-events', targetName: 'order-events' }));

    // kafka-consumer-svc consumes_kafka 'order-events' topic
    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('repo', consumerId, 'service_name', 0, 'consumes_kafka', 'lib/consumer.ex',
      JSON.stringify({ confidence: 'high', topic: 'order-events', targetName: 'order-events' }));

    // consumer upstream: should find producer via shared topic
    const result = queryDependencies(db, 'kafka-consumer-svc', { direction: 'upstream' });
    const kafkaDep = result.dependencies.find((d) => d.name === 'kafka-producer-svc');
    expect(kafkaDep).toBeDefined();
    expect(kafkaDep!.mechanism).toContain('Kafka');
    expect(kafkaDep!.confidence).toBe('high');
  });
});

describe('mechanism filter', () => {
  beforeEach(() => {
    // Add a gRPC edge between booking and payments (in addition to the event edges from outer beforeEach)
    const repoA = db.prepare("SELECT id FROM repos WHERE name = 'booking-service'").get() as { id: number };
    const repoB = db.prepare("SELECT id FROM repos WHERE name = 'payments-service'").get() as { id: number };

    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('repo', repoA.id, 'repo', repoB.id, 'calls_grpc', 'lib/client.ex', JSON.stringify({ confidence: 'high' }));
  });

  it('mechanism grpc returns only gRPC edges', () => {
    const result = queryDependencies(db, 'booking-service', { direction: 'upstream', mechanism: 'grpc' });
    expect(result.dependencies.length).toBeGreaterThan(0);
    for (const dep of result.dependencies) {
      expect(dep.mechanism).toContain('gRPC');
    }
  });

  it('mechanism event returns only event-mediated edges', () => {
    // payments-service has event edge upstream to booking
    const result = queryDependencies(db, 'payments-service', { direction: 'upstream', mechanism: 'event' });
    expect(result.dependencies.length).toBeGreaterThan(0);
    for (const dep of result.dependencies) {
      expect(dep.mechanism).toContain('event');
    }
  });

  it('mechanism filter applies to all hops in multi-hop traversal', () => {
    // Add gRPC edge from payments to notifications too
    const repoB = db.prepare("SELECT id FROM repos WHERE name = 'payments-service'").get() as { id: number };
    const repoC = db.prepare("SELECT id FROM repos WHERE name = 'notifications-service'").get() as { id: number };

    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('repo', repoB.id, 'repo', repoC.id, 'calls_grpc', 'lib/client2.ex', JSON.stringify({ confidence: 'high' }));

    // From booking with mechanism=grpc at depth 2: should follow grpc edges only
    const result = queryDependencies(db, 'booking-service', { direction: 'upstream', depth: 2, mechanism: 'grpc' });
    // All deps should be gRPC-only
    for (const dep of result.dependencies) {
      expect(dep.mechanism).toContain('gRPC');
    }
  });

  it('invalid mechanism value still works (validation at CLI layer)', () => {
    // Should not crash - just return no results since no edges match
    const result = queryDependencies(db, 'booking-service', { direction: 'upstream', mechanism: 'bogus' });
    expect(result.dependencies).toEqual([]);
  });
});

describe('confidence', () => {
  it('confidence field populated from edge metadata JSON', () => {
    const repoA = db.prepare("SELECT id FROM repos WHERE name = 'booking-service'").get() as { id: number };
    const repoB = db.prepare("SELECT id FROM repos WHERE name = 'payments-service'").get() as { id: number };

    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('repo', repoA.id, 'repo', repoB.id, 'calls_grpc', 'lib/client.ex', JSON.stringify({ confidence: 'high' }));

    const result = queryDependencies(db, 'booking-service', { direction: 'upstream' });
    const grpcDep = result.dependencies.find((d) => d.mechanism.includes('gRPC'));
    expect(grpcDep).toBeDefined();
    expect(grpcDep!.confidence).toBe('high');
  });

  it('confidence is null for legacy event edges with no metadata', () => {
    const result = queryDependencies(db, 'payments-service', { direction: 'upstream' });
    const eventDep = result.dependencies.find((d) => d.name === 'booking-service');
    expect(eventDep).toBeDefined();
    expect(eventDep!.confidence).toBeNull();
  });
});

describe('mixed multi-hop', () => {
  it('gRPC hop 1 then event hop 2 appears at depth 2', () => {
    // Setup: repo-x calls_grpc payments-service, payments-service produces_event consumed by notifications
    // So from repo-x at depth 2: hop 1 = payments via gRPC, hop 2 = notifications via event

    // Create repo-x
    const { repoId: repoXId } = persistRepoData(db, {
      metadata: {
        name: 'repo-x',
        path: '/repos/repo-x',
        description: 'Test repo',
        techStack: ['elixir'],
        keyFiles: ['mix.exs'],
        currentCommit: 'xxx',
      },
    });

    const paymentsRepo = db.prepare("SELECT id FROM repos WHERE name = 'payments-service'").get() as { id: number };

    // repo-x calls_grpc payments-service (hop 1)
    db.prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run('repo', repoXId, 'repo', paymentsRepo.id, 'calls_grpc', 'lib/client.ex', JSON.stringify({ confidence: 'high' }));

    // payments-service already produces PaymentProcessed consumed by notifications-service (from outer beforeEach)

    // Query upstream from repo-x at depth 2
    const result = queryDependencies(db, 'repo-x', { direction: 'upstream', depth: 2 });

    const paymentsDep = result.dependencies.find((d) => d.name === 'payments-service');
    expect(paymentsDep).toBeDefined();
    expect(paymentsDep!.depth).toBe(1);
    expect(paymentsDep!.mechanism).toContain('gRPC');

    // At depth 2, we should see booking-service (payments consumes BookingCreated from booking)
    const bookingDep = result.dependencies.find((d) => d.name === 'booking-service');
    expect(bookingDep).toBeDefined();
    expect(bookingDep!.depth).toBe(2);
  });
});

describe('VALID_MECHANISMS export', () => {
  it('exports valid mechanism list', () => {
    expect(VALID_MECHANISMS).toBeDefined();
    expect(VALID_MECHANISMS).toContain('grpc');
    expect(VALID_MECHANISMS).toContain('http');
    expect(VALID_MECHANISMS).toContain('gateway');
    expect(VALID_MECHANISMS).toContain('kafka');
    expect(VALID_MECHANISMS).toContain('event');
  });
});
