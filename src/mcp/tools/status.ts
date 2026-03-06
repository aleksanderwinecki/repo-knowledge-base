/**
 * kb_status MCP tool: database statistics and staleness overview.
 * Queries entity counts and checks a sample of repos for staleness.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type Database from 'better-sqlite3';
import { getCurrentCommit } from '../../indexer/git.js';
import fs from 'fs';

const MAX_STALENESS_CHECK = 20;

export function registerStatusTool(server: McpServer, db: Database.Database): void {
  server.tool(
    'kb_status',
    'Show database statistics: entity counts, repo staleness, and learned facts',
    {},
    async () => {
      try {
        // Count all entity types
        const counts = {
          repos: (db.prepare('SELECT COUNT(*) as c FROM repos').get() as { c: number }).c,
          modules: (db.prepare('SELECT COUNT(*) as c FROM modules').get() as { c: number }).c,
          events: (db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number }).c,
          services: (db.prepare('SELECT COUNT(*) as c FROM services').get() as { c: number }).c,
          edges: (db.prepare('SELECT COUNT(*) as c FROM edges').get() as { c: number }).c,
          files: (db.prepare('SELECT COUNT(*) as c FROM files').get() as { c: number }).c,
          learned_facts: (db.prepare('SELECT COUNT(*) as c FROM learned_facts').get() as { c: number }).c,
        };

        // Check staleness of first N repos
        const repos = db.prepare(
          'SELECT name, path, last_indexed_commit FROM repos LIMIT ?',
        ).all(MAX_STALENESS_CHECK) as Array<{
          name: string;
          path: string;
          last_indexed_commit: string | null;
        }>;

        let staleCount = 0;
        let missingCount = 0;
        const staleRepos: string[] = [];

        for (const repo of repos) {
          if (!fs.existsSync(repo.path)) {
            missingCount++;
            continue;
          }
          const current = getCurrentCommit(repo.path);
          if (current && current !== repo.last_indexed_commit) {
            staleCount++;
            staleRepos.push(repo.name);
          }
        }

        const checkedOf = repos.length < counts.repos
          ? `checked ${repos.length} of ${counts.repos}`
          : `checked all ${counts.repos}`;

        const text = JSON.stringify({
          summary: `KB: ${counts.repos} repos, ${counts.modules} modules, ${counts.events} events, ${counts.learned_facts} facts | ${staleCount} stale, ${missingCount} missing (${checkedOf})`,
          data: {
            counts,
            staleness: {
              checked: repos.length,
              total: counts.repos,
              stale: staleCount,
              missing: missingCount,
              staleRepos,
            },
          },
        });

        return { content: [{ type: 'text' as const, text }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text' as const, text: `Error getting status: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
