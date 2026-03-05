/**
 * CLI command: kb forget
 * Delete a learned fact by ID.
 */

import type { Command } from '@commander-js/extra-typings';
import { withDb } from '../db.js';
import { forgetFact } from '../../knowledge/store.js';
import { output, outputError } from '../output.js';

export function registerForget(program: Command) {
  program
    .command('forget')
    .description('Delete a learned fact by ID')
    .argument('<id>', 'fact ID to delete')
    .action((idStr) => {
      const id = parseInt(idStr, 10);
      if (isNaN(id)) {
        outputError('Invalid fact ID — must be a number', 'INVALID_ID');
      }
      const deleted = withDb((db) => forgetFact(db, id));
      if (!deleted) {
        outputError(`Fact ${id} not found`, 'NOT_FOUND');
      }
      output({ deleted: true, id });
    });
}
