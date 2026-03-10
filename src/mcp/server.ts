#!/usr/bin/env node

/**
 * MCP server entry point for the knowledge base.
 * Runs on stdio transport -- all logging goes to stderr.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type Database from 'better-sqlite3';
import { openDatabase, registerShutdownHandlers } from '../db/database.js';
import { resolveDbPath } from '../db/path.js';
import { registerSearchTool } from './tools/search.js';
import { registerEntityTool } from './tools/entity.js';
import { registerDepsTool } from './tools/deps.js';
import { registerLearnTool } from './tools/learn.js';
import { registerForgetTool } from './tools/forget.js';
import { registerStatusTool } from './tools/status.js';
import { registerCleanupTool } from './tools/cleanup.js';
import { registerListTypesTool } from './tools/list-types.js';
import { registerReindexTool } from './tools/reindex.js';
import { registerImpactTool } from './tools/impact.js';
import { registerTraceTool } from './tools/trace.js';
import { registerExplainTool } from './tools/explain.js';
import { registerFieldImpactTool } from './tools/field-impact.js';

/**
 * Factory for creating a fully-wired MCP server.
 * Used by tests and by the main() entry point below.
 */
export function createServer(db: Database.Database): McpServer {
  const server = new McpServer(
    { name: 'kb', version: '1.0.0' },
    {
      instructions: [
        'Knowledge base indexing 400+ microservice repos.',
        'Use these tools BEFORE exploring repos manually or guessing which service owns something.',
        'kb_search: find services, modules, events, schemas by keyword.',
        'kb_entity: structured entity card with relationships.',
        'kb_explain: full service overview card — start here when asked "what does X do?".',
        'kb_deps: service dependency graph with mechanism filtering.',
        'kb_impact: blast radius — what breaks if this service changes.',
        'kb_trace: shortest path between two services.',
        'kb_learn/kb_forget: store or delete persistent facts.',
        'kb_status: database statistics and staleness check.',
        'kb_list_types: discover available entity types with counts.',
        'kb_reindex: refresh specific repos with latest code from remote.',
        'kb_field_impact: trace a field across service boundaries with nullability at each hop.',
        'kb_cleanup: detect deleted repos and stale facts.',
      ].join(' '),
    },
  );
  registerSearchTool(server, db);
  registerEntityTool(server, db);
  registerDepsTool(server, db);
  registerLearnTool(server, db);
  registerForgetTool(server, db);
  registerStatusTool(server, db);
  registerCleanupTool(server, db);
  registerListTypesTool(server, db);
  registerReindexTool(server, db);
  registerImpactTool(server, db);
  registerTraceTool(server, db);
  registerExplainTool(server, db);
  registerFieldImpactTool(server, db);
  return server;
}

async function main() {
  const dbPath = resolveDbPath();
  const db = openDatabase(dbPath);
  registerShutdownHandlers(db);

  const server = createServer(db);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[kb-mcp] server running on stdio');
}

main().catch((error) => {
  console.error('[kb-mcp] Fatal error:', error);
  process.exit(1);
});
