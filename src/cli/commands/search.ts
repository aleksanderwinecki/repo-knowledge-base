/**
 * CLI command: kb search
 * Full-text search and entity queries across indexed knowledge.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { searchText, findEntity } from '../../search/index.js';
import { output } from '../output.js';
import type { EntityType } from '../../types/entities.js';

export function registerSearch(program: Command) {
  program
    .command('search')
    .description('Full-text search across indexed knowledge')
    .argument('<query>', 'search query (FTS5 syntax supported)')
    .option('--repo <name>', 'filter by repo name')
    .option(
      '--type <entity>',
      'filter by entity type (repo, module, event, service)',
    )
    .option('--limit <n>', 'max results', '20')
    .option(
      '--entity',
      'structured entity query mode (returns entity cards with relationships)',
    )
    .action((query, opts) => {
      withDb((db) => {
        if (opts.entity) {
          const cards = findEntity(db, query, {
            type: opts.type as EntityType | undefined,
            repo: opts.repo,
          });
          output(cards);
        } else {
          const results = searchText(db, query, {
            limit: parseInt(opts.limit, 10),
            repoFilter: opts.repo,
            entityTypeFilter: opts.type as EntityType | undefined,
          });
          output(results);
        }
      });
    });
}
