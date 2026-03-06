/**
 * kb_cleanup MCP tool: detect deleted repos, optionally prune, flag stale facts.
 * Wraps the hygiene module functions.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { detectDeletedRepos, pruneDeletedRepos, flagStaleFacts } from '../hygiene.js';

export function registerCleanupTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_cleanup',
    'Detect deleted repos and stale facts. Dry run by default; set prune=true to actually delete orphaned data.',
    {
      prune: z.boolean().optional().describe('Actually delete data for missing repos (default: dry run)'),
      max_fact_age_days: z.number().optional().describe('Flag learned facts older than N days (default: 90)'),
    },
    async ({ prune, max_fact_age_days }) => {
      try {
        const deletedRepos = detectDeletedRepos(db);

        if (prune && deletedRepos.length > 0) {
          pruneDeletedRepos(db, deletedRepos);
        }

        const staleFacts = flagStaleFacts(db, max_fact_age_days);

        const pruneStatus = prune ? 'pruned' : 'not pruned (dry run)';
        const text = JSON.stringify({
          summary: `Found ${deletedRepos.length} deleted repos (${pruneStatus}), ${staleFacts.length} stale facts flagged for review`,
          data: {
            deletedRepos,
            pruned: prune ?? false,
            staleFacts,
          },
        });

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error during cleanup: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
