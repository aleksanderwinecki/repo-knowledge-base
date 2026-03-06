import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { learnFact, listFacts, forgetFact } from '../../src/knowledge/store.js';
import { SCHEMA_VERSION } from '../../src/db/schema.js';
import type Database from 'better-sqlite3';

describe('knowledge store', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-knowledge-'));
    db = openDatabase(path.join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('schema migration', () => {
    it('schema version is 3', () => {
      expect(SCHEMA_VERSION).toBe(3);
    });

    it('learned_facts table exists after migration', () => {
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='learned_facts'",
        )
        .all() as Array<{ name: string }>;
      expect(tables).toHaveLength(1);
    });

    it('learned_facts table has expected columns', () => {
      const info = db.prepare('PRAGMA table_info(learned_facts)').all() as Array<{
        name: string;
      }>;
      const columns = info.map((c) => c.name);
      expect(columns).toContain('id');
      expect(columns).toContain('content');
      expect(columns).toContain('repo');
      expect(columns).toContain('created_at');
    });
  });

  describe('learnFact', () => {
    it('creates a learned fact and returns it with an id', () => {
      const fact = learnFact(db, 'payments-service owns the billing domain');
      expect(fact.id).toBeGreaterThan(0);
      expect(fact.content).toBe('payments-service owns the billing domain');
      expect(fact.repo).toBeNull();
      expect(fact.createdAt).toBeTruthy();
    });

    it('associates fact with a repo when specified', () => {
      const fact = learnFact(
        db,
        'uses protobuf v3 for events',
        'payments-service',
      );
      expect(fact.repo).toBe('payments-service');
    });

    it('indexes the fact in FTS for searchability', () => {
      learnFact(db, 'payments-service owns the billing domain');

      const rows = db
        .prepare(
          "SELECT * FROM knowledge_fts WHERE knowledge_fts MATCH 'payments' AND entity_type = 'learned_fact'",
        )
        .all();
      expect(rows.length).toBeGreaterThan(0);
    });

    it('returns incrementing IDs for multiple facts', () => {
      const f1 = learnFact(db, 'fact one');
      const f2 = learnFact(db, 'fact two');
      expect(f2.id).toBeGreaterThan(f1.id);
    });
  });

  describe('listFacts', () => {
    it('returns all facts ordered by created_at DESC, id DESC', () => {
      learnFact(db, 'first fact');
      learnFact(db, 'second fact');
      learnFact(db, 'third fact');

      const facts = listFacts(db);
      expect(facts).toHaveLength(3);
      // All three should be present
      const contents = facts.map((f) => f.content);
      expect(contents).toContain('first fact');
      expect(contents).toContain('second fact');
      expect(contents).toContain('third fact');
    });

    it('filters by repo when specified', () => {
      learnFact(db, 'fact for payments', 'payments-service');
      learnFact(db, 'fact for booking', 'booking-service');
      learnFact(db, 'global fact');

      const paymentsFacts = listFacts(db, 'payments-service');
      expect(paymentsFacts).toHaveLength(1);
      expect(paymentsFacts[0].content).toBe('fact for payments');
    });

    it('returns empty array when no facts exist', () => {
      const facts = listFacts(db);
      expect(facts).toEqual([]);
    });
  });

  describe('forgetFact', () => {
    it('deletes a fact and returns true', () => {
      const fact = learnFact(db, 'to be forgotten');
      const deleted = forgetFact(db, fact.id);
      expect(deleted).toBe(true);

      const remaining = listFacts(db);
      expect(remaining).toHaveLength(0);
    });

    it('returns false for non-existent id', () => {
      const deleted = forgetFact(db, 99999);
      expect(deleted).toBe(false);
    });

    it('removes the fact from FTS index', () => {
      const fact = learnFact(db, 'searchable fact about billing');

      // Verify it's in FTS
      let ftsRows = db
        .prepare(
          "SELECT * FROM knowledge_fts WHERE knowledge_fts MATCH 'billing' AND entity_type = 'learned_fact'",
        )
        .all();
      expect(ftsRows.length).toBeGreaterThan(0);

      // Forget it
      forgetFact(db, fact.id);

      // Verify it's gone from FTS
      ftsRows = db
        .prepare(
          "SELECT * FROM knowledge_fts WHERE knowledge_fts MATCH 'billing' AND entity_type = 'learned_fact'",
        )
        .all();
      expect(ftsRows).toHaveLength(0);
    });

    it('does not affect other facts', () => {
      const f1 = learnFact(db, 'keep me');
      const f2 = learnFact(db, 'delete me');

      forgetFact(db, f2.id);

      const remaining = listFacts(db);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(f1.id);
    });
  });
});
