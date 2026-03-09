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
import { registerImpactTool } from '../../src/mcp/tools/impact.js';
import { registerTraceTool } from '../../src/mcp/tools/trace.js';
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

/** Insert a direct edge between repos */
function insertDirectEdge(
  sourceRepoId: number,
  targetRepoId: number,
  relType: string,
): void {
  db.prepare(
    'INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, source_file) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('repo', sourceRepoId, 'repo', targetRepoId, relType, 'src/client.ex');
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

  // Register all tools
  registerSearchTool(server, db);
  registerEntityTool(server, db);
  registerDepsTool(server, db);
  registerLearnTool(server, db);
  registerForgetTool(server, db);
  registerStatusTool(server, db);
  registerCleanupTool(server, db);
  registerListTypesTool(server, db);
  registerImpactTool(server, db);
  registerTraceTool(server, db);

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

  it('kb_deps: name (required), direction (optional), depth (optional), repo (optional), mechanism (optional)', () => {
    const params = getParamNames('kb_deps');
    expect(params).toEqual(['name', 'direction', 'depth', 'repo', 'mechanism']);
    expect(params).toHaveLength(5);

    expect(getParamType('kb_deps', 'name')).toBe('string');
    expect(getParamType('kb_deps', 'direction')).toBe('optional');
    expect(getParamType('kb_deps', 'depth')).toBe('optional');
    expect(getParamType('kb_deps', 'repo')).toBe('optional');
    expect(getParamType('kb_deps', 'mechanism')).toBe('optional');
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

  it('kb_impact: name (required), mechanism (optional), depth (optional)', () => {
    const params = getParamNames('kb_impact');
    expect(params).toEqual(['name', 'mechanism', 'depth']);
    expect(params).toHaveLength(3);

    expect(getParamType('kb_impact', 'name')).toBe('string');
    expect(getParamType('kb_impact', 'mechanism')).toBe('optional');
    expect(getParamType('kb_impact', 'depth')).toBe('optional');
  });

  it('kb_trace: from (required), to (required)', () => {
    const params = getParamNames('kb_trace');
    expect(params).toEqual(['from', 'to']);
    expect(params).toHaveLength(2);

    expect(getParamType('kb_trace', 'from')).toBe('string');
    expect(getParamType('kb_trace', 'to')).toBe('string');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// OUTPUT SHAPE CONTRACTS
// ═══════════════════════════════════════════════════════════════════════

describe('output shape contracts', () => {
  // Seed minimal data so search/entity/deps have something to return
  beforeEach(() => {
    const repoId = insertRepo('contract-repo', tmpDir, 'current-commit');
    insertModule(repoId, 'ContractModule', 'Module for contract tests', 'schema');
  });

  it('kb_search: { summary (string), data (array), total (number), truncated (boolean) }', async () => {
    const result = await callTool('kb_search', { query: 'ContractModule' });
    const parsed = parseResponse(result);

    expect(Object.keys(parsed).sort()).toEqual(['data', 'summary', 'total', 'truncated']);

    expect(typeof parsed.summary).toBe('string');
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(typeof parsed.total).toBe('number');
    expect(typeof parsed.truncated).toBe('boolean');
  });

  it('kb_entity: { summary (string), data (array), total (number), truncated (boolean) }', async () => {
    const result = await callTool('kb_entity', { name: 'ContractModule' });
    const parsed = parseResponse(result);

    expect(Object.keys(parsed).sort()).toEqual(['data', 'summary', 'total', 'truncated']);

    expect(typeof parsed.summary).toBe('string');
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(typeof parsed.total).toBe('number');
    expect(typeof parsed.truncated).toBe('boolean');
  });

  it('kb_deps: { summary (string), data, total (number), truncated (boolean) }', async () => {
    // With no edges, kb_deps still returns the standard 4-key shape
    const result = await callTool('kb_deps', { name: 'contract-repo' });
    const parsed = parseResponse(result);

    expect(Object.keys(parsed).sort()).toEqual(['data', 'summary', 'total', 'truncated']);

    expect(typeof parsed.summary).toBe('string');
    expect(typeof parsed.total).toBe('number');
    expect(typeof parsed.truncated).toBe('boolean');
  });

  it('kb_learn: { summary, data: [{ id, content, repo, createdAt }], total, truncated }', async () => {
    const result = await callTool('kb_learn', { content: 'contract test fact' });
    const parsed = parseResponse(result);

    expect(Object.keys(parsed).sort()).toEqual(['data', 'summary', 'total', 'truncated']);
    expect(typeof parsed.summary).toBe('string');
    expect(parsed.total).toBe(1);
    expect(parsed.truncated).toBe(false);

    expect(Array.isArray(parsed.data)).toBe(true);
    const data = (parsed.data as unknown[])[0] as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['content', 'createdAt', 'id', 'repo']);

    expect(typeof data.id).toBe('number');
    expect(typeof data.content).toBe('string');
    // repo can be null
    expect(typeof data.createdAt).toBe('string');
  });

  it('kb_forget: { summary, data: [{ deleted (boolean) }], total, truncated }', async () => {
    // Learn then forget
    const learnResult = await callTool('kb_learn', { content: 'ephemeral fact' });
    const learnParsed = parseResponse(learnResult);
    const factId = ((learnParsed.data as unknown[])[0] as Record<string, unknown>).id as number;

    const result = await callTool('kb_forget', { id: factId });
    const parsed = parseResponse(result);

    expect(Object.keys(parsed).sort()).toEqual(['data', 'summary', 'total', 'truncated']);
    expect(typeof parsed.summary).toBe('string');
    expect(parsed.total).toBe(1);
    expect(parsed.truncated).toBe(false);

    expect(Array.isArray(parsed.data)).toBe(true);
    const data = (parsed.data as unknown[])[0] as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['deleted']);
    expect(typeof data.deleted).toBe('boolean');
    expect(data.deleted).toBe(true);

    // Also verify shape for non-existent id
    const result2 = await callTool('kb_forget', { id: 99999 });
    const parsed2 = parseResponse(result2);
    const data2 = (parsed2.data as unknown[])[0] as Record<string, unknown>;
    expect(Object.keys(data2).sort()).toEqual(['deleted']);
    expect(data2.deleted).toBe(false);
  });

  it('kb_status: { summary, data: [{ counts, staleness }], total, truncated }', async () => {
    const result = await callTool('kb_status');
    const parsed = parseResponse(result);

    expect(Object.keys(parsed).sort()).toEqual(['data', 'summary', 'total', 'truncated']);
    expect(typeof parsed.summary).toBe('string');
    expect(parsed.total).toBe(1);
    expect(parsed.truncated).toBe(false);

    expect(Array.isArray(parsed.data)).toBe(true);
    const data = (parsed.data as unknown[])[0] as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['counts', 'staleness']);

    const counts = data.counts as Record<string, unknown>;
    expect(Object.keys(counts).sort()).toEqual([
      'edges', 'events', 'files', 'learned_facts', 'modules', 'repos', 'services',
    ]);
    // All counts are numbers
    for (const key of Object.keys(counts)) {
      expect(typeof counts[key]).toBe('number');
    }

    const staleness = data.staleness as Record<string, unknown>;
    expect(Object.keys(staleness).sort()).toEqual([
      'checked', 'missing', 'stale', 'staleRepos', 'total',
    ]);
    expect(typeof staleness.checked).toBe('number');
    expect(typeof staleness.total).toBe('number');
    expect(typeof staleness.stale).toBe('number');
    expect(typeof staleness.missing).toBe('number');
    expect(Array.isArray(staleness.staleRepos)).toBe(true);
  });

  it('kb_cleanup: { summary, data: [{ deletedRepos, pruned, staleFacts }], total, truncated }', async () => {
    // Insert a repo with non-existent path to trigger detection
    insertRepo('ghost-repo', '/nonexistent/contract/path', 'abc123');

    const result = await callTool('kb_cleanup', {});
    const parsed = parseResponse(result);

    expect(Object.keys(parsed).sort()).toEqual(['data', 'summary', 'total', 'truncated']);
    expect(typeof parsed.summary).toBe('string');
    expect(parsed.total).toBe(1);
    expect(parsed.truncated).toBe(false);

    expect(Array.isArray(parsed.data)).toBe(true);
    const data = (parsed.data as unknown[])[0] as Record<string, unknown>;
    expect(Object.keys(data).sort()).toEqual(['deletedRepos', 'pruned', 'staleFacts']);

    expect(Array.isArray(data.deletedRepos)).toBe(true);
    expect(typeof data.pruned).toBe('boolean');
    expect(Array.isArray(data.staleFacts)).toBe(true);
  });

  it('kb_list_types: { summary, data: [{ [entityType]: [{ subType, count }] }], total, truncated }', async () => {
    const result = await callTool('kb_list_types');
    const parsed = parseResponse(result);

    expect(Object.keys(parsed).sort()).toEqual(['data', 'summary', 'total', 'truncated']);
    expect(typeof parsed.summary).toBe('string');
    expect(parsed.total).toBe(1);
    expect(parsed.truncated).toBe(false);

    expect(Array.isArray(parsed.data)).toBe(true);
    const typeMap = (parsed.data as unknown[])[0] as Record<string, unknown>;

    // With seeded data, should have 'module' key
    expect(typeof typeMap).toBe('object');
    expect(typeMap).not.toBeNull();

    // Verify structure: each key maps to array of { subType, count }
    for (const [, entries] of Object.entries(typeMap)) {
      expect(Array.isArray(entries)).toBe(true);
      for (const entry of entries as Array<Record<string, unknown>>) {
        expect(Object.keys(entry).sort()).toEqual(['count', 'subType']);
        expect(typeof entry.subType).toBe('string');
        expect(typeof entry.count).toBe('number');
      }
    }
  });

  it('kb_impact: { summary, stats, direct, indirect, transitive } (compact format)', async () => {
    // Need repos with an edge so we get a non-trivial response
    const targetId = insertRepo('impact-contract-target', tmpDir, 'current-commit');
    const callerId = insertRepo('impact-contract-caller', tmpDir, 'current-commit');
    insertDirectEdge(callerId, targetId, 'calls_grpc');

    const result = await callTool('kb_impact', { name: 'impact-contract-target' });
    const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(r.isError).toBeUndefined();

    const parsed = JSON.parse(r.content[0].text);

    // Compact format keys
    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('stats');
    expect(parsed).toHaveProperty('direct');
    expect(parsed).toHaveProperty('indirect');
    expect(parsed).toHaveProperty('transitive');

    expect(typeof parsed.summary).toBe('string');
    expect(typeof parsed.stats).toBe('object');
    expect(typeof parsed.direct).toBe('object');
    expect(typeof parsed.indirect).toBe('object');
    expect(typeof parsed.transitive).toBe('object');

    // Stats shape
    const stats = parsed.stats;
    expect(stats).toHaveProperty('total');
    expect(stats).toHaveProperty('blastRadiusScore');
    expect(stats).toHaveProperty('mechanisms');
    expect(typeof stats.total).toBe('number');
    expect(typeof stats.blastRadiusScore).toBe('number');
    expect(typeof stats.mechanisms).toBe('object');
  });

  it('kb_impact error response: { isError: true, content with Error message }', async () => {
    const result = await callTool('kb_impact', { name: 'nonexistent-contract-service' });
    const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error');
    expect(r.content[0].text).toContain('nonexistent-contract-service');
  });

  it('kb_trace: { from, to, path_summary, hop_count, hops }', async () => {
    // Need two repos with an edge for a traceable path
    const idA = insertRepo('trace-contract-a', tmpDir, 'current-commit');
    const idB = insertRepo('trace-contract-b', tmpDir, 'current-commit');
    insertDirectEdge(idA, idB, 'calls_grpc');

    const result = await callTool('kb_trace', { from: 'trace-contract-a', to: 'trace-contract-b' });
    const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(r.isError).toBeUndefined();

    const parsed = JSON.parse(r.content[0].text);

    expect(Object.keys(parsed).sort()).toEqual(['from', 'hop_count', 'hops', 'path_summary', 'to']);

    expect(typeof parsed.from).toBe('string');
    expect(typeof parsed.to).toBe('string');
    expect(typeof parsed.path_summary).toBe('string');
    expect(typeof parsed.hop_count).toBe('number');
    expect(Array.isArray(parsed.hops)).toBe(true);

    // Verify hop shape
    expect(parsed.hops).toHaveLength(1);
    const hop = parsed.hops[0];
    expect(hop).toHaveProperty('from');
    expect(hop).toHaveProperty('to');
    expect(hop).toHaveProperty('mechanism');
  });

  it('kb_trace error response: { isError: true, content with Error message }', async () => {
    const result = await callTool('kb_trace', { from: 'nonexistent-a', to: 'nonexistent-b' });
    const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('Error');
  });
});
