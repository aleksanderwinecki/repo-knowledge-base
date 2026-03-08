/**
 * CLI command: kb deps
 * Query service dependencies with optional mechanism filtering.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { queryDependencies, VALID_MECHANISMS } from '../../search/index.js';
import { output, outputError } from '../output.js';
import { withTiming, reportTimings } from '../timing.js';

export function registerDeps(program: Command) {
  program
    .command('deps')
    .description('Query service dependencies')
    .argument('<entity>', 'entity name (e.g., payments-service)')
    .option('--direction <dir>', 'upstream or downstream', 'upstream')
    .option('--mechanism <type>', 'filter by communication mechanism (grpc, http, gateway, kafka, event)')
    .option('--repo <name>', 'filter by repo name')
    .option('--timing', 'report timing to stderr', false)
    .action((entity, opts) => {
      if (opts.mechanism && !VALID_MECHANISMS.includes(opts.mechanism)) {
        outputError(
          `Invalid mechanism "${opts.mechanism}". Valid options: ${VALID_MECHANISMS.join(', ')}`,
          'INVALID_MECHANISM',
        );
      }

      const result = withDb((db) =>
        withTiming('query-deps', () =>
          queryDependencies(db, entity, {
            direction: opts.direction as 'upstream' | 'downstream',
            depth: 1, // Per user decision: direct neighbors only
            repo: opts.repo,
            mechanism: opts.mechanism,
          }),
        ),
      );
      output(result);
      if (opts.timing) reportTimings();
    });
}
