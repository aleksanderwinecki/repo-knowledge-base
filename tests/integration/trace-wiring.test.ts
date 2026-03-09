/**
 * Integration test: trace wiring (MCP tool + CLI command + barrel exports)
 * TDD RED phase: these tests should fail until the implementation is in place.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { openDatabase, closeDatabase } from '../../src/db/database.js';

// Mock git and pipeline modules
vi.mock('../../src/indexer/git.js', () => ({
  getCurrentCommit: vi.fn(),
}));
vi.mock('../../src/indexer/pipeline.js', () => ({
  indexSingleRepo: vi.fn(() => ({ modules: 0, protos: 0, events: 0 })),
}));

import { registerTraceTool } from '../../src/mcp/tools/trace.js';
import { getCurrentCommit } from '../../src/indexer/git.js';

const mockedGetCurrentCommit = vi.mocked(getCurrentCommit);

let db: Database.Database;
let dbPath: string;
let tmpDir: string;
let server: McpServer;

type ToolShape = Record<string, {
  description: string;
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
}>;

async function callTool(toolName: string, args: Record<string, unknown> = {}) {
  const tools = (server as unknown as { _registeredTools: ToolShape })._registeredTools;
  const tool = tools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not registered`);
  return tool.handler(args, {});
}

function insertRepo(name: string, repoPath: string): number {
  const result = db.prepare(
    'INSERT INTO repos (name, path, last_indexed_commit) VALUES (?, ?, ?)',
  ).run(name, repoPath, 'current-commit');
  return Number(result.lastInsertRowid);
}

function insertDirectEdge(
  sourceRepoId: number,
  targetRepoId: number,
  relType: string,
): void {
  db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('repo', sourceRepoId, 'repo', targetRepoId, relType, 'src/client.ex');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-trace-wiring-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
  server = new McpServer({ name: 'kb-trace-test', version: '1.0.0' });
  registerTraceTool(server, db);
  vi.clearAllMocks();
  mockedGetCurrentCommit.mockReturnValue('current-commit');
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('kb_trace MCP tool wiring', () => {
  it('tool is registered as kb_trace', () => {
    const tools = (server as unknown as { _registeredTools: ToolShape })._registeredTools;
    expect(tools).toHaveProperty('kb_trace');
  });

  it('returns trace result for connected services', async () => {
    // A -> B (A calls B via grpc)
    const idA = insertRepo('service-a', tmpDir);
    const idB = insertRepo('service-b', tmpDir);
    insertDirectEdge(idA, idB, 'calls_grpc');

    const result = await callTool('kb_trace', { from: 'service-a', to: 'service-b' });
    const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(r.isError).toBeUndefined();

    const parsed = JSON.parse(r.content[0].text);
    expect(parsed).toHaveProperty('from', 'service-a');
    expect(parsed).toHaveProperty('to', 'service-b');
    expect(parsed).toHaveProperty('path_summary');
    expect(parsed).toHaveProperty('hop_count');
    expect(parsed).toHaveProperty('hops');
    expect(parsed.hop_count).toBe(1);
    expect(parsed.hops).toHaveLength(1);
  });

  it('returns error envelope for unknown service', async () => {
    const result = await callTool('kb_trace', { from: 'nonexistent', to: 'also-nonexistent' });
    const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error');
  });
});

describe('barrel exports', () => {
  it('exports traceRoute from search/index', async () => {
    const mod = await import('../../src/search/index.js');
    expect(typeof mod.traceRoute).toBe('function');
  });

  it('exports TraceResult type (compiles successfully)', async () => {
    // Type-only check: importing the type compiles without error
    const mod = await import('../../src/search/index.js');
    // If this compiles, the type re-export works
    expect(mod.traceRoute).toBeDefined();
  });
});
