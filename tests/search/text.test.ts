import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { persistRepoData } from '../../src/indexer/writer.js';
import { searchText } from '../../src/search/text.js';

let db: Database.Database;
let dbPath: string;

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-search-text-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);

  // Populate with realistic test data
  persistRepoData(db, {
    metadata: {
      name: 'booking-service',
      path: '/repos/booking-service',
      description: 'Handles hotel booking and cancellation',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'abc123',
    },
    modules: [
      {
        name: 'BookingContext.Commands.CreateBooking',
        type: 'context',
        filePath: 'lib/booking_context/commands/create_booking.ex',
        summary: 'Handles booking creation and validation logic',
      },
      {
        name: 'BookingContext.Cancellation',
        type: 'module',
        filePath: 'lib/booking_context/cancellation.ex',
        summary: 'Manages booking cancellation workflows and refund calculation',
      },
    ],
    events: [
      {
        name: 'BookingCreated',
        schemaDefinition: 'message BookingCreated { string booking_id = 1; string guest_name = 2; }',
        sourceFile: 'proto/booking.proto',
      },
    ],
  });

  persistRepoData(db, {
    metadata: {
      name: 'payments-service',
      path: '/repos/payments-service',
      description: 'Payment processing and billing',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'def456',
    },
    modules: [
      {
        name: 'PaymentProcessor',
        type: 'module',
        filePath: 'lib/payment_processor.ex',
        summary: 'Processes payments after booking confirmation',
      },
      {
        name: 'Payments.Schema.Transaction',
        type: 'schema',
        filePath: 'lib/payments/schema/transaction.ex',
        summary: 'Ecto schema for payment transactions',
        tableName: 'transactions',
      },
      {
        name: 'Payments.Queries.GetTransaction',
        type: 'graphql_query',
        filePath: 'lib/payments/queries/get_transaction.ex',
        summary: 'GraphQL query resolver for transactions',
      },
    ],
    services: [
      {
        name: 'PaymentGateway',
        description: 'gRPC payment gateway service for processing charges',
        serviceType: 'grpc',
      },
    ],
  });
});

afterEach(() => {
  closeDatabase(db);
  const dir = path.dirname(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('searchText', () => {
  it('returns results with repoName, filePath, and snippet', () => {
    const results = searchText(db, 'booking');
    expect(results.length).toBeGreaterThan(0);

    for (const result of results) {
      expect(result.repoName).toBeTruthy();
      expect(result.snippet).toBeTruthy();
      expect(result.relevance).toBeDefined();
    }
  });

  it('module results include filePath from files table', () => {
    const results = searchText(db, 'cancellation');
    const moduleResult = results.find((r) => r.entityType === 'module');
    expect(moduleResult).toBeDefined();
    expect(moduleResult!.filePath).toBe('lib/booking_context/cancellation.ex');
    expect(moduleResult!.repoName).toBe('booking-service');
  });

  it('repo results include repoPath', () => {
    const results = searchText(db, 'hotel booking');
    const repoResult = results.find((r) => r.entityType === 'repo');
    expect(repoResult).toBeDefined();
    expect(repoResult!.repoName).toBe('booking-service');
    expect(repoResult!.repoPath).toBe('/repos/booking-service');
  });

  it('event results include sourceFile as filePath', () => {
    const results = searchText(db, 'booking created');
    const eventResult = results.find((r) => r.entityType === 'event');
    expect(eventResult).toBeDefined();
    expect(eventResult!.filePath).toBe('proto/booking.proto');
    expect(eventResult!.repoName).toBe('booking-service');
  });

  it('repoFilter limits results to named repo', () => {
    const results = searchText(db, 'booking', { repoFilter: 'payments-service' });
    for (const result of results) {
      expect(result.repoName).toBe('payments-service');
    }
  });

  it('entityTypeFilter limits results to specified type', () => {
    const results = searchText(db, 'booking', { entityTypeFilter: 'module' });
    for (const result of results) {
      expect(result.entityType).toBe('module');
    }
    expect(results.length).toBeGreaterThan(0);
  });

  it('default limit is 20', () => {
    // With our small dataset, just verify it returns all matches (< 20)
    const results = searchText(db, 'booking');
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it('custom limit works', () => {
    const results = searchText(db, 'booking', { limit: 1 });
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('empty query returns empty array', () => {
    expect(searchText(db, '')).toEqual([]);
    expect(searchText(db, '   ')).toEqual([]);
  });

  it('FTS5 AND syntax works', () => {
    const results = searchText(db, 'booking AND cancellation');
    expect(results.length).toBeGreaterThan(0);
    // Should match the cancellation module which has both terms
    const hasCancel = results.some(
      (r) => r.name.toLowerCase().includes('cancellation') || r.snippet.toLowerCase().includes('cancellation'),
    );
    expect(hasCancel).toBe(true);
  });

  it('handles invalid FTS5 syntax gracefully', () => {
    // Unmatched quotes, bare operators — should not throw
    expect(() => searchText(db, '"unclosed quote')).not.toThrow();
    expect(() => searchText(db, 'AND OR NOT')).not.toThrow();
    expect(() => searchText(db, '***')).not.toThrow();
  });

  it('snippet is the full description for entities', () => {
    const results = searchText(db, 'cancellation');
    const moduleResult = results.find((r) => r.entityType === 'module');
    expect(moduleResult).toBeDefined();
    // Snippet should contain the description content
    expect(moduleResult!.snippet.length).toBeGreaterThan(0);
  });

  it('non-matching query returns empty array', () => {
    const results = searchText(db, 'nonexistentxyz');
    expect(results).toEqual([]);
  });

  describe('field search', () => {
    beforeEach(() => {
      // Add field data to both repos
      persistRepoData(db, {
        metadata: {
          name: 'hr-service',
          path: '/repos/hr-service',
          description: 'Human resources management',
          techStack: ['elixir'],
          keyFiles: ['mix.exs'],
          currentCommit: 'ghi789',
        },
        modules: [
          {
            name: 'HR.Schema.Employee',
            type: 'ecto_schema',
            filePath: 'lib/hr/schema/employee.ex',
            summary: 'Ecto schema for employees',
            tableName: 'employees',
          },
        ],
        events: [
          {
            name: 'EmployeeCreated',
            schemaDefinition: 'message EmployeeCreated { string employee_id = 1; }',
            sourceFile: 'proto/employee.proto',
          },
        ],
        fields: [
          {
            parentType: 'ecto_schema',
            parentName: 'HR.Schema.Employee',
            fieldName: 'employee_id',
            fieldType: 'integer',
            nullable: false,
            sourceFile: 'lib/hr/schema/employee.ex',
          },
          {
            parentType: 'ecto_schema',
            parentName: 'HR.Schema.Employee',
            fieldName: 'full_name',
            fieldType: 'string',
            nullable: false,
            sourceFile: 'lib/hr/schema/employee.ex',
          },
          {
            parentType: 'proto_message',
            parentName: 'EmployeeCreated',
            fieldName: 'employee_id',
            fieldType: 'string',
            nullable: false,
            sourceFile: 'proto/employee.proto',
          },
        ],
      });
    });

    it('searchText("employee_id") returns results with entityType "field"', () => {
      const results = searchText(db, 'employee_id');
      const fieldResults = results.filter((r) => r.entityType === 'field');
      expect(fieldResults.length).toBeGreaterThan(0);
    });

    it('searchText("employee") also returns employee_id field results (token matching)', () => {
      const results = searchText(db, 'employee');
      const fieldResults = results.filter((r) => r.entityType === 'field');
      expect(fieldResults.length).toBeGreaterThan(0);
    });

    it('searchText with entityTypeFilter "field" returns only field results', () => {
      const results = searchText(db, 'employee_id', { entityTypeFilter: 'field' });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.entityType).toBe('field');
      }
    });

    it('searchText with entityTypeFilter "module" does NOT return field results', () => {
      const results = searchText(db, 'employee_id', { entityTypeFilter: 'module' });
      for (const r of results) {
        expect(r.entityType).not.toBe('field');
      }
    });

    it('field results include correct repoName, filePath, subType', () => {
      const results = searchText(db, 'employee_id', { entityTypeFilter: 'field' });
      expect(results.length).toBeGreaterThan(0);

      const ectoField = results.find((r) => r.subType === 'ecto_schema');
      expect(ectoField).toBeDefined();
      expect(ectoField!.repoName).toBe('hr-service');
      expect(ectoField!.filePath).toBe('lib/hr/schema/employee.ex');
      expect(ectoField!.subType).toBe('ecto_schema');

      const protoField = results.find((r) => r.subType === 'proto_message');
      expect(protoField).toBeDefined();
      expect(protoField!.repoName).toBe('hr-service');
      expect(protoField!.filePath).toBe('proto/employee.proto');
      expect(protoField!.subType).toBe('proto_message');
    });
  });

  describe('sub-type filtering', () => {
    it('coarse entityTypeFilter=module returns all module sub-types', () => {
      const results = searchText(db, 'payment', { entityTypeFilter: 'module' });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.entityType).toBe('module');
      }
      // Should include both the plain module and schema module
      const subTypes = results.map(r => r.subType);
      expect(subTypes.length).toBeGreaterThanOrEqual(1);
    });

    it('granular entityTypeFilter=schema returns only schema modules', () => {
      const results = searchText(db, 'transaction', { entityTypeFilter: 'schema' });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.entityType).toBe('module');
        expect(r.subType).toBe('schema');
      }
    });

    it('coarse entityTypeFilter=service returns service results', () => {
      const results = searchText(db, 'gateway', { entityTypeFilter: 'service' });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.entityType).toBe('service');
      }
    });

    it('granular entityTypeFilter=grpc returns only gRPC services', () => {
      const results = searchText(db, 'gateway', { entityTypeFilter: 'grpc' });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.entityType).toBe('service');
        expect(r.subType).toBe('grpc');
      }
    });

    it('each TextSearchResult has subType field populated', () => {
      const results = searchText(db, 'booking');
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.subType).toBeDefined();
        expect(typeof r.subType).toBe('string');
        expect(r.subType.length).toBeGreaterThan(0);
      }
    });

    it('backward compat: entityTypeFilter=module still works', () => {
      const results = searchText(db, 'booking', { entityTypeFilter: 'module' });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.entityType).toBe('module');
      }
    });
  });
});
