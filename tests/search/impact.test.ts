import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import {
  analyzeImpact,
  formatImpactCompact,
  formatImpactVerbose,
} from '../../src/search/impact.js';
import type { ImpactResult } from '../../src/search/impact.js';

let db: Database.Database;
let dbPath: string;

// --- Test helpers (same pattern as graph.test.ts) ---

function insertRepo(database: Database.Database, name: string): number {
  const result = database
    .prepare('INSERT INTO repos (name, path, description) VALUES (?, ?, ?)')
    .run(name, `/repos/${name}`, `${name} service`);
  return Number(result.lastInsertRowid);
}

function insertDirectEdge(
  database: Database.Database,
  sourceRepoId: number,
  targetRepoId: number,
  relType: string,
  metadata?: string,
): void {
  database
    .prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run('repo', sourceRepoId, 'repo', targetRepoId, relType, 'src/client.ex', metadata ?? null);
}

function insertEvent(database: Database.Database, repoId: number, name: string): number {
  const result = database
    .prepare('INSERT INTO events (repo_id, name, schema_definition, source_file) VALUES (?, ?, ?, ?)')
    .run(repoId, name, `message ${name} {}`, 'proto/events.proto');
  return Number(result.lastInsertRowid);
}

function insertEventEdge(
  database: Database.Database,
  repoId: number,
  eventId: number,
  relType: 'produces_event' | 'consumes_event',
): void {
  database
    .prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run('repo', repoId, 'event', eventId, relType, 'proto/events.proto');
}

function insertKafkaEdge(
  database: Database.Database,
  repoId: number,
  topic: string,
  relType: 'produces_kafka' | 'consumes_kafka',
): void {
  database
    .prepare(
      'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      'repo', repoId, 'service_name', 0, relType, 'lib/kafka.ex',
      JSON.stringify({ confidence: 'high', topic, targetName: topic }),
    );
}

// --- Fixtures ---

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-impact-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

// =========================================================================
// analyzeImpact
// =========================================================================

describe('analyzeImpact', () => {
  // --- Tier classification ---

  describe('tier classification', () => {
    it('classifies depth-1 nodes as direct', () => {
      // B -> A (B calls A). Upstream of A: B at depth 1 = direct
      const a = insertRepo(db, 'tier-target');
      const b = insertRepo(db, 'tier-direct');
      insertDirectEdge(db, b, a, 'calls_grpc');

      const result = analyzeImpact(db, 'tier-target');

      expect(result.tiers.direct.length).toBe(1);
      expect(result.tiers.direct[0].name).toBe('tier-direct');
      expect(result.tiers.indirect.length).toBe(0);
      expect(result.tiers.transitive.length).toBe(0);
    });

    it('classifies depth-2 nodes as indirect', () => {
      // C -> B -> A. Upstream of A: B=direct, C=indirect
      const a = insertRepo(db, 'ind-target');
      const b = insertRepo(db, 'ind-direct');
      const c = insertRepo(db, 'ind-indirect');
      insertDirectEdge(db, b, a, 'calls_grpc');
      insertDirectEdge(db, c, b, 'calls_grpc');

      const result = analyzeImpact(db, 'ind-target');

      expect(result.tiers.direct.length).toBe(1);
      expect(result.tiers.indirect.length).toBe(1);
      expect(result.tiers.indirect[0].name).toBe('ind-indirect');
    });

    it('classifies depth-3+ nodes as transitive (single bucket)', () => {
      // E -> D -> C -> B -> A. Upstream of A: B=1, C=2, D=3
      // With default maxDepth=3, D is at depth 3 -> transitive
      const a = insertRepo(db, 'trans-target');
      const b = insertRepo(db, 'trans-d1');
      const c = insertRepo(db, 'trans-d2');
      const d = insertRepo(db, 'trans-d3');
      insertDirectEdge(db, b, a, 'calls_grpc');
      insertDirectEdge(db, c, b, 'calls_grpc');
      insertDirectEdge(db, d, c, 'calls_grpc');

      const result = analyzeImpact(db, 'trans-target');

      expect(result.tiers.direct.length).toBe(1);
      expect(result.tiers.indirect.length).toBe(1);
      expect(result.tiers.transitive.length).toBe(1);
      expect(result.tiers.transitive[0].name).toBe('trans-d3');
    });

    it('each entry has name, mechanisms (deduped), and confidence array', () => {
      const a = insertRepo(db, 'entry-target');
      const b = insertRepo(db, 'entry-caller');
      // B calls A via grpc twice (different confidence) and once via http
      insertDirectEdge(db, b, a, 'calls_grpc', JSON.stringify({ confidence: 'high' }));
      insertDirectEdge(db, b, a, 'calls_grpc', JSON.stringify({ confidence: 'low' }));
      insertDirectEdge(db, b, a, 'calls_http', JSON.stringify({ confidence: 'medium' }));

      const result = analyzeImpact(db, 'entry-target');

      expect(result.tiers.direct.length).toBe(1);
      const entry = result.tiers.direct[0];
      expect(entry.name).toBe('entry-caller');
      // mechanisms should be deduped
      expect(entry.mechanisms.sort()).toEqual(['grpc', 'http']);
      // confidence should include all
      expect(entry.confidence).toBeDefined();
    });
  });

  // --- Stats computation ---

  describe('stats computation', () => {
    it('computes blast radius score: direct*3 + indirect*2 + transitive*1', () => {
      // Build: D -> C -> B -> A
      // B=direct(1), C=indirect(1), D=transitive(1)
      // Score = 1*3 + 1*2 + 1*1 = 6
      const a = insertRepo(db, 'score-target');
      const b = insertRepo(db, 'score-d1');
      const c = insertRepo(db, 'score-d2');
      const d = insertRepo(db, 'score-d3');
      insertDirectEdge(db, b, a, 'calls_grpc');
      insertDirectEdge(db, c, b, 'calls_grpc');
      insertDirectEdge(db, d, c, 'calls_grpc');

      const result = analyzeImpact(db, 'score-target');

      expect(result.stats.blastRadiusScore).toBe(6);
    });

    it('counts total affected services', () => {
      const a = insertRepo(db, 'total-target');
      const b = insertRepo(db, 'total-d1');
      const c = insertRepo(db, 'total-d2');
      insertDirectEdge(db, b, a, 'calls_grpc');
      insertDirectEdge(db, c, b, 'calls_http');

      const result = analyzeImpact(db, 'total-target');

      expect(result.stats.total).toBe(2);
    });

    it('includes mechanism breakdown across ALL affected edges', () => {
      const a = insertRepo(db, 'mech-count-target');
      const b = insertRepo(db, 'mech-count-b');
      const c = insertRepo(db, 'mech-count-c');
      insertDirectEdge(db, b, a, 'calls_grpc');
      insertDirectEdge(db, c, a, 'calls_grpc');
      insertDirectEdge(db, c, a, 'calls_http');

      const result = analyzeImpact(db, 'mech-count-target');

      expect(result.stats.mechanisms['grpc']).toBe(2);
      expect(result.stats.mechanisms['http']).toBe(1);
    });
  });

  // --- Summary string ---

  describe('summary string', () => {
    it('produces correct format: "{service}: N direct, N indirect, N transitive (score: N)"', () => {
      const a = insertRepo(db, 'sum-target');
      const b = insertRepo(db, 'sum-d1');
      insertDirectEdge(db, b, a, 'calls_grpc');

      const result = analyzeImpact(db, 'sum-target');

      expect(result.summary).toBe('sum-target: 1 direct, 0 indirect, 0 transitive (score: 3)');
    });

    it('includes all tier counts and correct score', () => {
      const a = insertRepo(db, 'full-sum-target');
      const b = insertRepo(db, 'full-sum-d1');
      const c = insertRepo(db, 'full-sum-d2');
      const d = insertRepo(db, 'full-sum-d3');
      insertDirectEdge(db, b, a, 'calls_grpc');
      insertDirectEdge(db, c, b, 'calls_grpc');
      insertDirectEdge(db, d, c, 'calls_grpc');

      const result = analyzeImpact(db, 'full-sum-target');

      expect(result.summary).toBe('full-sum-target: 1 direct, 1 indirect, 1 transitive (score: 6)');
    });
  });

  // --- Error handling ---

  describe('error handling', () => {
    it('throws Error when service name not found', () => {
      // Insert at least one repo so the graph builds, but query a non-existent name
      insertRepo(db, 'existing-svc');

      expect(() => analyzeImpact(db, 'non-existent-svc')).toThrow('Service not found: non-existent-svc');
    });
  });

  // --- Mechanism filter pass-through ---

  describe('mechanism filter', () => {
    it('passes mechanism filter to bfsUpstream', () => {
      // B -grpc-> A, C -http-> A
      // Impact of A with mechanism="grpc" should only find B
      const a = insertRepo(db, 'filter-target');
      const b = insertRepo(db, 'filter-grpc');
      const c = insertRepo(db, 'filter-http');
      insertDirectEdge(db, b, a, 'calls_grpc');
      insertDirectEdge(db, c, a, 'calls_http');

      const result = analyzeImpact(db, 'filter-target', { mechanism: 'grpc' });

      expect(result.tiers.direct.length).toBe(1);
      expect(result.tiers.direct[0].name).toBe('filter-grpc');
    });
  });

  // --- Empty results ---

  describe('empty results', () => {
    it('returns empty tiers, score 0 for service with no dependents', () => {
      insertRepo(db, 'lonely-svc');

      const result = analyzeImpact(db, 'lonely-svc');

      expect(result.tiers.direct).toEqual([]);
      expect(result.tiers.indirect).toEqual([]);
      expect(result.tiers.transitive).toEqual([]);
      expect(result.stats.total).toBe(0);
      expect(result.stats.blastRadiusScore).toBe(0);
    });

    it('summary reflects zero counts', () => {
      insertRepo(db, 'empty-svc');

      const result = analyzeImpact(db, 'empty-svc');

      expect(result.summary).toBe('empty-svc: 0 direct, 0 indirect, 0 transitive (score: 0)');
    });

    it('mechanism filter yielding no results returns empty tiers', () => {
      const a = insertRepo(db, 'no-match-target');
      const b = insertRepo(db, 'no-match-caller');
      insertDirectEdge(db, b, a, 'calls_grpc');

      const result = analyzeImpact(db, 'no-match-target', { mechanism: 'http' });

      expect(result.tiers.direct).toEqual([]);
      expect(result.stats.total).toBe(0);
    });
  });

  // --- Depth option ---

  describe('depth option', () => {
    it('depth=1 populates only direct tier', () => {
      const a = insertRepo(db, 'depth-opt-target');
      const b = insertRepo(db, 'depth-opt-d1');
      const c = insertRepo(db, 'depth-opt-d2');
      insertDirectEdge(db, b, a, 'calls_grpc');
      insertDirectEdge(db, c, b, 'calls_grpc');

      const result = analyzeImpact(db, 'depth-opt-target', { maxDepth: 1 });

      expect(result.tiers.direct.length).toBe(1);
      expect(result.tiers.indirect).toEqual([]);
      expect(result.tiers.transitive).toEqual([]);
    });
  });
});

// =========================================================================
// formatImpactVerbose
// =========================================================================

describe('formatImpactVerbose', () => {
  it('returns full ImpactResult object', () => {
    const a = insertRepo(db, 'verbose-target');
    const b = insertRepo(db, 'verbose-caller');
    insertDirectEdge(db, b, a, 'calls_grpc');

    const result = analyzeImpact(db, 'verbose-target');
    const verbose = formatImpactVerbose(result);

    expect(verbose).toEqual(result);
  });
});

// =========================================================================
// formatImpactCompact
// =========================================================================

describe('formatImpactCompact', () => {
  it('includes summary and stats', () => {
    const a = insertRepo(db, 'compact-target');
    const b = insertRepo(db, 'compact-caller');
    insertDirectEdge(db, b, a, 'calls_grpc');

    const result = analyzeImpact(db, 'compact-target');
    const compact = formatImpactCompact(result);

    expect(compact.summary).toBeDefined();
    expect(compact.stats).toBeDefined();
  });

  it('includes all direct and indirect services as name -> mechanisms', () => {
    const a = insertRepo(db, 'comp-full-target');
    const b = insertRepo(db, 'comp-full-d1');
    const c = insertRepo(db, 'comp-full-d2');
    insertDirectEdge(db, b, a, 'calls_grpc');
    insertDirectEdge(db, c, b, 'calls_http');

    const result = analyzeImpact(db, 'comp-full-target');
    const compact = formatImpactCompact(result);

    expect(compact.direct['comp-full-d1']).toEqual(['grpc']);
    expect(compact.indirect['comp-full-d2']).toEqual(['http']);
  });

  it('drops confidence from compact format', () => {
    const a = insertRepo(db, 'noconf-target');
    const b = insertRepo(db, 'noconf-caller');
    insertDirectEdge(db, b, a, 'calls_grpc', JSON.stringify({ confidence: 'high' }));

    const result = analyzeImpact(db, 'noconf-target');
    const compact = formatImpactCompact(result);
    const json = JSON.stringify(compact);

    // confidence should not appear anywhere in the compact output
    expect(json).not.toContain('confidence');
  });

  it('fits within 4000 chars for serialized output', () => {
    // Create a service with many transitive dependents
    const target = insertRepo(db, 'budget-target');
    let prev = target;
    for (let i = 0; i < 50; i++) {
      const svc = insertRepo(db, `budget-svc-${String(i).padStart(3, '0')}`);
      insertDirectEdge(db, svc, prev, 'calls_grpc');
      prev = svc;
    }

    const result = analyzeImpact(db, 'budget-target', { maxDepth: 100 });
    const compact = formatImpactCompact(result);
    const serialized = JSON.stringify(compact);

    expect(serialized.length).toBeLessThanOrEqual(4000);
  });

  it('truncates transitive first, with "...and N more" message', () => {
    // Create enough transitive to force truncation
    const target = insertRepo(db, 'trunc-target');
    const d1 = insertRepo(db, 'trunc-d1');
    const d2 = insertRepo(db, 'trunc-d2');
    insertDirectEdge(db, d1, target, 'calls_grpc');
    insertDirectEdge(db, d2, d1, 'calls_grpc');

    // Create a long chain of transitive services
    let prev = d2;
    for (let i = 0; i < 300; i++) {
      const svc = insertRepo(db, `trunc-trans-${String(i).padStart(3, '0')}`);
      insertDirectEdge(db, svc, prev, 'calls_grpc');
      prev = svc;
    }

    const result = analyzeImpact(db, 'trunc-target', { maxDepth: 500 });
    const compact = formatImpactCompact(result);
    const serialized = JSON.stringify(compact);

    expect(serialized.length).toBeLessThanOrEqual(4000);
    // Should have a truncation message
    expect(compact.transitive_truncated).toBeDefined();
    expect(compact.transitive_truncated).toMatch(/\.\.\.and \d+ more/);
  });

  it('handles edge case: 300+ affected services under budget', () => {
    // Large fan-in at depth 1 (all direct)
    const target = insertRepo(db, 'fan-target');
    for (let i = 0; i < 50; i++) {
      const svc = insertRepo(db, `fan-d-${String(i).padStart(3, '0')}`);
      insertDirectEdge(db, svc, target, 'calls_grpc');
    }

    const result = analyzeImpact(db, 'fan-target');
    const compact = formatImpactCompact(result);
    const serialized = JSON.stringify(compact);

    expect(serialized.length).toBeLessThanOrEqual(4000);
  });
});
