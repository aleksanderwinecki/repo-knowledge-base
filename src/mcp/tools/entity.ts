/**
 * kb_entity MCP tool: structured entity card lookup.
 * Wraps findEntity() with auto-sync and formatResponse.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { findEntity } from '../../search/entity.js';
import { formatResponse } from '../format.js';
import { wrapToolHandler } from '../handler.js';
import { withAutoSync } from '../sync.js';

export function registerEntityTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_entity',
    'Look up a structured entity card with relationships by name',
    {
      name: z.string().describe('Entity name to look up'),
      type: z.string().optional().describe('Filter by type: coarse (repo, module, event, service) or sub-type (schema, graphql_query, grpc, etc.)'),
      repo: z.string().optional().describe('Filter by repo name'),
    },
    wrapToolHandler('kb_entity', ({ name, type, repo }) => {
      const filters: { type?: string; repo?: string } = {};
      if (type) filters.type = type;
      if (repo) filters.repo = repo;

      const results = withAutoSync(
        db,
        () => findEntity(db, name, filters as Parameters<typeof findEntity>[2]),
        (items) => [...new Set(items.map((r) => r.repoName))],
      );

      return formatResponse(
        results,
        (items) => `Found ${results.length} entities matching "${name}" (showing ${items.length})`,
      );
    }),
  );
}
