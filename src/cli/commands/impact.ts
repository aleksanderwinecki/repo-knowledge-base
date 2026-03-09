/**
 * CLI command: kb impact
 * Blast radius analysis for a service.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { analyzeImpact, formatImpactVerbose } from '../../search/impact.js';
import { VALID_MECHANISMS } from '../../search/edge-utils.js';
import { output, outputError } from '../output.js';
import { withTiming, reportTimings } from '../timing.js';

export function registerImpact(program: Command) {
  program
    .command('impact')
    .description('Blast radius analysis: what services break if this service changes')
    .argument('<service>', 'service/repo name to analyze')
    .option('--mechanism <type>', 'filter by communication mechanism (grpc, http, gateway, kafka, event)')
    .option('--depth <n>', 'maximum traversal depth', '3')
    .option('--timing', 'report timing to stderr', false)
    .action((service, opts) => {
      if (opts.mechanism && !VALID_MECHANISMS.includes(opts.mechanism)) {
        outputError(
          `Invalid mechanism "${opts.mechanism}". Valid options: ${VALID_MECHANISMS.join(', ')}`,
          'INVALID_MECHANISM',
        );
      }

      const depth = parseInt(opts.depth, 10);

      const result = withDb((db) =>
        withTiming('analyze-impact', () =>
          analyzeImpact(db, service, {
            mechanism: opts.mechanism,
            maxDepth: depth,
          }),
        ),
      );
      output(formatImpactVerbose(result));
      if (opts.timing) reportTimings();
    });
}
