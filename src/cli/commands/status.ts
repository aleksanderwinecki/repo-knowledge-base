/**
 * CLI command: kb status
 * Show knowledge base statistics.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { output } from '../output.js';
import { getDbPath } from '../db.js';

export function registerStatus(program: Command) {
  program
    .command('status')
    .description('Show knowledge base status and statistics')
    .action(() => {
      const dbPath = getDbPath();
      const stats = withDb((db) => {
        const count = (table: string) => {
          const row = db
            .prepare(`SELECT COUNT(*) as n FROM ${table}`)
            .get() as { n: number };
          return row.n;
        };

        // Check if learned_facts table exists (may not exist until Plan 02 migration)
        let learnedFacts = 0;
        try {
          learnedFacts = count('learned_facts');
        } catch {
          // Table doesn't exist yet — that's fine
        }

        return {
          database: dbPath,
          repos: count('repos'),
          files: count('files'),
          modules: count('modules'),
          services: count('services'),
          events: count('events'),
          edges: count('edges'),
          learnedFacts,
        };
      });
      output(stats);
    });
}
