import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../../src/db/database.js';
import { persistRepoData } from '../../../src/indexer/writer.js';
import { searchText } from '../../../src/search/text.js';
import { formatResponse } from '../../../src/mcp/format.js';

let db: Database.Database;
let dbPath: string;

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-mcp-search-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);

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
    ],
    events: [
      {
        name: 'BookingCreated',
        schemaDefinition: 'message BookingCreated { string booking_id = 1; }',
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
    services: [
      {
        name: 'PaymentGateway',
        description: 'gRPC payment gateway service for processing charges',
        serviceType: 'grpc',
      },
    ],
    fields: [
      {
        parentType: 'ecto_schema',
        parentName: 'Payments.Schema.Transaction',
        fieldName: 'amount_cents',
        fieldType: 'integer',
        nullable: false,
        sourceFile: 'lib/payments/schema/transaction.ex',
      },
    ],
  });
});

afterEach(() => {
  closeDatabase(db);
  const dir = path.dirname(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('kb_search MCP response', () => {
  it('includes nextAction in every result item', () => {
    const results = searchText(db, 'booking');
    expect(results.length).toBeGreaterThan(0);

    const json = formatResponse(
      results,
      (items) => `Found ${results.length} results (showing ${items.length})`,
    );
    const parsed = JSON.parse(json) as {
      data: Array<{ nextAction: { tool: string; args: { name: string } } }>;
    };

    for (const item of parsed.data) {
      expect(item.nextAction).toBeDefined();
      expect(item.nextAction.tool).toBeTruthy();
      expect(typeof item.nextAction.tool).toBe('string');
      expect(item.nextAction.args).toBeDefined();
      expect(item.nextAction.args.name).toBeTruthy();
    }
  });

  it('nextAction.tool matches entity type mapping', () => {
    // Service search -> kb_entity
    const serviceResults = searchText(db, 'gateway', { entityTypeFilter: 'service' });
    expect(serviceResults.length).toBeGreaterThan(0);

    const serviceJson = formatResponse(
      serviceResults,
      (items) => `Found ${serviceResults.length} results (showing ${items.length})`,
    );
    const serviceParsed = JSON.parse(serviceJson) as {
      data: Array<{ nextAction: { tool: string; args: { name: string } } }>;
    };

    for (const item of serviceParsed.data) {
      expect(item.nextAction.tool).toBe('kb_entity');
    }

    // Field search -> kb_field_impact
    const fieldResults = searchText(db, 'amount_cents', { entityTypeFilter: 'field' });
    expect(fieldResults.length).toBeGreaterThan(0);

    const fieldJson = formatResponse(
      fieldResults,
      (items) => `Found ${fieldResults.length} results (showing ${items.length})`,
    );
    const fieldParsed = JSON.parse(fieldJson) as {
      data: Array<{ nextAction: { tool: string; args: { name: string } } }>;
    };

    for (const item of fieldParsed.data) {
      expect(item.nextAction.tool).toBe('kb_field_impact');
    }
  });

  it('nextAction.args.name matches result name', () => {
    const results = searchText(db, 'booking');
    expect(results.length).toBeGreaterThan(0);

    const json = formatResponse(
      results,
      (items) => `Found ${results.length} results (showing ${items.length})`,
    );
    const parsed = JSON.parse(json) as {
      data: Array<{ name: string; nextAction: { tool: string; args: { name: string } } }>;
    };

    for (const item of parsed.data) {
      expect(item.nextAction.args.name).toBe(item.name);
    }
  });
});
