import fs from 'fs';
import path from 'path';
import type { ProtoDefinition } from './proto.js';
import type { ElixirModule } from './elixir.js';

/** A detected event relationship (producer or consumer) */
export interface EventRelationship {
  type: 'produces_event' | 'consumes_event';
  eventName: string;
  sourceFile: string;
  handlerModule: string | null;
}

/** Directories to skip when scanning for handler files */
const SKIP_DIRS = new Set([
  'node_modules',
  '_build',
  'deps',
  'vendor',
  'dist',
  '.git',
  '.elixir_ls',
]);

/**
 * Detect event relationships (producers and consumers) for a repo.
 *
 * Producer: this repo defines proto messages -> it produces those events.
 * Consumer: this repo has handle_event/handle_message patterns matching event types.
 */
export function detectEventRelationships(
  repoPath: string,
  protoDefinitions: ProtoDefinition[],
  _elixirModules: ElixirModule[],
): EventRelationship[] {
  const relationships: EventRelationship[] = [];

  // Producer detection: repo owns proto message definitions
  for (const proto of protoDefinitions) {
    for (const message of proto.messages) {
      relationships.push({
        type: 'produces_event',
        eventName: message.name,
        sourceFile: proto.filePath,
        handlerModule: null,
      });
    }
  }

  // Consumer detection: scan .ex files for event handler patterns
  const consumers = detectConsumers(repoPath);
  relationships.push(...consumers);

  return relationships;
}

/**
 * Scan .ex files for event handler patterns.
 */
function detectConsumers(repoPath: string): EventRelationship[] {
  const consumers: EventRelationship[] = [];
  const exFiles = findExFiles(repoPath);

  // Patterns for event consumption
  const handleEventRe =
    /def\s+handle_(?:event|message)\s*\(%(\w+(?:\.\w+)*)\{/g;

  for (const filePath of exFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(repoPath, filePath);

      // Find the enclosing module name
      const moduleMatch = content.match(/defmodule\s+([\w.]+)/);
      const handlerModule = moduleMatch ? moduleMatch[1] : null;

      let match;
      // Reset regex state
      handleEventRe.lastIndex = 0;

      while ((match = handleEventRe.exec(content)) !== null) {
        consumers.push({
          type: 'consumes_event',
          eventName: match[1],
          sourceFile: relativePath,
          handlerModule,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  return consumers;
}

/**
 * Find all .ex files under lib/ and umbrella apps.
 */
function findExFiles(repoPath: string): string[] {
  const files: string[] = [];

  const libDir = path.join(repoPath, 'lib');
  if (fs.existsSync(libDir)) {
    collectFiles(libDir, '.ex', files);
  }

  const appsDir = path.join(repoPath, 'apps');
  if (fs.existsSync(appsDir)) {
    try {
      const apps = fs.readdirSync(appsDir, { withFileTypes: true });
      for (const app of apps) {
        if (!app.isDirectory() || SKIP_DIRS.has(app.name)) continue;
        const appLibDir = path.join(appsDir, app.name, 'lib');
        if (fs.existsSync(appLibDir)) {
          collectFiles(appLibDir, '.ex', files);
        }
      }
    } catch {
      // Skip unreadable apps directory
    }
  }

  return files;
}

/**
 * Recursively collect files with a given extension.
 */
function collectFiles(dir: string, ext: string, result: string[]): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath, ext, result);
      } else if (entry.isFile() && entry.name.endsWith(ext)) {
        result.push(fullPath);
      }
    }
  } catch {
    // Skip unreadable directories
  }
}
