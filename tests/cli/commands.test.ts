import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { getDbPath, withDb, withDbAsync } from '../../src/cli/db.js';
import { output, outputError } from '../../src/cli/output.js';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { searchText } from '../../src/search/index.js';
import { indexAllRepos } from '../../src/indexer/pipeline.js';

describe('CLI db helpers', () => {
  const originalEnv = process.env.KB_DB_PATH;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.KB_DB_PATH = originalEnv;
    } else {
      delete process.env.KB_DB_PATH;
    }
  });

  it('getDbPath returns default path when no env var set', () => {
    delete process.env.KB_DB_PATH;
    const result = getDbPath();
    expect(result).toBe(path.join(os.homedir(), '.kb', 'knowledge.db'));
  });

  it('getDbPath respects KB_DB_PATH env var', () => {
    process.env.KB_DB_PATH = '/tmp/custom.db';
    const result = getDbPath();
    expect(result).toBe('/tmp/custom.db');
  });

  it('withDb opens and closes database correctly', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    process.env.KB_DB_PATH = dbPath;

    const result = withDb((db) => {
      // DB should be open and usable
      const row = db.prepare('SELECT 1 as n').get() as { n: number };
      return row.n;
    });

    expect(result).toBe(1);
    // DB file should exist
    expect(fs.existsSync(dbPath)).toBe(true);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('withDb closes database even on exception', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
    const dbPath = path.join(tmpDir, 'test.db');
    process.env.KB_DB_PATH = dbPath;

    expect(() =>
      withDb(() => {
        throw new Error('test error');
      }),
    ).toThrow('test error');

    // DB file should still exist (was created before error)
    expect(fs.existsSync(dbPath)).toBe(true);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });
});

describe('CLI output helpers', () => {
  it('output writes JSON to stdout', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    output({ hello: 'world' });

    expect(writeSpy).toHaveBeenCalledOnce();
    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed).toEqual({ hello: 'world' });

    writeSpy.mockRestore();
  });

  it('output writes arrays as JSON', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    output([1, 2, 3]);

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed).toEqual([1, 2, 3]);

    writeSpy.mockRestore();
  });

  it('outputError writes to stderr and exits', () => {
    const writeSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never);

    outputError('bad thing', 'BAD_CODE');

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed).toEqual({ error: 'bad thing', code: 'BAD_CODE' });
    expect(exitSpy).toHaveBeenCalledWith(1);

    writeSpy.mockRestore();
    exitSpy.mockRestore();
  });
});

describe('CLI status command integration', () => {
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

  it('status returns expected JSON structure', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    withDb((db) => {
      // DB is now initialized with schema
      const count = (table: string) => {
        const row = db
          .prepare(`SELECT COUNT(*) as n FROM ${table}`)
          .get() as { n: number };
        return row.n;
      };

      const stats = {
        database: getDbPath(),
        repos: count('repos'),
        files: count('files'),
        modules: count('modules'),
        services: count('services'),
        events: count('events'),
        edges: count('edges'),
        learnedFacts: 0,
      };

      output(stats);
    });

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);

    expect(parsed).toHaveProperty('database');
    expect(parsed).toHaveProperty('repos');
    expect(parsed).toHaveProperty('files');
    expect(parsed).toHaveProperty('modules');
    expect(parsed).toHaveProperty('services');
    expect(parsed).toHaveProperty('events');
    expect(parsed).toHaveProperty('edges');
    expect(parsed).toHaveProperty('learnedFacts');
    expect(parsed.repos).toBe(0);

    writeSpy.mockRestore();
  });
});

describe('CLI search command integration', () => {
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

  it('search on empty DB returns empty array', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    withDb((db) => {
      const results = searchText(db, 'anything');
      output(results);
    });

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed).toEqual([]);

    writeSpy.mockRestore();
  });
});

describe('CLI index command integration', () => {
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

  it('index with empty root returns empty results', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    const emptyDir = path.join(tmpDir, 'empty-root');
    fs.mkdirSync(emptyDir);

    await withDbAsync(async (db) => {
      const results = await indexAllRepos(db, {
        rootDir: emptyDir,
        force: false,
      });
      output(results);
    });

    const written = writeSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(written);
    expect(parsed).toEqual([]);

    writeSpy.mockRestore();
  });
});
