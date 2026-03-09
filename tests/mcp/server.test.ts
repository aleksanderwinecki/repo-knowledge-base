import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { openDatabase, closeDatabase } from '../../src/db/database.js';

// Mock git and pipeline to avoid side effects during server creation
vi.mock('../../src/indexer/git.js', () => ({
  getCurrentCommit: vi.fn(() => 'mock-commit'),
}));
vi.mock('../../src/indexer/pipeline.js', () => ({
  indexSingleRepo: vi.fn(() => ({ modules: 0, protos: 0, events: 0 })),
  indexAllRepos: vi.fn(async () => []),
}));

import { createServer } from '../../src/mcp/server.js';

let db: Database.Database;
let dbPath: string;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-server-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('MCP server', () => {
  it('can be instantiated with createServer factory', () => {
    const server = createServer(db);
    expect(server).toBeDefined();
  });

  it('has all 10 tools registered', () => {
    const server = createServer(db);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;

    const expectedTools = [
      'kb_search',
      'kb_entity',
      'kb_deps',
      'kb_learn',
      'kb_forget',
      'kb_status',
      'kb_cleanup',
      'kb_list_types',
      'kb_semantic',
      'kb_reindex',
    ];

    for (const name of expectedTools) {
      expect(tools[name], `Tool ${name} should be registered`).toBeDefined();
    }

    expect(Object.keys(tools)).toHaveLength(10);
  });

  it('server has name=kb and version=1.0.0', () => {
    const server = createServer(db);
    // McpServer stores config internally
    const serverInner = (server as unknown as { server: { _serverInfo: { name: string; version: string } } }).server;
    expect(serverInner._serverInfo.name).toBe('kb');
    expect(serverInner._serverInfo.version).toBe('1.0.0');
  });
});
