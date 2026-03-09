/**
 * CLI command: kb explain
 * Structured overview card for a service.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { explainService } from '../../search/explain.js';
import { output, outputError } from '../output.js';

export function registerExplain(program: Command) {
  program
    .command('explain')
    .description('Structured overview card for a service')
    .argument('<service>', 'service/repo name to explain')
    .action((service) => {
      try {
        const result = withDb((db) => explainService(db, service));
        output(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outputError(message, 'EXPLAIN_ERROR');
      }
    });
}
