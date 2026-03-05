import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { persistRepoData } from '../../src/indexer/writer.js';
import { queryDependencies } from '../../src/search/dependencies.js';

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
    expect(bookingDep!.mechanism).toContain('Kafka');
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
});
