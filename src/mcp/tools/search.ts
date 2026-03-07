/**
 * kb_search MCP tool: full-text search across all indexed repos.
 * Wraps searchText() with auto-sync and formatResponse.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { searchText } from '../../search/text.js';
import { formatResponse } from '../format.js';
import { checkAndSyncRepos } from '../sync.js';

export function registerSearchTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_search',
    'Full-text search across all indexed repos. Supports type filtering with --type for coarse (module, event) or granular (schema, grpc) filtering.',
    {
      query: z.string().describe('Search query (supports AND, OR, NOT, phrase matching)'),
      limit: z.number().min(1).max(50).optional().describe('Max results (default: 10)'),
      repo: z.string().optional().describe('Filter results to a specific repo'),
      type: z.string().optional().describe('Filter by type: coarse (repo, module, event, service) or sub-type (schema, context, graphql_query, grpc, etc.)'),
    },
    async ({ query, limit, repo, type }) => {
      try {
        let results = searchText(db, query, {
          limit: limit ?? 10,
          repoFilter: repo,
          entityTypeFilter: type,
        });

        // Extract unique repo names and check for stale data
        const repoNames = [...new Set(results.map((r) => r.repoName))];
        const syncResult = checkAndSyncRepos(db, repoNames);

        // If any repos were synced, re-run the search for fresh results
        if (syncResult.synced.length > 0) {
          results = searchText(db, query, {
            limit: limit ?? 10,
            repoFilter: repo,
            entityTypeFilter: type,
          });
        }

        const text = formatResponse(
          results,
          (items) => `Found ${results.length} results for "${query}" (showing ${items.length})`,
        );

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error searching: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
