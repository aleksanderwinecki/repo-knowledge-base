/**
 * kb_forget MCP tool: delete a learned fact by ID.
 * Wraps forgetFact() — no auto-sync needed (write operation).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { forgetFact } from '../../knowledge/store.js';
import { formatSingleResponse } from '../format.js';
import { wrapToolHandler } from '../handler.js';

export function registerForgetTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_forget',
    'Delete a learned fact by its ID',
    {
      id: z.number().describe('ID of the fact to forget'),
    },
    wrapToolHandler('kb_forget', ({ id }) => {
      const deleted = forgetFact(db, id);
      return formatSingleResponse(
        { deleted },
        deleted ? `Forgot fact ${id}` : `Fact ${id} not found`,
      );
    }),
  );
}
