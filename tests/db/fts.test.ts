import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { indexEntity, removeEntity, search } from '../../src/db/fts.js';
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
    expect(results[0].entityType).toBe('service');
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
    expect(results[0].entityType).toBe('event');
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
    expect(results[0].entityType).toBe('service');
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
    expect(results[0].entityType).toBe('module');
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
});
