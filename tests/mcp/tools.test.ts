import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { openDatabase, closeDatabase } from '../../src/db/database.js';

// Mock git and pipeline modules to avoid needing real git repos
vi.mock('../../src/indexer/git.js', () => ({
  getCurrentCommit: vi.fn(),
}));
vi.mock('../../src/indexer/pipeline.js', () => ({
  indexSingleRepo: vi.fn(() => ({ modules: 0, protos: 0, events: 0 })),
}));

import { registerSearchTool } from '../../src/mcp/tools/search.js';
import { registerEntityTool } from '../../src/mcp/tools/entity.js';
import { registerDepsTool } from '../../src/mcp/tools/deps.js';
import { registerLearnTool } from '../../src/mcp/tools/learn.js';
import { registerForgetTool } from '../../src/mcp/tools/forget.js';
import { registerStatusTool } from '../../src/mcp/tools/status.js';
import { registerCleanupTool } from '../../src/mcp/tools/cleanup.js';
import { registerListTypesTool } from '../../src/mcp/tools/list-types.js';
import { getCurrentCommit } from '../../src/indexer/git.js';
import { tokenizeForFts } from '../../src/db/tokenizer.js';

const mockedGetCurrentCommit = vi.mocked(getCurrentCommit);

let db: Database.Database;
let dbPath: string;
let tmpDir: string;
let server: McpServer;

/** Helper to call a registered tool handler directly */
async function callTool(toolName: string, args: Record<string, unknown> = {}) {
  const tool = (server as unknown as { _registeredTools: Record<string, { handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> }> })._registeredTools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not registered`);
  return tool.handler(args, {});
}

/** Parse the JSON text from a tool response */
function parseResponse(result: unknown): Record<string, unknown> {
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  return JSON.parse(r.content[0].text);
}

/** Insert a test repo row */
function insertRepo(name: string, repoPath: string, lastCommit: string | null): number {
  const result = db.prepare(
    'INSERT INTO repos (name, path, last_indexed_commit) VALUES (?, ?, ?)',
  ).run(name, repoPath, lastCommit);
  return Number(result.lastInsertRowid);
}

/** Insert a module for FTS/entity testing */
function insertModule(repoId: number, name: string, summary: string | null, subType?: string): number {
  const result = db.prepare(
    'INSERT INTO modules (repo_id, name, summary) VALUES (?, ?, ?)',
  ).run(repoId, name, summary);
  const id = Number(result.lastInsertRowid);
  // Also index in FTS (tokenize to match how searchText queries FTS)
  const tokenizedName = tokenizeForFts(name);
  const tokenizedSummary = summary ? tokenizeForFts(summary) : tokenizedName;
  const compositeType = subType ? `module:${subType}` : 'module:module';
  db.prepare(
    'INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)',
  ).run(tokenizedName, tokenizedSummary, compositeType, id);
  return id;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-tools-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
  server = new McpServer({ name: 'kb-test', version: '1.0.0' });

  // Register all tools
  registerSearchTool(server, db);
  registerEntityTool(server, db);
  registerDepsTool(server, db);
  registerLearnTool(server, db);
  registerForgetTool(server, db);
  registerStatusTool(server, db);
  registerCleanupTool(server, db);
  registerListTypesTool(server, db);

  vi.clearAllMocks();
  // Default: all repos have current commit (not stale)
  mockedGetCurrentCommit.mockReturnValue('current-commit');
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('kb_search', () => {
  it('returns formatted JSON with summary, data array, total, truncated fields', async () => {
    const repoId = insertRepo('test-repo', tmpDir, 'current-commit');
    insertModule(repoId, 'AuthModule', 'Authentication module for user login');

    const result = await callTool('kb_search', { query: 'AuthModule' });
    const parsed = parseResponse(result);

    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('data');
    expect(parsed).toHaveProperty('total');
    expect(parsed).toHaveProperty('truncated');
    expect(Array.isArray(parsed.data)).toBe(true);
  });

  it('calls checkAndSyncRepos with result repo names', async () => {
    const repoId = insertRepo('sync-repo', tmpDir, 'old-commit');
    insertModule(repoId, 'SyncTarget', 'Module in repo needing sync');

    // Make repo stale so sync would trigger
    mockedGetCurrentCommit.mockReturnValue('new-commit');

    const result = await callTool('kb_search', { query: 'SyncTarget' });
    const parsed = parseResponse(result);

    // Search should find the module
    expect(parsed.total).toBeGreaterThan(0);
    // getCurrentCommit should have been called to check staleness
    expect(mockedGetCurrentCommit).toHaveBeenCalled();
  });

  it('error returns isError=true with message', async () => {
    // Close the database to trigger an error
    closeDatabase(db);

    const result = await callTool('kb_search', { query: 'anything' });
    const r = result as { content: Array<{ text: string }>; isError?: boolean };

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error');
  });
});

describe('kb_entity', () => {
  it('returns entity cards for valid name', async () => {
    const repoId = insertRepo('entity-repo', tmpDir, 'current-commit');
    insertModule(repoId, 'UserService', 'Handles user management');

    const result = await callTool('kb_entity', { name: 'UserService' });
    const parsed = parseResponse(result);

    expect(parsed.total).toBeGreaterThan(0);
    expect(Array.isArray(parsed.data)).toBe(true);
  });

  it('returns empty data array for unknown entity', async () => {
    const result = await callTool('kb_entity', { name: 'NonExistentEntity' });
    const parsed = parseResponse(result);

    expect(parsed.total).toBe(0);
    expect(parsed.data).toEqual([]);
  });
});

describe('kb_deps', () => {
  it('returns dependency result for valid name', async () => {
    const repoId = insertRepo('deps-repo', tmpDir, 'current-commit');

    const result = await callTool('kb_deps', { name: 'deps-repo' });
    const parsed = parseResponse(result);

    // Even with no deps, should return structured response
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('data');
  });

  it('returns null-data response for unknown entity', async () => {
    const result = await callTool('kb_deps', { name: 'unknown-service' });
    const parsed = parseResponse(result);

    expect(parsed.summary).toContain('No dependencies');
    expect(parsed.total).toBe(0);
  });
});

describe('kb_learn', () => {
  it('stores fact and returns it with id', async () => {
    const result = await callTool('kb_learn', { content: 'The auth service uses JWT tokens' });
    const parsed = parseResponse(result);

    expect(parsed.summary).toContain('Learned');
    expect(parsed.data).toHaveProperty('id');
    expect((parsed.data as Record<string, unknown>).content).toBe('The auth service uses JWT tokens');
  });

  it('stores fact with repo association', async () => {
    const result = await callTool('kb_learn', {
      content: 'Uses PostgreSQL 15',
      repo: 'my-service',
    });
    const parsed = parseResponse(result);

    expect((parsed.data as Record<string, unknown>).repo).toBe('my-service');
  });
});

describe('kb_forget', () => {
  it('returns deleted=true for existing fact', async () => {
    // Learn a fact first
    const learnResult = await callTool('kb_learn', { content: 'Temporary fact' });
    const learnParsed = parseResponse(learnResult);
    const factId = (learnParsed.data as Record<string, unknown>).id as number;

    const result = await callTool('kb_forget', { id: factId });
    const parsed = parseResponse(result);

    expect(parsed.summary).toContain(`Forgot fact ${factId}`);
    expect((parsed.data as Record<string, unknown>).deleted).toBe(true);
  });

  it('returns deleted=false for non-existent id', async () => {
    const result = await callTool('kb_forget', { id: 99999 });
    const parsed = parseResponse(result);

    expect(parsed.summary).toContain('not found');
    expect((parsed.data as Record<string, unknown>).deleted).toBe(false);
  });
});

describe('kb_status', () => {
  it('returns repo/module/event/fact counts', async () => {
    insertRepo('status-repo', tmpDir, 'current-commit');

    const result = await callTool('kb_status');
    const parsed = parseResponse(result);

    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('data');
    const data = parsed.data as Record<string, unknown>;
    const counts = data.counts as Record<string, number>;
    expect(counts).toHaveProperty('repos');
    expect(counts).toHaveProperty('modules');
    expect(counts).toHaveProperty('events');
    expect(counts).toHaveProperty('learned_facts');
    expect(counts.repos).toBe(1);
  });
});

describe('kb_cleanup', () => {
  it('dry run detects deleted repos without pruning', async () => {
    // Insert a repo with a non-existent path
    insertRepo('gone-repo', '/nonexistent/path/to/repo', 'abc123');

    const result = await callTool('kb_cleanup', {});
    const parsed = parseResponse(result);

    expect(parsed.summary).toContain('1 deleted repos');
    expect(parsed.summary).toContain('dry run');
    const data = parsed.data as Record<string, unknown>;
    expect(data.pruned).toBe(false);
    expect((data.deletedRepos as string[])).toContain('gone-repo');
  });

  it('prune=true actually removes deleted repo data', async () => {
    insertRepo('gone-repo', '/nonexistent/path/to/repo', 'abc123');

    const result = await callTool('kb_cleanup', { prune: true });
    const parsed = parseResponse(result);

    expect(parsed.summary).toContain('pruned');
    expect((parsed.data as Record<string, unknown>).pruned).toBe(true);

    // Verify repo is actually gone from DB
    const row = db.prepare('SELECT COUNT(*) as c FROM repos WHERE name = ?').get('gone-repo') as { c: number };
    expect(row.c).toBe(0);
  });
});

describe('kb_search with type filter', () => {
  it('filters results by sub-type', async () => {
    const repoId = insertRepo('type-repo', tmpDir, 'current-commit');
    insertModule(repoId, 'UserSchema', 'Ecto schema for users', 'schema');
    insertModule(repoId, 'UserContext', 'Context module for users', 'context');

    const result = await callTool('kb_search', { query: 'User', type: 'schema' });
    const parsed = parseResponse(result);

    expect(parsed.total).toBeGreaterThan(0);
    const data = parsed.data as Array<Record<string, unknown>>;
    // All results should be schema sub-type
    for (const item of data) {
      expect(item.subType).toBe('schema');
    }
  });

  it('filters results by coarse type', async () => {
    const repoId = insertRepo('coarse-repo', tmpDir, 'current-commit');
    insertModule(repoId, 'CoarseModule', 'Test coarse filtering', 'schema');

    const result = await callTool('kb_search', { query: 'CoarseModule', type: 'module' });
    const parsed = parseResponse(result);

    expect(parsed.total).toBeGreaterThan(0);
    const data = parsed.data as Array<Record<string, unknown>>;
    expect(data[0].entityType).toBe('module');
  });
});

describe('kb_list_types', () => {
  it('returns grouped type structure with counts', async () => {
    const repoId = insertRepo('list-types-repo', tmpDir, 'current-commit');
    insertModule(repoId, 'SchemaOne', 'First schema', 'schema');
    insertModule(repoId, 'SchemaTwo', 'Second schema', 'schema');
    insertModule(repoId, 'ContextOne', 'A context module', 'context');

    const result = await callTool('kb_list_types');
    const r = result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(r.content[0].text);

    expect(parsed).toHaveProperty('module');
    expect(Array.isArray(parsed.module)).toBe(true);

    const schemaEntry = parsed.module.find((e: { subType: string }) => e.subType === 'schema');
    expect(schemaEntry).toBeDefined();
    expect(schemaEntry.count).toBe(2);

    const contextEntry = parsed.module.find((e: { subType: string }) => e.subType === 'context');
    expect(contextEntry).toBeDefined();
    expect(contextEntry.count).toBe(1);
  });

  it('returns empty object for empty database', async () => {
    const result = await callTool('kb_list_types');
    const r = result as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(r.content[0].text);

    expect(parsed).toEqual({});
  });
});

describe('all tools', () => {
  it('all tool responses are valid JSON under 4000 characters', async () => {
    const repoId = insertRepo('all-test-repo', tmpDir, 'current-commit');
    insertModule(repoId, 'TestModule', 'Test module for size verification');

    const tools = [
      { name: 'kb_search', args: { query: 'TestModule' } },
      { name: 'kb_entity', args: { name: 'TestModule' } },
      { name: 'kb_deps', args: { name: 'all-test-repo' } },
      { name: 'kb_learn', args: { content: 'Size test fact' } },
      { name: 'kb_forget', args: { id: 99999 } },
      { name: 'kb_status', args: {} },
      { name: 'kb_cleanup', args: {} },
      { name: 'kb_list_types', args: {} },
    ];

    for (const { name, args } of tools) {
      const result = await callTool(name, args);
      const r = result as { content: Array<{ type: string; text: string }> };
      const text = r.content[0].text;

      // Must be valid JSON
      expect(() => JSON.parse(text), `${name} should return valid JSON`).not.toThrow();
      // Must be under 4KB
      expect(text.length, `${name} response should be under 4000 chars`).toBeLessThanOrEqual(4000);
    }
  });
});
