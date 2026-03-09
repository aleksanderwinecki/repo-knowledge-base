/**
 * kb_trace MCP tool: shortest-path trace between two services.
 * Wraps traceRoute() with auto-sync for stale repo detection.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { traceRoute } from '../../search/trace.js';
import { wrapToolHandler } from '../handler.js';
import { withAutoSync } from '../sync.js';

export function registerTraceTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_trace',
    'Trace shortest path between two services showing each hop and mechanism',
    {
      from: z.string().describe('Source service/repo name'),
      to: z.string().describe('Target service/repo name'),
    },
    wrapToolHandler('kb_trace', async ({ from, to }) => {
      let result = traceRoute(db, from, to);

      // Collect all repo names from result for auto-sync
      const allNames = [
        result.from,
        result.to,
        ...result.hops.flatMap((h) => [h.from, h.to]),
      ];
      const uniqueNames = [...new Set(allNames)];

      if (result.hops.length > 0) {
        result = await withAutoSync(
          db,
          () => traceRoute(db, from, to),
          (r) => {
            const names = [
              r.from,
              r.to,
              ...r.hops.flatMap((h) => [h.from, h.to]),
            ];
            return [...new Set(names)];
          },
        );
      }

      return JSON.stringify(result);
    }),
  );
}
