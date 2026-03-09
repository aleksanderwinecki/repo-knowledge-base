/**
 * kb_impact MCP tool: blast radius analysis.
 * Wraps analyzeImpact() with auto-sync and compact formatting.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { VALID_MECHANISMS } from '../../search/edge-utils.js';
import { analyzeImpact, formatImpactCompact } from '../../search/impact.js';
import { wrapToolHandler } from '../handler.js';
import { withAutoSync } from '../sync.js';

export function registerImpactTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_impact',
    'Blast radius analysis: what services break if this service changes',
    {
      name: z.string().describe('Service/repo name to analyze blast radius for'),
      mechanism: z.enum(VALID_MECHANISMS as [string, ...string[]]).optional()
        .describe('Filter by communication mechanism (grpc, http, gateway, kafka, event)'),
      depth: z.number().min(1).max(10).optional()
        .describe('Maximum traversal depth (default: 3)'),
    },
    wrapToolHandler('kb_impact', async ({ name, mechanism, depth }) => {
      let result = analyzeImpact(db, name, {
        mechanism,
        maxDepth: depth,
      });

      // Collect all repo names from result for auto-sync
      const allNames = [
        result.service,
        ...result.tiers.direct.map((e) => e.name),
        ...result.tiers.indirect.map((e) => e.name),
        ...result.tiers.transitive.map((e) => e.name),
      ];

      if (allNames.length > 1) {
        result = await withAutoSync(
          db,
          () => analyzeImpact(db, name, { mechanism, maxDepth: depth }),
          (r) => [
            r.service,
            ...r.tiers.direct.map((e) => e.name),
            ...r.tiers.indirect.map((e) => e.name),
            ...r.tiers.transitive.map((e) => e.name),
          ],
        );
      }

      return JSON.stringify(formatImpactCompact(result));
    }),
  );
}
