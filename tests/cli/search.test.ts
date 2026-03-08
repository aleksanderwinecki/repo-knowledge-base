/**
 * CLI search command tests: --semantic flag routing and hybrid default.
 * Tests argument routing logic, not search functions themselves (those are in search/*.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';

// Mock search modules before importing anything that uses them
vi.mock('../../src/search/text.js', () => ({
  searchText: vi.fn(() => []),
}));
vi.mock('../../src/search/semantic.js', () => ({
  searchSemantic: vi.fn(async () => []),
}));
vi.mock('../../src/search/hybrid.js', () => ({
  searchHybrid: vi.fn(async () => []),
}));
vi.mock('../../src/search/entity.js', () => ({
  findEntity: vi.fn(() => []),
}));
vi.mock('../../src/db/fts.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/db/fts.js')>();
  return {
    ...actual,
    listAvailableTypes: vi.fn(() => ({})),
  };
});

import { Command } from '@commander-js/extra-typings';
import { registerSearch } from '../../src/cli/commands/search.js';
import { searchText } from '../../src/search/text.js';
import { searchSemantic } from '../../src/search/semantic.js';
import { searchHybrid } from '../../src/search/hybrid.js';
import { findEntity } from '../../src/search/entity.js';
import { listAvailableTypes } from '../../src/db/fts.js';
import { openDatabase, closeDatabase } from '../../src/db/database.js';

const mockedSearchText = vi.mocked(searchText);
const mockedSearchSemantic = vi.mocked(searchSemantic);
const mockedSearchHybrid = vi.mocked(searchHybrid);
const mockedFindEntity = vi.mocked(findEntity);
const mockedListAvailableTypes = vi.mocked(listAvailableTypes);

let tmpDir: string;
let dbPath: string;
const originalEnv = process.env.KB_DB_PATH;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-search-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  process.env.KB_DB_PATH = dbPath;

  // Ensure DB exists so withDb / withDbAsync can open it
  const db = openDatabase(dbPath);
  closeDatabase(db);

  vi.clearAllMocks();
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.KB_DB_PATH = originalEnv;
  } else {
    delete process.env.KB_DB_PATH;
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Helper: run the search command with given args */
async function runSearch(...args: string[]): Promise<string> {
  const stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

  const program = new Command();
  program.exitOverride(); // throw instead of process.exit on commander errors
  registerSearch(program);

  try {
    await program.parseAsync(['node', 'kb', 'search', ...args]);
  } catch {
    // Commander throws on exitOverride -- ignore
  }

  const written = stdoutSpy.mock.calls.map((c) => c[0]).join('');

  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  exitSpy.mockRestore();

  return written;
}

describe('CLI search --semantic', () => {
  it('calls searchSemantic when --semantic flag is provided', async () => {
    mockedSearchSemantic.mockResolvedValue([]);

    await runSearch('--semantic', 'payment services');

    expect(mockedSearchSemantic).toHaveBeenCalledOnce();
    expect(mockedSearchSemantic).toHaveBeenCalledWith(
      expect.anything(), // db
      'payment services',
      expect.objectContaining({ limit: 20 }),
    );
    // Should NOT call searchHybrid or searchText
    expect(mockedSearchHybrid).not.toHaveBeenCalled();
    expect(mockedSearchText).not.toHaveBeenCalled();
  });

  it('passes --repo filter to searchSemantic', async () => {
    mockedSearchSemantic.mockResolvedValue([]);

    await runSearch('--semantic', '--repo', 'my-service', 'query');

    expect(mockedSearchSemantic).toHaveBeenCalledWith(
      expect.anything(),
      'query',
      expect.objectContaining({ repoFilter: 'my-service' }),
    );
  });

  it('passes --limit to searchSemantic', async () => {
    mockedSearchSemantic.mockResolvedValue([]);

    await runSearch('--semantic', '--limit', '5', 'query');

    expect(mockedSearchSemantic).toHaveBeenCalledWith(
      expect.anything(),
      'query',
      expect.objectContaining({ limit: 5 }),
    );
  });

  it('outputs empty array when searchSemantic returns []', async () => {
    mockedSearchSemantic.mockResolvedValue([]);

    const written = await runSearch('--semantic', 'nothing');

    const parsed = JSON.parse(written);
    expect(parsed).toEqual([]);
  });
});

describe('CLI search default (hybrid)', () => {
  it('calls searchHybrid when no --semantic or --entity flag', async () => {
    mockedSearchHybrid.mockResolvedValue([]);

    await runSearch('some query');

    expect(mockedSearchHybrid).toHaveBeenCalledOnce();
    expect(mockedSearchHybrid).toHaveBeenCalledWith(
      expect.anything(),
      'some query',
      expect.objectContaining({ limit: 20 }),
    );
    expect(mockedSearchSemantic).not.toHaveBeenCalled();
    expect(mockedSearchText).not.toHaveBeenCalled();
  });

  it('passes --repo and --type to searchHybrid', async () => {
    mockedSearchHybrid.mockResolvedValue([]);

    await runSearch('--repo', 'foo', '--type', 'module', 'query');

    expect(mockedSearchHybrid).toHaveBeenCalledWith(
      expect.anything(),
      'query',
      expect.objectContaining({
        repoFilter: 'foo',
        entityTypeFilter: 'module',
      }),
    );
  });
});

describe('CLI search --entity (regression)', () => {
  it('still calls findEntity when --entity flag is used', async () => {
    mockedFindEntity.mockReturnValue([]);

    await runSearch('--entity', 'UserService');

    expect(mockedFindEntity).toHaveBeenCalledOnce();
    expect(mockedFindEntity).toHaveBeenCalledWith(
      expect.anything(),
      'UserService',
      expect.objectContaining({}),
    );
    // Should NOT call search functions
    expect(mockedSearchHybrid).not.toHaveBeenCalled();
    expect(mockedSearchSemantic).not.toHaveBeenCalled();
  });
});

describe('CLI search --list-types (regression)', () => {
  it('still calls listAvailableTypes when --list-types flag is used', async () => {
    mockedListAvailableTypes.mockReturnValue({});

    await runSearch('--list-types');

    expect(mockedListAvailableTypes).toHaveBeenCalledOnce();
  });
});
