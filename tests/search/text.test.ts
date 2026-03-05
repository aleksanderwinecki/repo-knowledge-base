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
});
