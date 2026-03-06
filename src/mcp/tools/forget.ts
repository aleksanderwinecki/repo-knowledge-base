/**
 * kb_forget MCP tool: delete a learned fact by ID.
 * Wraps forgetFact() — no auto-sync needed (write operation).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { forgetFact } from '../../knowledge/store.js';

export function registerForgetTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_forget',
    'Delete a learned fact by its ID',
    {
      id: z.number().describe('ID of the fact to forget'),
    },
    async ({ id }) => {
      try {
        const deleted = forgetFact(db, id);
        const text = JSON.stringify({
          summary: deleted ? `Forgot fact ${id}` : `Fact ${id} not found`,
          data: { deleted },
        });
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error forgetting fact: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
