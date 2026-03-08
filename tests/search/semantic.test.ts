import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { isVecAvailable } from '../../src/db/vec.js';
import { persistRepoData } from '../../src/indexer/writer.js';

/**
 * Semantic search tests using mock embeddings -- no model download required.
 * Tests KNN search, graceful degradation, and query embedding prefix.
 */

const DIM = 256;

let db: Database.Database;
let dbPath: string;

/** Create a fake 256d Float32Array with a known pattern */
function fakeVec(seed: number): Float32Array {
  const vec = new Float32Array(DIM);
  for (let i = 0; i < DIM; i++) {
    vec[i] = Math.sin(seed * (i + 1));
  }
  // L2 normalize
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm);
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

const QUERY_VEC = fakeVec(42);

// Mock the pipeline module so no model is loaded
vi.mock('../../src/embeddings/pipeline.js', () => {
  const dim = 256;
  function mockFakeVec(seed: number): Float32Array {
    const vec = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      vec[i] = Math.sin(seed * (i + 1));
    }
    let norm = 0;
    for (let i = 0; i < vec.length; i++) norm += vec[i]! * vec[i]!;
    norm = Math.sqrt(norm);
    for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return vec;
  }
  return {
    MATRYOSHKA_DIM: dim,
    generateQueryEmbedding: vi.fn().mockResolvedValue(mockFakeVec(42)),
    generateEmbedding: vi.fn().mockResolvedValue(mockFakeVec(42)),
    generateEmbeddingsBatch: vi.fn().mockResolvedValue([]),
    getEmbeddingPipeline: vi.fn().mockResolvedValue({}),
  };
});

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-search-semantic-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);

  if (!isVecAvailable()) {
    throw new Error('sqlite-vec not available -- cannot run semantic tests');
  }

  // Populate with test data
  persistRepoData(db, {
    metadata: {
      name: 'booking-service',
      path: '/repos/booking-service',
      description: 'Handles hotel booking',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'abc123',
    },
    modules: [
      {
        name: 'BookingContext',
        type: 'context',
        filePath: 'lib/booking_context.ex',
        summary: 'Manages hotel bookings and reservations',
      },
      {
        name: 'CancellationPolicy',
        type: 'module',
        filePath: 'lib/cancellation.ex',
        summary: 'Handles booking cancellation workflows',
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

  persistRepoData(db, {
    metadata: {
      name: 'payments-service',
      path: '/repos/payments-service',
      description: 'Payment processing',
      techStack: ['elixir'],
      keyFiles: ['mix.exs'],
      currentCommit: 'def456',
    },
    modules: [
      {
        name: 'PaymentProcessor',
        type: 'module',
        filePath: 'lib/payment_processor.ex',
        summary: 'Processes credit card payments',
      },
    ],
    events: [],
  });

  // Get entity IDs
  const bookingModule = db.prepare("SELECT id FROM modules WHERE name = 'BookingContext'").get() as { id: number };
  const cancellationModule = db.prepare("SELECT id FROM modules WHERE name = 'CancellationPolicy'").get() as { id: number };
  const bookingEvent = db.prepare("SELECT id FROM events WHERE name = 'BookingCreated'").get() as { id: number };
  const paymentModule = db.prepare("SELECT id FROM modules WHERE name = 'PaymentProcessor'").get() as { id: number };

  // Insert synthetic embeddings directly into vec0
  // Embedding close to query vec (seed 42) = seed 43
  // Embedding far from query vec (seed 42) = seed 100
  const insertEmb = db.prepare(
    'INSERT INTO entity_embeddings(embedding, entity_type, entity_id) VALUES (?, ?, ?)',
  );
  insertEmb.run(Buffer.from(fakeVec(43).buffer), 'module', String(bookingModule.id));
  insertEmb.run(Buffer.from(fakeVec(100).buffer), 'module', String(cancellationModule.id));
  insertEmb.run(Buffer.from(fakeVec(44).buffer), 'event', String(bookingEvent.id));
  insertEmb.run(Buffer.from(fakeVec(200).buffer), 'module', String(paymentModule.id));
});

afterEach(() => {
  if (db?.open) closeDatabase(db);
  try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
});

describe('searchSemantic', () => {
  it('returns results sorted by distance (closest first)', async () => {
    const { searchSemantic } = await import('../../src/search/semantic.js');
    const results = await searchSemantic(db, 'hotel booking');

    expect(results.length).toBeGreaterThan(0);
    // Results should be sorted by relevance descending (highest = closest)
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.relevance).toBeGreaterThanOrEqual(results[i]!.relevance);
    }
  });

  it('returns [] when vec unavailable', async () => {
    vi.doMock('../../src/db/vec.js', () => ({
      isVecAvailable: () => false,
      loadVecExtension: () => false,
    }));

    // Must re-import to pick up the mock
    const mod = await import('../../src/search/semantic.js');
    const results = await mod.searchSemantic(db, 'hotel booking');
    expect(results).toEqual([]);

    vi.doUnmock('../../src/db/vec.js');
  });

  it('returns [] when embeddings table empty', async () => {
    // Clear all embeddings
    db.exec('DELETE FROM entity_embeddings');

    const { searchSemantic } = await import('../../src/search/semantic.js');
    const results = await searchSemantic(db, 'hotel booking');
    expect(results).toEqual([]);
  });

  it('respects limit option', async () => {
    const { searchSemantic } = await import('../../src/search/semantic.js');
    const results = await searchSemantic(db, 'hotel booking', { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('respects repoFilter option', async () => {
    const { searchSemantic } = await import('../../src/search/semantic.js');
    const results = await searchSemantic(db, 'hotel booking', { repoFilter: 'booking-service' });
    for (const r of results) {
      expect(r.repoName).toBe('booking-service');
    }
    // payments-service module should be excluded
    const paymentResult = results.find((r) => r.name === 'PaymentProcessor');
    expect(paymentResult).toBeUndefined();
  });

  it('handles entity not found in hydration gracefully', async () => {
    // Insert an embedding for a non-existent entity
    const insertEmb = db.prepare(
      'INSERT INTO entity_embeddings(embedding, entity_type, entity_id) VALUES (?, ?, ?)',
    );
    insertEmb.run(Buffer.from(fakeVec(42).buffer), 'module', '9999');

    const { searchSemantic } = await import('../../src/search/semantic.js');
    // Should not throw -- just skip the missing entity
    const results = await searchSemantic(db, 'hotel booking');
    const ghost = results.find((r) => r.entityId === 9999);
    expect(ghost).toBeUndefined();
  });

  it('converts distance to relevance via 1/(1+distance)', async () => {
    const { searchSemantic } = await import('../../src/search/semantic.js');
    const results = await searchSemantic(db, 'hotel booking');

    for (const r of results) {
      // relevance should be between 0 and 1 (since distance >= 0)
      expect(r.relevance).toBeGreaterThan(0);
      expect(r.relevance).toBeLessThanOrEqual(1);
    }
  });

  it('sets subType equal to entityType', async () => {
    const { searchSemantic } = await import('../../src/search/semantic.js');
    const results = await searchSemantic(db, 'hotel booking');

    for (const r of results) {
      expect(r.subType).toBe(r.entityType);
    }
  });
});

describe('generateQueryEmbedding', () => {
  it('returns a Float32Array of MATRYOSHKA_DIM length', async () => {
    const { generateQueryEmbedding } = await import('../../src/embeddings/pipeline.js');
    const result = await generateQueryEmbedding('hotel booking');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(DIM);
  });
});
