import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { indexEntity, removeEntity, search, resolveTypeFilter, parseCompositeType, listAvailableTypes } from '../../src/db/fts.js';
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
});
