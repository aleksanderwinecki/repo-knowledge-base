/**
 * kb_field_impact MCP tool: trace a field across service boundaries.
 * Wraps analyzeFieldImpact() with auto-sync and compact formatting.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { analyzeFieldImpact, formatFieldImpactCompact } from '../../search/field-impact.js';
import { wrapToolHandler } from '../handler.js';
import { withAutoSync } from '../sync.js';

export function registerFieldImpactTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_field_impact',
    'Trace a field name from origin schemas through proto/event boundaries to consuming services with nullability',
    {
      name: z.string().describe('Field name to trace (e.g., "employee_id")'),
    },
    wrapToolHandler('kb_field_impact', async ({ name }) => {
      let result = analyzeFieldImpact(db, name);

      // Collect all repo names from result for auto-sync
      const allNames = [
        ...result.origins.map((o) => o.repoName),
        ...result.boundaries.map((b) => b.repoName),
        ...result.consumers.map((c) => c.repoName),
      ];

      if (allNames.length > 0) {
        result = await withAutoSync(
          db,
          () => analyzeFieldImpact(db, name),
          (r) => [
            ...r.origins.map((o) => o.repoName),
            ...r.boundaries.map((b) => b.repoName),
            ...r.consumers.map((c) => c.repoName),
          ],
        );
      }

      return JSON.stringify(formatFieldImpactCompact(result));
    }),
  );
}
