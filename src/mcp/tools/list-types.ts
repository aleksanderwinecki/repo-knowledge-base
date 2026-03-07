/**
 * kb_list_types MCP tool: discover available entity types and sub-types.
 * Wraps listAvailableTypes() to expose type discovery for MCP clients.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { listAvailableTypes } from '../../db/fts.js';

export function registerListTypesTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_list_types',
    'Discover available entity types and sub-types in the knowledge base with counts',
    {},
    async () => {
      try {
        const types = listAvailableTypes(db);
        const text = JSON.stringify(types, null, 2);
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error listing types: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
