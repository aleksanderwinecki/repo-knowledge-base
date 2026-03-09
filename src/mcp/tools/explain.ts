/**
 * kb_explain MCP tool: structured overview card for a service.
 * Wraps explainService() with auto-sync for stale repo detection.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { explainService } from '../../search/explain.js';
import { wrapToolHandler } from '../handler.js';
import { withAutoSync } from '../sync.js';

export function registerExplainTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_explain',
    'Structured overview card for a service: identity, connections, events, modules, and next steps',
    {
      name: z.string().describe('Service/repo name to explain'),
    },
    wrapToolHandler('kb_explain', async ({ name }) => {
      let result = explainService(db, name);

      result = await withAutoSync(
        db,
        () => explainService(db, name),
        () => [name],
      );

      return JSON.stringify(result);
    }),
  );
}
