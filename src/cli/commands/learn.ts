/**
 * CLI command: kb learn
 * Teach the knowledge base a new fact.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { learnFact } from '../../knowledge/store.js';
import { output } from '../output.js';

export function registerLearn(program: Command) {
  program
    .command('learn')
    .description('Teach the knowledge base a new fact')
    .argument('<text>', 'fact to learn (free-form text)')
    .option('--repo <name>', 'associate with a specific repo')
    .action((text, opts) => {
      const fact = withDb((db) => learnFact(db, text, opts.repo));
      output(fact);
    });
}
