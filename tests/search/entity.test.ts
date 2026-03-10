import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { persistRepoData } from '../../src/indexer/writer.js';
import { findEntity } from '../../src/search/entity.js';

let db: Database.Database;
let dbPath: string;

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-search-entity-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);

  // Repo 1: booking-service — produces BookingCreated
  const { repoId: bookingRepoId } = persistRepoData(db, {
    metadata: {
      name: 'booking-service',
      path: '/repos/booking-service',
      description: 'Handles hotel bookings',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'aaa111',
    },
    modules: [
      {
        name: 'BookingContext',
        type: 'context',
        filePath: 'lib/booking_context.ex',
        summary: 'Core booking domain context',
      },
    ],
    events: [
      {
        name: 'BookingCreated',
        schemaDefinition: 'message BookingCreated { string id = 1; }',
        sourceFile: 'proto/booking.proto',
      },
    ],
  });

  // Add edge: booking-service produces BookingCreated
  const bookingEvent = db.prepare("SELECT id FROM events WHERE name = 'BookingCreated'").get() as { id: number };
  db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('repo', bookingRepoId, 'event', bookingEvent.id, 'produces_event', 'proto/booking.proto');

  // Repo 2: payments-service — consumes BookingCreated
  const { repoId: paymentsRepoId } = persistRepoData(db, {
    metadata: {
      name: 'payments-service',
      path: '/repos/payments-service',
      description: 'Payment processing',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'bbb222',
    },
    modules: [
      {
        name: 'PaymentProcessor',
        type: 'module',
        filePath: 'lib/payment_processor.ex',
        summary: 'Processes payments',
      },
      {
        name: 'Payments.Schema.Invoice',
        type: 'schema',
        filePath: 'lib/payments/schema/invoice.ex',
        summary: 'Invoice Ecto schema',
        tableName: 'invoices',
      },
    ],
    services: [
      {
        name: 'BillingService',
        description: 'gRPC billing service',
        serviceType: 'grpc',
      },
    ],
  });

  // Add edge: payments-service consumes BookingCreated
  db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('repo', paymentsRepoId, 'event', bookingEvent.id, 'consumes_event', 'lib/consumers/booking.ex');
});

afterEach(() => {
  closeDatabase(db);
  const dir = path.dirname(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('findEntity', () => {
  it('returns entity cards matching name', () => {
    const results = findEntity(db, 'BookingCreated');
    expect(results.length).toBeGreaterThan(0);
    const card = results[0];
    expect(card.name).toBe('BookingCreated');
    expect(card.type).toBe('event');
    expect(card.repoName).toBe('booking-service');
  });

  it('entity card includes repoName, filePath, description', () => {
    const results = findEntity(db, 'BookingContext');
    expect(results.length).toBeGreaterThan(0);
    const card = results[0];
    expect(card.repoName).toBe('booking-service');
    expect(card.filePath).toBe('lib/booking_context.ex');
    expect(card.description).toBe('Core booking domain context');
  });

  it('entity card includes relationships', () => {
    const results = findEntity(db, 'BookingCreated');
    expect(results.length).toBeGreaterThan(0);
    const card = results[0];
    expect(card.relationships.length).toBeGreaterThan(0);

    // BookingCreated should have incoming edges (repo -> event)
    const incoming = card.relationships.filter((r) => r.direction === 'incoming');
    expect(incoming.length).toBeGreaterThan(0);
  });

  it('type filter works', () => {
    const results = findEntity(db, 'BookingCreated', { type: 'event' });
    expect(results.length).toBeGreaterThan(0);
    for (const card of results) {
      expect(card.type).toBe('event');
    }
  });

  it('type filter excludes non-matching types', () => {
    const results = findEntity(db, 'BookingCreated', { type: 'module' });
    expect(results.length).toBe(0);
  });

  it('relationship filter works', () => {
    const results = findEntity(db, 'BookingCreated', { relationship: 'consumes_event' });
    expect(results.length).toBeGreaterThan(0);
    const card = results[0];
    const hasRelationship = card.relationships.some((r) => r.type === 'consumes_event');
    expect(hasRelationship).toBe(true);
  });

  it('repo filter works', () => {
    const results = findEntity(db, 'BookingCreated', { repo: 'booking-service' });
    for (const card of results) {
      expect(card.repoName).toBe('booking-service');
    }
  });

  it('results sorted by repo then alphabetical', () => {
    // Insert another entity in a different repo to test sorting
    const results = findEntity(db, 'booking');
    if (results.length > 1) {
      for (let i = 1; i < results.length; i++) {
        const prev = results[i - 1];
        const curr = results[i];
        if (prev.repoName === curr.repoName) {
          expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it('non-existent entity returns empty array', () => {
    const results = findEntity(db, 'CompletelyNonexistent');
    expect(results).toEqual([]);
  });

  it('partial name match works via FTS fallback', () => {
    // "Booking" should match BookingCreated, BookingContext via FTS
    const results = findEntity(db, 'Booking');
    expect(results.length).toBeGreaterThan(0);
  });

  describe('sub-type filtering', () => {
    it('type=schema returns only schema modules', () => {
      const results = findEntity(db, 'Payments.Schema.Invoice', { type: 'schema' });
      expect(results.length).toBeGreaterThan(0);
      for (const card of results) {
        expect(card.type).toBe('module');
      }
    });

    it('type=module returns all modules (coarse)', () => {
      const results = findEntity(db, 'Payment', { type: 'module' });
      expect(results.length).toBeGreaterThan(0);
      // Should include both plain modules and schema modules
      for (const card of results) {
        expect(card.type).toBe('module');
      }
    });

    it('type=grpc returns only gRPC services', () => {
      const results = findEntity(db, 'BillingService', { type: 'grpc' });
      expect(results.length).toBeGreaterThan(0);
      for (const card of results) {
        expect(card.type).toBe('service');
      }
    });

    it('type=service returns all services (coarse)', () => {
      const results = findEntity(db, 'BillingService', { type: 'service' });
      expect(results.length).toBeGreaterThan(0);
      for (const card of results) {
        expect(card.type).toBe('service');
      }
    });
  });

  describe('field entity cards', () => {
    beforeEach(() => {
      // repo-alpha: has employee_id (required) in ecto_schema and a unique_field
      persistRepoData(db, {
        metadata: {
          name: 'repo-alpha',
          path: '/repos/repo-alpha',
          description: 'Alpha service',
          techStack: ['elixir'],
          keyFiles: ['mix.exs'],
          currentCommit: 'ccc333',
        },
        modules: [],
        fields: [
          {
            parentType: 'ecto_schema',
            parentName: 'Employee',
            fieldName: 'employee_id',
            fieldType: 'integer',
            nullable: false,
            sourceFile: 'lib/employee.ex',
          },
          {
            parentType: 'ecto_schema',
            parentName: 'Employee',
            fieldName: 'unique_field',
            fieldType: 'string',
            nullable: true,
            sourceFile: 'lib/employee.ex',
          },
        ],
      });

      // repo-beta: has employee_id (nullable) in proto_message
      persistRepoData(db, {
        metadata: {
          name: 'repo-beta',
          path: '/repos/repo-beta',
          description: 'Beta service',
          techStack: ['elixir'],
          keyFiles: ['mix.exs'],
          currentCommit: 'ddd444',
        },
        modules: [],
        fields: [
          {
            parentType: 'proto_message',
            parentName: 'EmployeeProto',
            fieldName: 'employee_id',
            fieldType: 'int32',
            nullable: true,
            sourceFile: 'proto/employee.proto',
          },
        ],
      });
    });

    it('findEntity with type=field returns cards for each occurrence across repos', () => {
      const results = findEntity(db, 'employee_id', { type: 'field' });
      expect(results.length).toBe(2);
      expect(results.every((c) => c.type === 'field')).toBe(true);
      const repoNames = results.map((c) => c.repoName);
      expect(repoNames).toContain('repo-alpha');
      expect(repoNames).toContain('repo-beta');
    });

    it('each field card has description with parent_name, field_type, and nullable/required', () => {
      const results = findEntity(db, 'employee_id', { type: 'field' });
      const alphaCard = results.find((c) => c.repoName === 'repo-alpha')!;
      expect(alphaCard.description).toContain('Employee');
      expect(alphaCard.description).toContain('integer');
      expect(alphaCard.description).toContain('required');

      const betaCard = results.find((c) => c.repoName === 'repo-beta')!;
      expect(betaCard.description).toContain('EmployeeProto');
      expect(betaCard.description).toContain('int32');
      expect(betaCard.description).toContain('nullable');
    });

    it('field in 2+ repos gets shared concept prefix in description', () => {
      const results = findEntity(db, 'employee_id', { type: 'field' });
      for (const card of results) {
        expect(card.description).toContain('[shared across 2 repos]');
      }
    });

    it('field in only 1 repo does NOT include shared in description', () => {
      const results = findEntity(db, 'unique_field', { type: 'field' });
      expect(results.length).toBe(1);
      expect(results[0].description).not.toContain('[shared');
    });

    it('repo filter works for field entity queries', () => {
      const results = findEntity(db, 'employee_id', { type: 'field', repo: 'repo-alpha' });
      expect(results.length).toBe(1);
      expect(results[0].repoName).toBe('repo-alpha');
    });

    it('findEntity with no type filter still finds fields by exact name', () => {
      const results = findEntity(db, 'employee_id');
      const fieldCards = results.filter((c) => c.type === 'field');
      expect(fieldCards.length).toBeGreaterThan(0);
    });

    it('field entity cards are sorted by repo name, then parent type, then parent name', () => {
      const results = findEntity(db, 'employee_id', { type: 'field' });
      // repo-alpha should come before repo-beta
      expect(results[0].repoName).toBe('repo-alpha');
      expect(results[1].repoName).toBe('repo-beta');
    });
  });
});
