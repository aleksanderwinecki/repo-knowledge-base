/**
 * FTS golden query tests.
 *
 * These lock current search quality and code path coverage.
 * A tokenizer, ranking, or query-path change that degrades search will fail here.
 *
 * NEVER assert exact relevance scores — only names, ordering, and presence/absence.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { searchText } from '../../src/search/text.js';
import { findEntity } from '../../src/search/entity.js';
import { seedTestData } from '../fixtures/seed.js';

let db: Database.Database;
let dbPath: string;

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-golden-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
  seedTestData(db);
});

afterEach(() => {
  closeDatabase(db);
  const dir = path.dirname(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('FTS golden queries', () => {
  // 1. Basic FTS MATCH
  it('single word "booking" returns booking entities in top results', () => {
    const results = searchText(db, 'booking');
    expect(results.length).toBeGreaterThan(0);

    const names = results.map((r) => r.name);
    // At least one booking-related entity in top 3
    const topNames = names.slice(0, 3);
    const hasBooking = topNames.some(
      (n) => n.toLowerCase().includes('booking') || n.toLowerCase().includes('bookingcreated'),
    );
    expect(hasBooking).toBe(true);
  });

  // 2. Phrase search
  it('phrase "booking creation" matches BookingContext.Commands.CreateBooking', () => {
    const results = searchText(db, '"booking creation"');
    expect(results.length).toBeGreaterThan(0);

    const names = results.map((r) => r.name);
    expect(names).toContain('BookingContext.Commands.CreateBooking');
  });

  // 3. FTS5 AND
  it('AND query "booking AND cancellation" returns module with both terms', () => {
    const results = searchText(db, 'booking AND cancellation');
    expect(results.length).toBeGreaterThan(0);

    const hasBothTerms = results.some(
      (r) =>
        (r.name.toLowerCase().includes('cancellation') ||
          r.snippet.toLowerCase().includes('cancellation')) &&
        (r.name.toLowerCase().includes('booking') ||
          r.snippet.toLowerCase().includes('booking')),
    );
    expect(hasBothTerms).toBe(true);
  });

  // 4. FTS5 OR — tokenizer lowercases "OR" so it's treated as implicit AND of 3 words.
  //    Golden test locks this behavior: separate queries return cross-repo results.
  it('OR-style query: separate searches return results from both repos', () => {
    const bookingResults = searchText(db, 'booking');
    const paymentResults = searchText(db, 'payment');

    expect(bookingResults.length).toBeGreaterThan(0);
    expect(paymentResults.length).toBeGreaterThan(0);

    const bookingRepos = new Set(bookingResults.map((r) => r.repoName));
    const paymentRepos = new Set(paymentResults.map((r) => r.repoName));
    expect(bookingRepos.has('booking-service')).toBe(true);
    expect(paymentRepos.has('payments-service')).toBe(true);
  });

  // 5. FTS5 NOT — tokenizer lowercases "NOT" so it becomes implicit AND of 3 words.
  //    Golden test: the query effectively requires all 3 terms, so Cancellation module
  //    (which doesn't contain the literal word "not") is excluded.
  it('NOT-style query "booking NOT cancellation" excludes BookingContext.Cancellation', () => {
    const results = searchText(db, 'booking NOT cancellation');

    const names = results.map((r) => r.name);
    expect(names).not.toContain('BookingContext.Cancellation');
  });

  // 6. Granular type filter (schema)
  it('type filter "payment" + type schema returns only Payments.Schema.Transaction', () => {
    const results = searchText(db, 'payment', { entityTypeFilter: 'schema' });
    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(r.entityType).toBe('module');
      expect(r.subType).toBe('schema');
    }
    expect(results.some((r) => r.name === 'Payments.Schema.Transaction')).toBe(true);
  });

  // 7. Coarse type filter (module)
  it('coarse type filter "booking" + type module returns module-family results', () => {
    const results = searchText(db, 'booking', { entityTypeFilter: 'module' });
    expect(results.length).toBeGreaterThan(0);

    for (const r of results) {
      expect(r.entityType).toBe('module');
    }
  });

  // 8. FTS5 prefix — tokenizer strips "*" so "book*" becomes "book" (exact word match).
  //    Golden test locks this: prefix queries degrade to exact-word search.
  //    "booking" (the full word) does match because CamelCase splitting tokenizes it.
  it('prefix-style "book*" degrades to exact word; full word "booking" works', () => {
    // Prefix stripped by tokenizer — "book" alone may not match "booking"
    const prefixResults = searchText(db, 'book*');
    // Lock the current behavior: prefix doesn't expand
    expect(prefixResults).toEqual([]);

    // Full word still works
    const fullResults = searchText(db, 'booking');
    expect(fullResults.length).toBeGreaterThan(0);
    const hasBooking = fullResults.some(
      (r) => r.name.toLowerCase().includes('booking'),
    );
    expect(hasBooking).toBe(true);
  });

  // 9. Entity exact match
  it('findEntity exact match for BookingContext.Commands.CreateBooking returns card', () => {
    const cards = findEntity(db, 'BookingContext.Commands.CreateBooking');
    expect(cards.length).toBeGreaterThan(0);

    const card = cards[0];
    expect(card.name).toBe('BookingContext.Commands.CreateBooking');
    expect(card.type).toBe('module');
    expect(card.repoName).toBe('booking-service');
  });

  // 10. Entity FTS fallback
  it('findEntity FTS fallback for "payment processor" returns PaymentProcessor', () => {
    const cards = findEntity(db, 'payment processor');
    expect(cards.length).toBeGreaterThan(0);

    const hasProcessor = cards.some((c) => c.name === 'PaymentProcessor');
    expect(hasProcessor).toBe(true);
  });

  // 11. Repo filter
  it('repo filter "booking" + repo payments-service returns only payments-service results', () => {
    const results = searchText(db, 'booking', { repoFilter: 'payments-service' });

    for (const r of results) {
      expect(r.repoName).toBe('payments-service');
    }
    // "booking" in payments-service comes from PaymentProcessor summary mentioning "booking confirmation"
    // May or may not match — just verify the filter works (no booking-service results)
  });

  // 12. No results
  it('non-matching query "zznonexistent" returns empty array', () => {
    const results = searchText(db, 'zznonexistent');
    expect(results).toEqual([]);
  });

  // 13. Special chars / syntax error fallback
  it('special chars "***" does not throw and returns empty array', () => {
    expect(() => searchText(db, '***')).not.toThrow();
    const results = searchText(db, '***');
    expect(results).toEqual([]);
  });

  // 14. Learned fact search
  it('learned fact search for "Stripe API" finds the fact', () => {
    const results = searchText(db, 'Stripe API');
    expect(results.length).toBeGreaterThan(0);

    const hasFact = results.some((r) => r.entityType === 'learned_fact');
    expect(hasFact).toBe(true);
  });

  // 15. Service search
  it('service search "gateway" returns PaymentGateway', () => {
    const results = searchText(db, 'gateway');
    expect(results.length).toBeGreaterThan(0);

    const serviceResult = results.find((r) => r.entityType === 'service');
    expect(serviceResult).toBeDefined();
    expect(serviceResult!.name).toBe('PaymentGateway');
  });
});
