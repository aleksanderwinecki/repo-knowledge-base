/**
 * CLI command: kb trace
 * Trace shortest path between two services.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { traceRoute } from '../../search/trace.js';
import { output, outputError } from '../output.js';

export function registerTrace(program: Command) {
  program
    .command('trace')
    .description('Trace shortest path between two services showing each hop and mechanism')
    .argument('<from>', 'source service/repo name')
    .argument('<to>', 'target service/repo name')
    .action((from, to) => {
      try {
        const result = withDb((db) => traceRoute(db, from, to));
        output(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        outputError(message, 'TRACE_ERROR');
      }
    });
}
