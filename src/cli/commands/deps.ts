/**
 * CLI command: kb deps
 * Query service dependencies (direct neighbors only, per user decision).
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { queryDependencies } from '../../search/index.js';
import { output } from '../output.js';

export function registerDeps(program: Command) {
  program
    .command('deps')
    .description('Query service dependencies (direct neighbors only)')
    .argument('<entity>', 'entity name (e.g., payments-service)')
    .option('--direction <dir>', 'upstream or downstream', 'upstream')
    .option('--repo <name>', 'filter by repo name')
    .action((entity, opts) => {
      const result = withDb((db) =>
        queryDependencies(db, entity, {
          direction: opts.direction as 'upstream' | 'downstream',
          depth: 1, // Per user decision: direct neighbors only
          repo: opts.repo,
        }),
      );
      output(result);
    });
}
