/**
 * CLI command: kb index
 * Indexes all repos under a root directory.
 */

import type { Command } from '@commander-js/extra-typings';
import os from 'os';
import path from 'path';
import { performance } from 'node:perf_hooks';
import { withDbAsync } from '../db.js';
import { indexAllRepos } from '../../indexer/pipeline.js';
import { ProgressReporter, ErrorCollector } from '../../indexer/progress.js';
import { output } from '../output.js';
import { printSummary } from '../summary.js';
import { withTimingAsync, reportTimings } from '../timing.js';

export function resolveOutputMode(
  opts: { json: boolean },
  isTTY: boolean | undefined,
): 'json' | 'human' {
  return opts.json || !isTTY ? 'json' : 'human';
}

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
    .option('--json', 'output raw JSON results instead of summary', false)
    .option('--verbose', 'show per-repo detail during indexing', false)
    .action(async (opts) => {
      const progress = new ProgressReporter(process.stderr);
      const errors = new ErrorCollector();

      progress.spin('Scanning repos...');

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

      const jsonMode = resolveOutputMode(opts, process.stdout.isTTY);

      if (jsonMode === 'json') {
        output(results);
        if (errors.hasErrors()) {
          errors.printSummary(process.stderr);
        }
      } else {
        const measure = performance.getEntriesByName('index-all')[0];
        const elapsedMs = measure?.duration ?? 0;
        printSummary(process.stdout, results, elapsedMs, errors);
      }

      if (opts.timing) reportTimings();
    });
}
