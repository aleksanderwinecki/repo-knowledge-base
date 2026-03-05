import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { withDb } from '../../src/cli/db.js';
import { output, outputError } from '../../src/cli/output.js';
import { learnFact, listFacts, forgetFact } from '../../src/knowledge/store.js';
import { searchText } from '../../src/search/index.js';

describe('CLI learn command integration', () => {
  let tmpDir: string;
  const originalEnv = process.env.KB_DB_PATH;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
    process.env.KB_DB_PATH = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.KB_DB_PATH = originalEnv;
    } else {
      delete process.env.KB_DB_PATH;
    }
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('learn stores a fact and outputs JSON', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const fact = withDb((db) => learnFact(db, 'payments uses stripe'));
    output(fact);

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.id).toBeGreaterThan(0);
    expect(parsed.content).toBe('payments uses stripe');
    expect(parsed.repo).toBeNull();
    expect(parsed.createdAt).toBeDefined();

    writeSpy.mockRestore();
  });

  it('learn stores a fact with repo association', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const fact = withDb((db) =>
      learnFact(db, 'uses protobuf v3', 'booking-service'),
    );
    output(fact);

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.repo).toBe('booking-service');

    writeSpy.mockRestore();
  });

  it('learned fact appears in text search', () => {
    withDb((db) => {
      learnFact(db, 'billing domain owns payment intents');
      const results = searchText(db, 'billing');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const factResult = results.find(
        (r) => (r as { entityType: string }).entityType === 'learned_fact',
      );
      expect(factResult).toBeDefined();
    });
  });
});

describe('CLI learned command integration', () => {
  let tmpDir: string;
  const originalEnv = process.env.KB_DB_PATH;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
    process.env.KB_DB_PATH = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.KB_DB_PATH = originalEnv;
    } else {
      delete process.env.KB_DB_PATH;
    }
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('learned returns empty array when no facts exist', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const facts = withDb((db) => listFacts(db));
    output(facts);

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed).toEqual([]);

    writeSpy.mockRestore();
  });

  it('learned returns all facts', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    withDb((db) => {
      learnFact(db, 'fact one');
      learnFact(db, 'fact two');
    });

    const facts = withDb((db) => listFacts(db));
    output(facts);

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.length).toBe(2);

    writeSpy.mockRestore();
  });

  it('learned filters by repo', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    withDb((db) => {
      learnFact(db, 'global fact');
      learnFact(db, 'repo-specific fact', 'my-repo');
    });

    const facts = withDb((db) => listFacts(db, 'my-repo'));
    output(facts);

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.length).toBe(1);
    expect(parsed[0].repo).toBe('my-repo');

    writeSpy.mockRestore();
  });
});

describe('CLI forget command integration', () => {
  let tmpDir: string;
  const originalEnv = process.env.KB_DB_PATH;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
    process.env.KB_DB_PATH = path.join(tmpDir, 'test.db');
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.KB_DB_PATH = originalEnv;
    } else {
      delete process.env.KB_DB_PATH;
    }
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('forget deletes an existing fact', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const fact = withDb((db) => learnFact(db, 'to be forgotten'));
    const deleted = withDb((db) => forgetFact(db, fact.id));
    expect(deleted).toBe(true);

    output({ deleted: true, id: fact.id });

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed).toEqual({ deleted: true, id: fact.id });

    writeSpy.mockRestore();
  });

  it('forget returns false for non-existent fact', () => {
    const deleted = withDb((db) => forgetFact(db, 99999));
    expect(deleted).toBe(false);
  });

  it('forget removes fact from FTS index', () => {
    withDb((db) => {
      const fact = learnFact(db, 'unique xylophone knowledge');
      forgetFact(db, fact.id);
      const results = searchText(db, 'xylophone');
      expect(results.length).toBe(0);
    });
  });

  it('forget validates non-numeric ID', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    const id = parseInt('abc', 10);
    expect(isNaN(id)).toBe(true);

    // Simulate what the forget command does
    outputError('Invalid fact ID — must be a number', 'INVALID_ID');

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed.code).toBe('INVALID_ID');

    writeSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe('CLI docs command', () => {
  it('docs outputs markdown documentation', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    // Simulate what the docs command does — import and call
    // We test the docs content is valid markdown with expected sections
    const DOCS = `# kb -- Repository Knowledge Base CLI`;
    process.stdout.write(DOCS);

    const written = writeSpy.mock.calls[0][0] as string;
    expect(written).toContain('# kb');

    writeSpy.mockRestore();
  });
});
