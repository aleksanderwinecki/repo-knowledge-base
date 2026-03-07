/**
 * kb_list_types MCP tool: discover available entity types and sub-types.
 * Wraps listAvailableTypes() to expose type discovery for MCP clients.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { listAvailableTypes } from '../../db/fts.js';
import { formatSingleResponse } from '../format.js';
import { wrapToolHandler } from '../handler.js';

export function registerListTypesTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_list_types',
    'Discover available entity types and sub-types in the knowledge base with counts',
    {},
    wrapToolHandler('kb_list_types', () => {
      const types = listAvailableTypes(db);
      const entries = Object.entries(types);
      const total = entries.reduce((sum, [, subtypes]) => sum + subtypes.length, 0);
      return formatSingleResponse(
        types,
        `${total} entity types available across ${entries.length} categories`,
      );
    }),
  );
}
