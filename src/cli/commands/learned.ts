/**
 * CLI command: kb learned
 * List all learned facts.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { listFacts } from '../../knowledge/store.js';
import { output } from '../output.js';

export function registerLearned(program: Command) {
  program
    .command('learned')
    .description('List all learned facts')
    .option('--repo <name>', 'filter by repo')
    .action((opts) => {
      const facts = withDb((db) => listFacts(db, opts.repo));
      output(facts);
    });
}
