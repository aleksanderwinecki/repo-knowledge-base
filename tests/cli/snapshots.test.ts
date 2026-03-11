/**
 * CLI output shape snapshot tests.
 *
 * These lock the JSON structure of every data-producing function behind CLI commands.
 * A field rename, addition, or removal will fail the corresponding test.
 *
 * Each test asserts BOTH:
 *   1. Shape via toMatchObject() with expect.any() for volatile fields
 *   2. Exact key set via Object.keys().sort() to catch additions/removals
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { searchText } from '../../src/search/text.js';
import { findEntity } from '../../src/search/entity.js';
import { queryDependencies } from '../../src/search/dependencies.js';
import { listAvailableTypes } from '../../src/db/fts.js';
import { learnFact, listFacts, forgetFact } from '../../src/knowledge/store.js';
import { seedTestData } from '../fixtures/seed.js';

let db: Database.Database;
let dbPath: string;

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-snapshots-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
  seedTestData(db);
});

afterEach(() => {
  closeDatabase(db);
  const dir = path.dirname(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('CLI output shape snapshots', () => {
  // 1. searchText result shape
  it('searchText result has exact expected keys', () => {
    const results = searchText(db, 'booking');
    expect(results.length).toBeGreaterThan(0);

    const first = results[0];

    // Shape check
    expect(first).toMatchObject({
      entityType: expect.any(String),
      subType: expect.any(String),
      entityId: expect.any(Number),
      name: expect.any(String),
      snippet: expect.any(String),
      repoName: expect.any(String),
      repoPath: expect.any(String),
      relevance: expect.any(Number),
    });
    // filePath is string | null
    expect(typeof first.filePath === 'string' || first.filePath === null).toBe(true);

    // Exact key set
    expect(Object.keys(first).sort()).toEqual([
      'entityId',
      'entityType',
      'filePath',
      'name',
      'nextAction',
      'relevance',
      'repoName',
      'repoPath',
      'snippet',
      'subType',
    ]);
  });

  // 2. findEntity result shape
  it('findEntity result has exact expected keys', () => {
    const cards = findEntity(db, 'BookingContext.Commands.CreateBooking');
    expect(cards.length).toBeGreaterThan(0);

    const card = cards[0];

    // Shape check
    expect(card).toMatchObject({
      name: expect.any(String),
      type: expect.any(String),
      repoName: expect.any(String),
      relationships: expect.any(Array),
    });
    // filePath and description are string | null
    expect(typeof card.filePath === 'string' || card.filePath === null).toBe(true);
    expect(typeof card.description === 'string' || card.description === null).toBe(true);

    // Exact key set
    expect(Object.keys(card).sort()).toEqual([
      'description',
      'filePath',
      'name',
      'relationships',
      'repoName',
      'type',
    ]);
  });

  // 3. listAvailableTypes shape
  it('listAvailableTypes result is grouped by entity type with sub-type counts', () => {
    const types = listAvailableTypes(db);

    expect(typeof types).toBe('object');
    expect(types).not.toBeNull();

    // At least one entity type
    const keys = Object.keys(types);
    expect(keys.length).toBeGreaterThan(0);

    // Each value is an array of { subType, count }
    for (const key of keys) {
      const entries = types[key];
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);

      for (const entry of entries) {
        expect(Object.keys(entry).sort()).toEqual(['count', 'subType']);
        expect(typeof entry.subType).toBe('string');
        expect(typeof entry.count).toBe('number');
      }
    }
  });

  // 4. queryDependencies shape
  it('queryDependencies result has entity and dependencies keys', () => {
    const result = queryDependencies(db, 'booking-service');

    // Always returns a result (even with no deps)
    expect(result).toBeDefined();

    // Shape check
    expect(result).toMatchObject({
      entity: {
        name: expect.any(String),
        type: expect.any(String),
        repoName: expect.any(String),
      },
      dependencies: expect.any(Array),
    });

    // Exact key set on result
    expect(Object.keys(result).sort()).toEqual(['dependencies', 'entity']);

    // Exact key set on entity
    expect(Object.keys(result.entity).sort()).toEqual(['name', 'repoName', 'type']);

    // If there are dependencies, check their shape
    if (result.dependencies.length > 0) {
      const dep = result.dependencies[0];
      expect(Object.keys(dep).sort()).toEqual([
        'depth',
        'mechanism',
        'name',
        'path',
        'repoName',
        'type',
      ]);
    }
  });

  // 5. status shape (direct SQL, same as CLI status command)
  it('status query returns expected shape with all count fields', () => {
    const count = (table: string) => {
      const row = db
        .prepare(`SELECT COUNT(*) as n FROM ${table}`)
        .get() as { n: number };
      return row.n;
    };

    let learnedFacts = 0;
    try {
      learnedFacts = count('learned_facts');
    } catch {
      // Table might not exist
    }

    const stats = {
      database: dbPath,
      repos: count('repos'),
      files: count('files'),
      modules: count('modules'),
      services: count('services'),
      events: count('events'),
      edges: count('edges'),
      learnedFacts,
    };

    // Shape check
    expect(stats).toMatchObject({
      database: expect.any(String),
      repos: expect.any(Number),
      files: expect.any(Number),
      modules: expect.any(Number),
      services: expect.any(Number),
      events: expect.any(Number),
      edges: expect.any(Number),
      learnedFacts: expect.any(Number),
    });

    // Exact key set
    expect(Object.keys(stats).sort()).toEqual([
      'database',
      'edges',
      'events',
      'files',
      'learnedFacts',
      'modules',
      'repos',
      'services',
    ]);

    // Sanity: seed data produces non-zero counts
    expect(stats.repos).toBe(2);
    expect(stats.modules).toBeGreaterThanOrEqual(5);
    expect(stats.services).toBeGreaterThanOrEqual(1);
    expect(stats.events).toBeGreaterThanOrEqual(1);
  });

  // 6. learnFact result shape
  it('learnFact result has exact expected keys', () => {
    const fact = learnFact(db, 'test fact for shape check', 'test-repo');

    // Shape check
    expect(fact).toMatchObject({
      id: expect.any(Number),
      content: 'test fact for shape check',
      repo: 'test-repo',
      createdAt: expect.any(String),
    });

    // Exact key set
    expect(Object.keys(fact).sort()).toEqual([
      'content',
      'createdAt',
      'id',
      'repo',
    ]);
  });

  // 7. listFacts result shape
  it('listFacts returns array of LearnedFact shapes', () => {
    const facts = listFacts(db);

    // Seed data includes 2 facts
    expect(facts.length).toBeGreaterThanOrEqual(2);

    for (const fact of facts) {
      // Shape check
      expect(fact).toMatchObject({
        id: expect.any(Number),
        content: expect.any(String),
        createdAt: expect.any(String),
      });
      // repo is string | null
      expect(typeof fact.repo === 'string' || fact.repo === null).toBe(true);

      // Exact key set
      expect(Object.keys(fact).sort()).toEqual([
        'content',
        'createdAt',
        'id',
        'repo',
      ]);
    }
  });

  // 8. forgetFact result shape
  it('forgetFact returns boolean indicating deletion success', () => {
    // Learn a fact so we have a known ID
    const fact = learnFact(db, 'ephemeral fact', 'test-repo');

    // Forget existing fact
    const deleted = forgetFact(db, fact.id);
    expect(deleted).toBe(true);

    // Forget non-existent fact
    const notDeleted = forgetFact(db, 99999);
    expect(notDeleted).toBe(false);
  });
});
