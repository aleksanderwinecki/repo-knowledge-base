/**
 * CLI command: kb index
 * Indexes all repos under a root directory.
 */

import type { Command } from '@commander-js/extra-typings';
import os from 'os';
import path from 'path';
import { withDbAsync } from '../db.js';
import { indexAllRepos } from '../../indexer/pipeline.js';
import { output } from '../output.js';

export function registerIndex(program: Command) {
  program
    .command('index')
    .description('Index all repos under root directory')
    .option(
      '--root <path>',
      'root directory to scan',
      path.join(os.homedir(), 'Documents', 'Repos'),
    )
    .option('--force', 'force re-index all repos', false)
    .action(async (opts) => {
      const results = await withDbAsync(async (db) =>
        indexAllRepos(db, { rootDir: opts.root, force: opts.force }),
      );
      output(results);
    });
}
