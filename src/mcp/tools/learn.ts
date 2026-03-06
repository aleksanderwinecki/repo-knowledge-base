/**
 * kb_learn MCP tool: store a new fact in the knowledge base.
 * Wraps learnFact() — no auto-sync needed (write operation).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { learnFact } from '../../knowledge/store.js';

export function registerLearnTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_learn',
    'Store a new fact in the knowledge base for future reference',
    {
      content: z.string().describe('The fact to remember'),
      repo: z.string().optional().describe('Associate with a specific repo'),
    },
    async ({ content, repo }) => {
      try {
        const fact = learnFact(db, content, repo);
        const text = JSON.stringify({
          summary: `Learned: "${content.length > 60 ? content.slice(0, 60) + '...' : content}" (id: ${fact.id})`,
          data: fact,
        });
        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error learning fact: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
