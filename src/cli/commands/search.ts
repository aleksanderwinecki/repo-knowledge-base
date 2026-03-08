/**
 * CLI command: kb search
 * Full-text search, semantic search, and entity queries across indexed knowledge.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb, withDbAsync } from '../db.js';
import { searchText, searchSemantic, searchHybrid, findEntity } from '../../search/index.js';
import { listAvailableTypes } from '../../db/fts.js';
import { output, outputError } from '../output.js';
import { withTiming, withTimingAsync, reportTimings } from '../timing.js';

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
    .option('--semantic', 'semantic vector similarity search')
    .option('--list-types', 'list available entity types with counts')
    .option('--timing', 'report timing to stderr', false)
    .action(async (query, opts) => {
      // Sync paths: --list-types and --entity
      if (opts.listTypes) {
        withDb((db) => {
          const types = withTiming('list-types', () => listAvailableTypes(db));
          output(types);
          if (opts.timing) reportTimings();
        });
        return;
      }

      if (!query) {
        outputError('search query is required (or use --list-types)', 'MISSING_QUERY');
        return;
      }

      if (opts.entity) {
        withDb((db) => {
          const cards = withTiming('find-entity', () =>
            findEntity(db, query, {
              type: opts.type,
              repo: opts.repo,
            }),
          );
          output(cards);
          if (opts.timing) reportTimings();
        });
        return;
      }

      // Async paths: --semantic and default (hybrid)
      if (opts.semantic) {
        await withDbAsync(async (db) => {
          const results = await withTimingAsync('search-semantic', () =>
            searchSemantic(db, query, {
              limit: parseInt(opts.limit, 10),
              repoFilter: opts.repo,
            }),
          );
          output(results);
          if (opts.timing) reportTimings();
        });
        return;
      }

      // Default: hybrid search (FTS5 + vector)
      await withDbAsync(async (db) => {
        const results = await withTimingAsync('search-hybrid', () =>
          searchHybrid(db, query, {
            limit: parseInt(opts.limit, 10),
            repoFilter: opts.repo,
            entityTypeFilter: opts.type,
          }),
        );
        output(results);
        if (opts.timing) reportTimings();
      });
    });
}
