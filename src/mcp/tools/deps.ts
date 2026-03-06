/**
 * kb_deps MCP tool: service dependency graph queries.
 * Wraps queryDependencies() with auto-sync and formatResponse.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { queryDependencies } from '../../search/dependencies.js';
import { formatResponse } from '../format.js';
import { checkAndSyncRepos } from '../sync.js';

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
    async ({ name, direction, depth, repo }) => {
      try {
        let result = queryDependencies(db, name, { direction, depth, repo });

        if (!result || result.dependencies.length === 0) {
          const text = JSON.stringify({
            summary: `No dependencies found for "${name}"`,
            data: result ?? null,
            total: 0,
            truncated: false,
          });
          return { content: [{ type: 'text' as const, text }] };
        }

        // Extract repo names from entity + dependencies and check for stale data
        const repoNames = [
          result.entity.repoName,
          ...result.dependencies.map((d) => d.repoName),
        ];
        const uniqueRepos = [...new Set(repoNames)];
        const syncResult = checkAndSyncRepos(db, uniqueRepos);

        // If any repos were synced, re-run the query for fresh results
        if (syncResult.synced.length > 0) {
          result = queryDependencies(db, name, { direction, depth, repo });
        }

        // Wrap single result in array for formatResponse
        const text = formatResponse(
          [result],
          () => `Dependencies for "${name}" (${direction ?? 'upstream'}): ${result!.dependencies.length} found`,
        );

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error querying dependencies: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
