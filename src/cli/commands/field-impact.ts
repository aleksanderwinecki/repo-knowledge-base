/**
 * CLI command: kb field-impact
 * Trace a field across service boundaries with nullability at each hop.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { analyzeFieldImpact } from '../../search/field-impact.js';
import { output } from '../output.js';
import { withTiming, reportTimings } from '../timing.js';

export function registerFieldImpact(program: Command) {
  program
    .command('field-impact')
    .description('Trace a field across service boundaries with nullability at each hop')
    .argument('<field>', 'field name to trace')
    .option('--timing', 'report timing to stderr', false)
    .action((field, opts) => {
      const result = withDb((db) =>
        withTiming('field-impact', () => analyzeFieldImpact(db, field)),
      );
      output(result);
      if (opts.timing) reportTimings();
    });
}
