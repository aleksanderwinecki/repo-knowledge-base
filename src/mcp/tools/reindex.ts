/**
 * kb_reindex MCP tool: trigger targeted repo reindexing with optional git refresh.
 * Lets AI agents explicitly refresh repos they know are stale.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import os from 'os';
import path from 'path';
import { z } from 'zod';
import { indexAllRepos } from '../../indexer/pipeline.js';
import { wrapToolHandler } from '../handler.js';

export function registerReindexTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_reindex',
    'Reindex specific repos with optional git refresh to fetch latest code from remote',
    {
      repos: z.array(z.string()).min(1).describe('Repo names to reindex'),
      refresh: z.boolean().default(true).describe('Git fetch + reset before indexing (default: true)'),
    },
    wrapToolHandler('kb_reindex', async ({ repos, refresh }: { repos: string[]; refresh?: boolean }) => {
      if (!repos || repos.length === 0) {
        throw new Error('repos array must not be empty');
      }

      const effectiveRefresh = refresh ?? true;
      const rootDir = path.join(os.homedir(), 'Documents', 'Repos');
      const results = await indexAllRepos(db, {
        force: true,
        rootDir,
        repos,
        refresh: effectiveRefresh,
      });

      const success = results.filter(r => r.status === 'success').length;
      const errors = results.filter(r => r.status === 'error').length;

      return JSON.stringify({
        summary: `Reindexed ${success} repo(s)${errors > 0 ? `, ${errors} error(s)` : ''}`,
        results,
        total: results.length,
      });
    }),
  );
}
