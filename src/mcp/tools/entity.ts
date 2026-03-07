/**
 * kb_entity MCP tool: structured entity card lookup.
 * Wraps findEntity() with auto-sync and formatResponse.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { findEntity } from '../../search/entity.js';
import { formatResponse } from '../format.js';
import { checkAndSyncRepos } from '../sync.js';

export function registerEntityTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_entity',
    'Look up a structured entity card with relationships by name',
    {
      name: z.string().describe('Entity name to look up'),
      type: z.string().optional().describe('Filter by type: coarse (repo, module, event, service) or sub-type (schema, graphql_query, grpc, etc.)'),
      repo: z.string().optional().describe('Filter by repo name'),
    },
    async ({ name, type, repo }) => {
      try {
        const filters: { type?: string; repo?: string } = {};
        if (type) filters.type = type;
        if (repo) filters.repo = repo;

        let results = findEntity(db, name, filters as Parameters<typeof findEntity>[2]);

        // Extract unique repo names and check for stale data
        const repoNames = [...new Set(results.map((r) => r.repoName))];
        const syncResult = checkAndSyncRepos(db, repoNames);

        // If any repos were synced, re-run the query for fresh results
        if (syncResult.synced.length > 0) {
          results = findEntity(db, name, filters as Parameters<typeof findEntity>[2]);
        }

        const text = formatResponse(
          results,
          (items) => `Found ${results.length} entities matching "${name}" (showing ${items.length})`,
        );

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error finding entity: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
