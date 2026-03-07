/**
 * kb_deps MCP tool: service dependency graph queries.
 * Wraps queryDependencies() with auto-sync and formatResponse.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { queryDependencies } from '../../search/dependencies.js';
import { formatResponse } from '../format.js';
import { wrapToolHandler } from '../handler.js';
import { withAutoSync } from '../sync.js';

export function registerDepsTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_deps',
    'Query service dependency graph (upstream: what X depends on, downstream: what depends on X)',
    {
      name: z.string().describe('Service/repo name to query dependencies for'),
      direction: z.enum(['upstream', 'downstream']).optional().describe('Query direction (default: upstream)'),
      depth: z.number().min(1).max(10).optional().describe('Traversal depth (default: 1)'),
      repo: z.string().optional().describe('Filter dependencies to a specific repo'),
    },
    wrapToolHandler('kb_deps', ({ name, direction, depth, repo }) => {
      let result = queryDependencies(db, name, { direction, depth, repo });

      if (!result || result.dependencies.length === 0) {
        return JSON.stringify({
          summary: `No dependencies found for "${name}"`,
          data: result ?? null,
          total: 0,
          truncated: false,
        });
      }

      // Sync stale repos and re-query if needed (only when we have results)
      result = withAutoSync(
        db,
        () => queryDependencies(db, name, { direction, depth, repo })!,
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
