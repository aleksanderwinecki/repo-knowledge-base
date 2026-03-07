/**
 * MCP tool contract tests.
 *
 * These tests pin the public surface of every MCP tool — parameter names,
 * types, optionality, and response shapes.  If a refactor renames a param,
 * drops a response key, or changes optionality, the corresponding contract
 * test goes red.  That's the whole point.
 */

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

// ── Typed access to internal MCP tool registry ──────────────────────
type ToolShape = Record<string, {
  description: string;
  inputSchema: {
    def: {
      shape: Record<string, {
        def: { type: string };
        type: string;
      }>;
    };
  };
  handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown>;
}>;

let db: Database.Database;
let dbPath: string;
let tmpDir: string;
let server: McpServer;
let tools: ToolShape;

/** Helper to call a registered tool handler directly */
async function callTool(toolName: string, args: Record<string, unknown> = {}) {
  const tool = tools[toolName];
  if (!tool) throw new Error(`Tool ${toolName} not registered`);
  return tool.handler(args, {});
}

/** Parse JSON text from a standard MCP tool response */
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
  const tokenizedName = tokenizeForFts(name);
  const tokenizedSummary = summary ? tokenizeForFts(summary) : tokenizedName;
  const compositeType = subType ? `module:${subType}` : 'module:module';
  db.prepare(
    'INSERT INTO knowledge_fts (name, description, entity_type, entity_id) VALUES (?, ?, ?, ?)',
  ).run(tokenizedName, tokenizedSummary, compositeType, id);
  return id;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-contracts-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
  server = new McpServer({ name: 'kb-contract-test', version: '1.0.0' });

  // Register all 8 tools
  registerSearchTool(server, db);
  registerEntityTool(server, db);
  registerDepsTool(server, db);
  registerLearnTool(server, db);
  registerForgetTool(server, db);
  registerStatusTool(server, db);
  registerCleanupTool(server, db);
  registerListTypesTool(server, db);

  // Expose internal tool registry
  tools = (server as unknown as { _registeredTools: ToolShape })._registeredTools;

  vi.clearAllMocks();
  mockedGetCurrentCommit.mockReturnValue('current-commit');
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════
// INPUT SCHEMA CONTRACTS
// ═══════════════════════════════════════════════════════════════════════

describe('input schema contracts', () => {
  function getParamNames(toolName: string): string[] {
    return Object.keys(tools[toolName].inputSchema.def.shape);
  }

  function getParamType(toolName: string, param: string): string {
    return tools[toolName].inputSchema.def.shape[param].type;
  }

  it('kb_search: query (required), limit (optional), repo (optional), type (optional)', () => {
    const params = getParamNames('kb_search');
    expect(params).toEqual(['query', 'limit', 'repo', 'type']);
    expect(params).toHaveLength(4);

    expect(getParamType('kb_search', 'query')).toBe('string');
    expect(getParamType('kb_search', 'limit')).toBe('optional');
    expect(getParamType('kb_search', 'repo')).toBe('optional');
    expect(getParamType('kb_search', 'type')).toBe('optional');
  });

  it('kb_entity: name (required), type (optional), repo (optional)', () => {
    const params = getParamNames('kb_entity');
    expect(params).toEqual(['name', 'type', 'repo']);
    expect(params).toHaveLength(3);

    expect(getParamType('kb_entity', 'name')).toBe('string');
    expect(getParamType('kb_entity', 'type')).toBe('optional');
    expect(getParamType('kb_entity', 'repo')).toBe('optional');
  });

  it('kb_deps: name (required), direction (optional), depth (optional), repo (optional)', () => {
    const params = getParamNames('kb_deps');
    expect(params).toEqual(['name', 'direction', 'depth', 'repo']);
    expect(params).toHaveLength(4);

    expect(getParamType('kb_deps', 'name')).toBe('string');
    expect(getParamType('kb_deps', 'direction')).toBe('optional');
    expect(getParamType('kb_deps', 'depth')).toBe('optional');
    expect(getParamType('kb_deps', 'repo')).toBe('optional');
  });

  it('kb_learn: content (required), repo (optional)', () => {
    const params = getParamNames('kb_learn');
    expect(params).toEqual(['content', 'repo']);
    expect(params).toHaveLength(2);

    expect(getParamType('kb_learn', 'content')).toBe('string');
    expect(getParamType('kb_learn', 'repo')).toBe('optional');
  });

  it('kb_forget: id (required)', () => {
    const params = getParamNames('kb_forget');
    expect(params).toEqual(['id']);
    expect(params).toHaveLength(1);

    expect(getParamType('kb_forget', 'id')).toBe('number');
  });

  it('kb_status: no params (empty shape)', () => {
    const params = getParamNames('kb_status');
    expect(params).toHaveLength(0);
  });

  it('kb_cleanup: prune (optional), max_fact_age_days (optional)', () => {
    const params = getParamNames('kb_cleanup');
    expect(params).toEqual(['prune', 'max_fact_age_days']);
    expect(params).toHaveLength(2);

    expect(getParamType('kb_cleanup', 'prune')).toBe('optional');
    expect(getParamType('kb_cleanup', 'max_fact_age_days')).toBe('optional');
  });

  it('kb_list_types: no params (empty shape)', () => {
    const params = getParamNames('kb_list_types');
    expect(params).toHaveLength(0);
  });
});
