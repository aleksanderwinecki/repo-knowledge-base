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
 *
 * Detects:
 * 1. handle_event/handle_message with struct pattern matching
 * 2. handle_decoded_message with struct pattern matching (Kafkaesque)
 * 3. Kafkaesque.Consumer topics_config with topic names
 * 4. Kafkaesque decoder_config schema references
 */
function detectConsumers(repoPath: string): EventRelationship[] {
  const consumers: EventRelationship[] = [];
  const exFiles = findExFiles(repoPath);

  // Pattern 1: handle_event(%Struct{}) or handle_message(%Struct{})
  const handleEventRe =
    /def\s+handle_(?:event|message)\s*\(%(\w+(?:\.\w+)*)\{/g;

  // Pattern 2: handle_decoded_message with struct matching
  // e.g., handle_decoded_message(%{proto_payload: %SomeStruct{...}})
  const handleDecodedStructRe =
    /def\s+handle_decoded_message\s*\([^)]*%(\w+(?:\.\w+)*)\{/g;

  // Pattern 3: Kafkaesque topics_config topic names
  // e.g., "partners.employee-events-v2" => %{
  const topicNameRe = /"([\w.-]+)"\s*=>\s*%\{/g;

  // Pattern 4: Kafkaesque decoder schema references
  // e.g., schema: Events.Appointments.AppointmentEventEnvelope.V1.Payload
  const schemaRe = /schema:\s+(\w+(?:\.\w+)*)/g;

  // Detect if file is a Kafkaesque consumer
  const kafkaesqueRe = /use\s+Kafkaesque\.(?:Consumer|OneOffConsumer)\s*,/;

  for (const filePath of exFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(repoPath, filePath);

      const moduleMatch = content.match(/defmodule\s+([\w.]+)/);
      const handlerModule = moduleMatch ? moduleMatch[1] : null;
      const seen = new Set<string>();

      let match;

      // Pattern 1: handle_event/handle_message
      handleEventRe.lastIndex = 0;
      while ((match = handleEventRe.exec(content)) !== null) {
        const key = `handle:${match[1]}`;
        if (!seen.has(key)) {
          seen.add(key);
          consumers.push({
            type: 'consumes_event',
            eventName: match[1],
            sourceFile: relativePath,
            handlerModule,
          });
        }
      }

      // Pattern 2: handle_decoded_message with struct
      handleDecodedStructRe.lastIndex = 0;
      while ((match = handleDecodedStructRe.exec(content)) !== null) {
        const key = `decoded:${match[1]}`;
        if (!seen.has(key)) {
          seen.add(key);
          consumers.push({
            type: 'consumes_event',
            eventName: match[1],
            sourceFile: relativePath,
            handlerModule,
          });
        }
      }

      // Patterns 3 & 4: only for Kafkaesque consumer files
      if (kafkaesqueRe.test(content)) {
        // Pattern 3: topic names from topics_config
        topicNameRe.lastIndex = 0;
        while ((match = topicNameRe.exec(content)) !== null) {
          const topic = match[1];
          const key = `topic:${topic}`;
          if (!seen.has(key)) {
            seen.add(key);
            consumers.push({
              type: 'consumes_event',
              eventName: topic,
              sourceFile: relativePath,
              handlerModule,
            });
          }
        }

        // Pattern 4: schema references from decoder_config
        schemaRe.lastIndex = 0;
        while ((match = schemaRe.exec(content)) !== null) {
          const schema = match[1];
          // Skip generic names that aren't real event types
          if (schema === 'Payload' || schema === 'Schema') continue;
          const key = `schema:${schema}`;
          if (!seen.has(key)) {
            seen.add(key);
            consumers.push({
              type: 'consumes_event',
              eventName: schema,
              sourceFile: relativePath,
              handlerModule,
            });
          }
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  return consumers;
}

/** Find all .ex files under lib, apps, src/lib, and src/apps directories. */
function findExFiles(repoPath: string): string[] {
  const files: string[] = [];

  // Direct lib/ directory
  const libDir = path.join(repoPath, 'lib');
  if (fs.existsSync(libDir)) {
    collectFiles(libDir, '.ex', files);
  }

  // src/lib/ directory
  const srcLibDir = path.join(repoPath, 'src', 'lib');
  if (fs.existsSync(srcLibDir)) {
    collectFiles(srcLibDir, '.ex', files);
  }

  // Scan umbrella app directories: apps/ and src/apps/
  for (const appsDir of [
    path.join(repoPath, 'apps'),
    path.join(repoPath, 'src', 'apps'),
  ]) {
    if (!fs.existsSync(appsDir)) continue;
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
