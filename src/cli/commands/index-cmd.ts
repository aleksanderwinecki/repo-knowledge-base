/**
 * CLI command: kb index
 * Indexes all repos under a root directory.
 */

import type { Command } from '@commander-js/extra-typings';
import os from 'os';
import path from 'path';
import { withDbAsync } from '../db.js';
import { indexAllRepos } from '../../indexer/pipeline.js';
import { ProgressReporter, ErrorCollector } from '../../indexer/progress.js';
import { output } from '../output.js';
import { withTimingAsync, reportTimings } from '../timing.js';

export function registerIndex(program: Command) {
  program
    .command('index')
    .description('Index all repos under root directory')
    .option(
      '--root <path>',
      'root directory to scan',
      path.join(os.homedir(), 'Documents', 'Repos'),
    )
    .option('--repo <names...>', 'specific repos to reindex (space-separated)')
    .option('--force', 'force re-index all repos', false)
    .option('--refresh', 'git fetch + reset to latest before indexing', false)
    .option('--timing', 'report timing to stderr', false)
    .action(async (opts) => {
      const progress = new ProgressReporter(process.stderr);
      const errors = new ErrorCollector();

      const results = await withDbAsync(async (db) =>
        withTimingAsync('index-all', () =>
          indexAllRepos(db, {
            rootDir: opts.root,
            force: opts.force,
            repos: opts.repo,
            refresh: opts.refresh,
          }, { progress, errors }),
        ),
      );

      // Print error summary to stderr (after progress is done)
      if (errors.hasErrors()) {
        errors.printSummary(process.stderr);
      }

      output(results);
      if (opts.timing) reportTimings();
    });
}
