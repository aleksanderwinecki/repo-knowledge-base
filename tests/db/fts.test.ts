import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { indexEntity, removeEntity, search, resolveTypeFilter, parseCompositeType, listAvailableTypes, executeFtsWithFallback, buildOrQuery, buildPrefixOrQuery, searchWithRelaxation, MIN_RELAXATION_RESULTS } from '../../src/db/fts.js';
import type Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import fs from 'fs';

function tmpDbPath(name: string): string {
  return path.join(os.tmpdir(), `rkb-fts-${name}-${Date.now()}.db`);
}

describe('FTS5', () => {
  let db: Database.Database;
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath('test');
    db = openDatabase(dbPath);
  });

  afterEach(() => {
    closeDatabase(db);
    try {
      fs.unlinkSync(dbPath);
    } catch {
      // ignore
    }
  });

  it('FTS table exists after initialization', () => {
    const tables = db.pragma('table_list') as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('knowledge_fts');
  });

  it('indexEntity and search round-trip', () => {
    indexEntity(db, {
      type: 'service',
      id: 1,
      name: 'BookingService',
      description: 'Handles bookings',
    });

    const results = search(db, 'booking');
    expect(results.length).toBeGreaterThan(0);
    // Without explicit subType, defaults to parent:parent composite format
    expect(results[0].entityType).toBe('service:service' as any);
    expect(results[0].entityId).toBe(1);
  });

  it('CamelCase search works', () => {
    // Insert an event into repos first (FTS doesn't require FK)
    indexEntity(db, {
      type: 'event',
      id: 1,
      name: 'BookingCreated',
    });

    const results = search(db, 'booking');
    expect(results.length).toBe(1);
    expect(results[0].entityType).toBe('event:event' as any);
    expect(results[0].entityId).toBe(1);
  });

  it('snake_case search works', () => {
    indexEntity(db, {
      type: 'service',
      id: 2,
      name: 'booking_service',
    });

    const results = search(db, 'booking');
    expect(results.length).toBe(1);
    expect(results[0].entityType).toBe('service:service' as any);
    expect(results[0].entityId).toBe(2);
  });

  it('dot-separated module search works', () => {
    indexEntity(db, {
      type: 'module',
      id: 3,
      name: 'BookingContext.Commands.CreateBooking',
    });

    const results = search(db, 'create booking');
    expect(results.length).toBe(1);
    expect(results[0].entityType).toBe('module:module' as any);
    expect(results[0].entityId).toBe(3);
  });

  it('removeEntity removes from search', () => {
    indexEntity(db, {
      type: 'service',
      id: 10,
      name: 'TemporaryService',
      description: 'Will be removed',
    });

    // Verify it exists
    let results = search(db, 'temporary');
    expect(results.length).toBe(1);

    // Remove it
    removeEntity(db, 'service', 10);

    // Verify it's gone
    results = search(db, 'temporary');
    expect(results.length).toBe(0);
  });

  it('search returns results ranked by relevance', () => {
    // Index multiple entities with varying relevance to "booking"
    indexEntity(db, {
      type: 'service',
      id: 1,
      name: 'BookingService',
      description: 'Core booking management for booking operations',
    });
    indexEntity(db, {
      type: 'event',
      id: 2,
      name: 'BookingCreated',
    });
    indexEntity(db, {
      type: 'module',
      id: 3,
      name: 'PaymentProcessor',
      description: 'Processes payments after booking confirmation',
    });

    const results = search(db, 'booking');
    expect(results.length).toBeGreaterThanOrEqual(2);
    // Results should be ordered by rank (lower rank = more relevant in FTS5)
    for (let i = 1; i < results.length; i++) {
      expect(results[i].relevance).toBeGreaterThanOrEqual(results[i - 1].relevance);
    }
  });

  it('empty query returns empty results', () => {
    indexEntity(db, {
      type: 'service',
      id: 1,
      name: 'SomeService',
    });

    expect(search(db, '')).toEqual([]);
    expect(search(db, '   ')).toEqual([]);
  });

  it('search limits results', () => {
    // Index 10 entities
    for (let i = 1; i <= 10; i++) {
      indexEntity(db, {
        type: 'service',
        id: i,
        name: `TestService${i}`,
        description: 'A test service for limiting',
      });
    }

    const results = search(db, 'test service', 5);
    expect(results.length).toBe(5);
  });

  describe('composite entity_type (parent:subtype)', () => {
    it('indexEntity with subType stores composite format', () => {
      indexEntity(db, {
        type: 'module',
        id: 1,
        name: 'UserSchema',
        description: 'User Ecto schema',
        subType: 'schema',
      });

      // Verify raw FTS row stores 'module:schema'
      const row = db.prepare('SELECT entity_type FROM knowledge_fts WHERE entity_id = 1').get() as { entity_type: string };
      expect(row.entity_type).toBe('module:schema');
    });

    it('indexEntity without subType defaults to parent:parent', () => {
      indexEntity(db, {
        type: 'module',
        id: 2,
        name: 'SomeModule',
        description: 'A plain module',
      });

      const row = db.prepare('SELECT entity_type FROM knowledge_fts WHERE entity_id = 2 AND entity_type LIKE ?').get('module:%') as { entity_type: string };
      expect(row.entity_type).toBe('module:module');
    });

    it('removeEntity works with composite types', () => {
      indexEntity(db, {
        type: 'module',
        id: 3,
        name: 'SchemaToRemove',
        subType: 'schema',
      });

      // Verify it exists
      let results = search(db, 'schema remove');
      expect(results.length).toBe(1);

      // Remove by parent type
      removeEntity(db, 'module', 3);

      // Should be gone
      results = search(db, 'schema remove');
      expect(results.length).toBe(0);
    });

    it('search returns entity_type in composite format', () => {
      indexEntity(db, {
        type: 'service',
        id: 10,
        name: 'PaymentGrpc',
        description: 'gRPC payment service',
        subType: 'grpc',
      });

      const results = search(db, 'payment grpc');
      expect(results.length).toBeGreaterThan(0);
      // The raw entityType returned by search() is the composite string
      expect(results[0].entityType).toBe('service:grpc' as any);
    });

    it('FTS MATCH does not match on entity_type tokens (UNINDEXED)', () => {
      indexEntity(db, {
        type: 'module',
        id: 20,
        name: 'UserProfile',
        description: 'Manages user profiles',
        subType: 'context',
      });

      // Searching for "context" should NOT match the entity_type field since it's UNINDEXED
      // It should only match if "context" appears in name or description
      const results = search(db, 'context');
      // "context" does not appear in name or description, so no results
      expect(results.length).toBe(0);
    });
  });

  describe('resolveTypeFilter', () => {
    it('coarse type returns parent LIKE pattern', () => {
      const result = resolveTypeFilter('module');
      expect(result.sql).toBe('entity_type LIKE ?');
      expect(result.param).toBe('module:%');
    });

    it('granular type returns sub-type LIKE pattern', () => {
      const result = resolveTypeFilter('schema');
      expect(result.sql).toBe('entity_type LIKE ?');
      expect(result.param).toBe('%:schema');
    });

    it('handles all coarse types', () => {
      for (const coarse of ['repo', 'file', 'module', 'service', 'event', 'learned_fact']) {
        const result = resolveTypeFilter(coarse);
        expect(result.param).toBe(`${coarse}:%`);
      }
    });

    it('treats unknown types as granular sub-types', () => {
      const result = resolveTypeFilter('graphql_query');
      expect(result.param).toBe('%:graphql_query');
    });
  });

  describe('parseCompositeType', () => {
    it('parses module:schema', () => {
      const result = parseCompositeType('module:schema');
      expect(result.entityType).toBe('module');
      expect(result.subType).toBe('schema');
    });

    it('parses event:event', () => {
      const result = parseCompositeType('event:event');
      expect(result.entityType).toBe('event');
      expect(result.subType).toBe('event');
    });

    it('handles legacy format without colon', () => {
      const result = parseCompositeType('module');
      expect(result.entityType).toBe('module');
      expect(result.subType).toBe('module');
    });

    it('parses service:grpc', () => {
      const result = parseCompositeType('service:grpc');
      expect(result.entityType).toBe('service');
      expect(result.subType).toBe('grpc');
    });
  });

  describe('executeFtsWithFallback', () => {
    it('returns results for valid FTS query', () => {
      indexEntity(db, { type: 'service', id: 1, name: 'BookingService', description: 'Handles bookings' });

      const sql = `
        SELECT entity_type, entity_id, name, description, rank as relevance
        FROM knowledge_fts
        WHERE knowledge_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `;

      const results = executeFtsWithFallback<{
        entity_type: string; entity_id: number; name: string; description: string | null; relevance: number;
      }>(db, sql, 'booking', (q) => [q, 20]);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entity_id).toBe(1);
      expect(results[0].name).toContain('booking');
    });

    it('falls back to phrase query on syntax error (unbalanced quotes)', () => {
      indexEntity(db, { type: 'event', id: 2, name: 'OrderCreated', description: 'order was created' });

      const sql = `
        SELECT entity_type, entity_id, name
        FROM knowledge_fts
        WHERE knowledge_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `;

      // Unbalanced quote is an FTS5 syntax error -- helper should fall back to phrase query
      const results = executeFtsWithFallback<{ entity_type: string; entity_id: number; name: string }>(
        db, sql, '"order', (q) => [q, 20],
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entity_id).toBe(2);
    });

    it('returns empty array when both attempts fail', () => {
      // No data indexed -- query against empty FTS table with invalid SQL structure
      const badSql = `
        SELECT entity_type, entity_id, name
        FROM knowledge_fts
        WHERE knowledge_fts MATCH ?
        AND nonexistent_column = ?
        LIMIT ?
      `;

      const results = executeFtsWithFallback<{ entity_type: string; entity_id: number; name: string }>(
        db, badSql, 'anything', (q) => [q, 'bad', 20],
      );

      expect(results).toEqual([]);
    });
  });

  describe('listAvailableTypes', () => {
    it('returns grouped structure with counts', () => {
      indexEntity(db, { type: 'module', id: 1, name: 'Schema1', subType: 'schema' });
      indexEntity(db, { type: 'module', id: 2, name: 'Schema2', subType: 'schema' });
      indexEntity(db, { type: 'module', id: 3, name: 'Context1', subType: 'context' });
      indexEntity(db, { type: 'event', id: 4, name: 'Event1', subType: 'event' });
      indexEntity(db, { type: 'service', id: 5, name: 'Svc1', subType: 'grpc' });

      const types = listAvailableTypes(db);

      expect(types.module).toBeDefined();
      expect(types.event).toBeDefined();
      expect(types.service).toBeDefined();

      // Module should have schema (2) and context (1)
      const schemaEntry = types.module.find(t => t.subType === 'schema');
      expect(schemaEntry).toBeDefined();
      expect(schemaEntry!.count).toBe(2);

      const contextEntry = types.module.find(t => t.subType === 'context');
      expect(contextEntry).toBeDefined();
      expect(contextEntry!.count).toBe(1);

      // Event has 1
      expect(types.event.find(t => t.subType === 'event')!.count).toBe(1);

      // Service has 1 grpc
      expect(types.service.find(t => t.subType === 'grpc')!.count).toBe(1);
    });
  });

  describe('buildOrQuery', () => {
    it('multi-term input joins tokenized terms with OR', () => {
      expect(buildOrQuery('booking payment')).toBe('booking OR payment');
    });

    it('single term passthrough without OR', () => {
      expect(buildOrQuery('booking')).toBe('booking');
    });

    it('empty input returns empty string', () => {
      expect(buildOrQuery('')).toBe('');
    });

    it('whitespace-only input returns empty string', () => {
      expect(buildOrQuery('  ')).toBe('');
    });

    it('CamelCase terms are split per term then joined with OR', () => {
      expect(buildOrQuery('BookingCreated PaymentProcessor')).toBe('booking created OR payment processor');
    });

    it('OR operator survives (not lowercased by tokenizer)', () => {
      // The literal string "OR" must appear uppercase in output
      const result = buildOrQuery('booking payment');
      expect(result).toContain(' OR ');
      expect(result).not.toContain(' or ');
    });
  });

  describe('buildPrefixOrQuery', () => {
    it('appends prefix wildcard to each tokenized term', () => {
      expect(buildPrefixOrQuery('booking payment')).toBe('booking* OR payment*');
    });

    it('single term gets prefix wildcard', () => {
      expect(buildPrefixOrQuery('book')).toBe('book*');
    });
  });

  describe('searchWithRelaxation', () => {
    it('single-term query runs one FTS query', () => {
      indexEntity(db, { type: 'service', id: 1, name: 'BookingService', description: 'Handles bookings' });

      const results = searchWithRelaxation(db, 'booking', 20);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].entity_id).toBe(1);
    });

    it('AND sufficient results (>= 3) returns AND results without relaxation', () => {
      // Index 3+ entities that match BOTH terms via implicit AND
      indexEntity(db, { type: 'module', id: 1, name: 'BookingPayment', description: 'booking payment module' });
      indexEntity(db, { type: 'module', id: 2, name: 'BookingPaymentV2', description: 'booking payment v2' });
      indexEntity(db, { type: 'module', id: 3, name: 'BookingPaymentV3', description: 'booking payment v3' });

      const results = searchWithRelaxation(db, 'booking payment', 20);
      expect(results.length).toBeGreaterThanOrEqual(MIN_RELAXATION_RESULTS);
    });

    it('AND insufficient triggers OR relaxation', () => {
      // Index entities where only ONE term matches each (no entity has both)
      indexEntity(db, { type: 'service', id: 1, name: 'BookingService', description: 'Handles hotel reservations' });
      indexEntity(db, { type: 'service', id: 2, name: 'PaymentGateway', description: 'Processes charges' });
      indexEntity(db, { type: 'event', id: 3, name: 'InvoiceSent', description: 'Invoice notification' });

      // AND("booking payment") -> 0 results (no entity has both)
      // OR("booking OR payment") -> 2 results (one per term)
      const results = searchWithRelaxation(db, 'booking payment', 20);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('OR insufficient triggers prefix OR relaxation', () => {
      // Index entities where only prefixes match
      indexEntity(db, { type: 'service', id: 1, name: 'BookSomething', description: 'A book handler' });
      indexEntity(db, { type: 'service', id: 2, name: 'PayProcessor', description: 'Processes pay stuff' });

      // AND("book pay") -> 0 results
      // OR("book OR pay") -> 2 results (each matches one term)
      // If OR returns < 3, prefix OR("book* OR pay*") tries prefix matching
      const results = searchWithRelaxation(db, 'book pay', 20);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it('entityTypeFilter preserved across all relaxation steps', () => {
      // Mix of entity types, but only services should be returned
      indexEntity(db, { type: 'service', id: 1, name: 'BookingService', description: 'Handles bookings' });
      indexEntity(db, { type: 'module', id: 2, name: 'PaymentModule', description: 'Payment handler module' });
      indexEntity(db, { type: 'event', id: 3, name: 'BookingCreated', description: 'Booking event' });

      // With service filter, only BookingService matches even after relaxation
      const results = searchWithRelaxation(db, 'booking payment', 20, 'service');
      for (const r of results) {
        expect(r.entity_type).toMatch(/^service:/);
      }
    });

    it('empty query returns empty array', () => {
      indexEntity(db, { type: 'service', id: 1, name: 'BookingService' });

      const results = searchWithRelaxation(db, '', 20);
      expect(results).toEqual([]);
    });

    it('whitespace-only query returns empty array', () => {
      indexEntity(db, { type: 'service', id: 1, name: 'BookingService' });

      const results = searchWithRelaxation(db, '   ', 20);
      expect(results).toEqual([]);
    });
  });
});
