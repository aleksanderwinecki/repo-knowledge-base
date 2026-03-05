#!/usr/bin/env node

/**
 * KB — Repository Knowledge Base CLI
 * JSON-only output for AI agents.
 */

import { Command } from '@commander-js/extra-typings';
import { registerIndex } from './commands/index-cmd.js';
import { registerSearch } from './commands/search.js';
import { registerDeps } from './commands/deps.js';
import { registerStatus } from './commands/status.js';

const program = new Command();
program
  .name('kb')
  .description('Repository knowledge base — JSON output for AI agents')
  .version('1.0.0');

registerIndex(program);
registerSearch(program);
registerDeps(program);
registerStatus(program);

program.parse();
