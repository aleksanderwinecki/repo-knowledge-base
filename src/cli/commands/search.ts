/**
 * CLI command: kb search
 * Full-text search and entity queries across indexed knowledge.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { searchText, findEntity } from '../../search/index.js';
import { listAvailableTypes } from '../../db/fts.js';
import { output, outputError } from '../output.js';
import { withTiming, reportTimings } from '../timing.js';

export function registerSearch(program: Command) {
  program
    .command('search')
    .description('Full-text search across indexed knowledge')
    .argument('[query]', 'search query (FTS5 syntax supported)')
    .option('--repo <name>', 'filter by repo name')
    .option(
      '--type <entity>',
      'filter by type: coarse (repo, module, event, service) or sub-type (schema, context, graphql_query, grpc, etc.)',
    )
    .option('--limit <n>', 'max results', '20')
    .option(
      '--entity',
      'structured entity query mode (returns entity cards with relationships)',
    )
    .option('--list-types', 'list available entity types with counts')
    .option('--timing', 'report timing to stderr', false)
    .action((query, opts) => {
      withDb((db) => {
        if (opts.listTypes) {
          const types = withTiming('list-types', () => listAvailableTypes(db));
          output(types);
          if (opts.timing) reportTimings();
          return;
        }

        if (!query) {
          outputError('search query is required (or use --list-types)', 'MISSING_QUERY');
          return;
        }

        if (opts.entity) {
          const cards = withTiming('find-entity', () =>
            findEntity(db, query, {
              type: opts.type,
              repo: opts.repo,
            }),
          );
          output(cards);
        } else {
          const results = withTiming('search-text', () =>
            searchText(db, query, {
              limit: parseInt(opts.limit, 10),
              repoFilter: opts.repo,
              entityTypeFilter: opts.type,
            }),
          );
          output(results);
        }
        if (opts.timing) reportTimings();
      });
    });
}
