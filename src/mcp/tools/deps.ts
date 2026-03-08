/**
 * kb_deps MCP tool: service dependency graph queries.
 * Wraps queryDependencies() with auto-sync and formatResponse.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { queryDependencies, VALID_MECHANISMS } from '../../search/dependencies.js';
import { formatResponse } from '../format.js';
import { wrapToolHandler } from '../handler.js';
import { withAutoSync } from '../sync.js';

export function registerDepsTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_deps',
    'Query service dependency graph with optional mechanism filtering (grpc, http, gateway, kafka, event)',
    {
      name: z.string().describe('Service/repo name to query dependencies for'),
      direction: z.enum(['upstream', 'downstream']).optional().describe('Query direction (default: upstream)'),
      depth: z.number().min(1).max(10).optional().describe('Traversal depth (default: 1)'),
      repo: z.string().optional().describe('Filter dependencies to a specific repo'),
      mechanism: z.enum(VALID_MECHANISMS as [string, ...string[]]).optional()
        .describe('Filter by communication mechanism (grpc, http, gateway, kafka, event)'),
    },
    wrapToolHandler('kb_deps', async ({ name, direction, depth, repo, mechanism }) => {
      let result = queryDependencies(db, name, { direction, depth, repo, mechanism });

      if (!result || result.dependencies.length === 0) {
        return JSON.stringify({
          summary: `No dependencies found for "${name}"`,
          data: result ?? null,
          total: 0,
          truncated: false,
        });
      }

      // Sync stale repos and re-query if needed (only when we have results)
      result = await withAutoSync(
        db,
        () => queryDependencies(db, name, { direction, depth, repo, mechanism })!,
        (r) => [...new Set([r.entity.repoName, ...r.dependencies.map((d) => d.repoName)])],
      );

      // Wrap single result in array for formatResponse
      return formatResponse(
        [result],
        () => `Dependencies for "${name}" (${direction ?? 'upstream'}): ${result!.dependencies.length} found`,
      );
    }),
  );
}
