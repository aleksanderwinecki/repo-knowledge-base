/**
 * kb_semantic MCP tool: semantic search for natural language queries.
 * Wraps searchHybrid() with auto-sync and formatResponse.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { searchHybrid } from '../../search/hybrid.js';
import { formatResponse } from '../format.js';
import { wrapToolHandler } from '../handler.js';
import { withAutoSyncAsync } from '../sync.js';

export function registerSemanticTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_semantic',
    'Semantic search for natural language queries. Returns entities ranked by meaning similarity, combining keyword matching with vector similarity. Use for questions like "which services handle payments" or "modules related to user authentication".',
    {
      query: z.string().describe('Natural language search query'),
      limit: z.number().min(1).max(50).optional().describe('Max results (default: 10)'),
      repo: z.string().optional().describe('Filter results to a specific repo'),
    },
    wrapToolHandler('kb_semantic', async ({ query, limit, repo }) => {
      const results = await withAutoSyncAsync(
        db,
        () => searchHybrid(db, query, {
          limit: limit ?? 10,
          repoFilter: repo,
        }),
        (items) => [...new Set(items.map((r) => r.repoName))],
      );

      return formatResponse(
        results,
        (items) => `Found ${results.length} semantic matches for "${query}" (showing ${items.length})`,
      );
    }),
  );
}
