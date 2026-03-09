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

/**
 * Factory for creating a fully-wired MCP server.
 * Used by tests and by the main() entry point below.
 */
export function createServer(db: Database.Database): McpServer {
  const server = new McpServer({ name: 'kb', version: '1.0.0' });
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
