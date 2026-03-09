/**
 * Integration test: impact wiring (MCP tool + CLI command + barrel exports)
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

import { registerImpactTool } from '../../src/mcp/tools/impact.js';
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-impact-wiring-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
  server = new McpServer({ name: 'kb-impact-test', version: '1.0.0' });
  registerImpactTool(server, db);
  vi.clearAllMocks();
  mockedGetCurrentCommit.mockReturnValue('current-commit');
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('kb_impact MCP tool wiring', () => {
  it('tool is registered as kb_impact', () => {
    const tools = (server as unknown as { _registeredTools: ToolShape })._registeredTools;
    expect(tools).toHaveProperty('kb_impact');
  });

  it('returns compact format for known service with dependents', async () => {
    // A -> B (A calls B via grpc)
    const idB = insertRepo('service-b', tmpDir);
    const idA = insertRepo('service-a', tmpDir);
    insertDirectEdge(idA, idB, 'calls_grpc');

    const result = await callTool('kb_impact', { name: 'service-b' });
    const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(r.isError).toBeUndefined();

    const parsed = JSON.parse(r.content[0].text);
    // Compact format has: summary, stats, direct, indirect, transitive
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('stats');
    expect(parsed).toHaveProperty('direct');
  });

  it('returns error envelope for unknown service', async () => {
    const result = await callTool('kb_impact', { name: 'nonexistent-service' });
    const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error');
  });
});

describe('barrel exports', () => {
  it('exports analyzeImpact from search/index', async () => {
    const mod = await import('../../src/search/index.js');
    expect(typeof mod.analyzeImpact).toBe('function');
  });

  it('exports formatImpactCompact from search/index', async () => {
    const mod = await import('../../src/search/index.js');
    expect(typeof mod.formatImpactCompact).toBe('function');
  });

  it('exports formatImpactVerbose from search/index', async () => {
    const mod = await import('../../src/search/index.js');
    expect(typeof mod.formatImpactVerbose).toBe('function');
  });
});
