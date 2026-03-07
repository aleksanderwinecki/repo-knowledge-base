import type { ProtoDefinition } from './proto.js';
import type { ElixirModule } from './elixir.js';
import { listBranchFiles, readBranchFile } from './git.js';

/** A detected event relationship (producer or consumer) */
export interface EventRelationship {
  type: 'produces_event' | 'consumes_event';
  eventName: string;
  sourceFile: string;
  handlerModule: string | null;
}

/**
 * Lib path prefixes where .ex files are expected for consumer detection.
 * Matches: lib/, src/lib/, apps/X/lib/, src/apps/X/lib/
 */
const LIB_PATH_PATTERNS = [
  /^lib\//,
  /^src\/lib\//,
  /^apps\/[^/]+\/lib\//,
  /^src\/apps\/[^/]+\/lib\//,
];

/**
 * Detect event relationships (producers and consumers) for a repo.
 *
 * Producer: this repo defines proto messages -> it produces those events.
 * Consumer: this repo has handle_event/handle_message patterns matching event types.
 */
export function detectEventRelationships(
  repoPath: string,
  branch: string,
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
  const consumers = detectConsumers(repoPath, branch);
  relationships.push(...consumers);

  return relationships;
}

/**
 * Scan .ex files for event handler patterns using git branch content.
 *
 * Detects:
 * 1. handle_event/handle_message with struct pattern matching
 * 2. handle_decoded_message with struct pattern matching (Kafkaesque)
 * 3. Kafkaesque.Consumer topics_config with topic names
 * 4. Kafkaesque decoder_config schema references
 */
function detectConsumers(repoPath: string, branch: string): EventRelationship[] {
  const consumers: EventRelationship[] = [];

  const allFiles = listBranchFiles(repoPath, branch);
  const exFiles = allFiles.filter(
    (f) => f.endsWith('.ex') && LIB_PATH_PATTERNS.some((p) => p.test(f)),
  );

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
      const content = readBranchFile(repoPath, branch, filePath);
      if (!content) continue;

      const moduleMatch = content.match(/defmodule\s+([\w.]+)/);
      const handlerModule = moduleMatch ? moduleMatch[1] ?? null : null;
      const seen = new Set<string>();

      let match;

      // Pattern 1: handle_event/handle_message
      handleEventRe.lastIndex = 0;
      while ((match = handleEventRe.exec(content)) !== null) {
        const eventName = match[1];
        if (!eventName) continue;
        const key = `handle:${eventName}`;
        if (!seen.has(key)) {
          seen.add(key);
          consumers.push({
            type: 'consumes_event',
            eventName,
            sourceFile: filePath,
            handlerModule,
          });
        }
      }

      // Pattern 2: handle_decoded_message with struct
      handleDecodedStructRe.lastIndex = 0;
      while ((match = handleDecodedStructRe.exec(content)) !== null) {
        const eventName = match[1];
        if (!eventName) continue;
        const key = `decoded:${eventName}`;
        if (!seen.has(key)) {
          seen.add(key);
          consumers.push({
            type: 'consumes_event',
            eventName,
            sourceFile: filePath,
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
          if (!topic) continue;
          const key = `topic:${topic}`;
          if (!seen.has(key)) {
            seen.add(key);
            consumers.push({
              type: 'consumes_event',
              eventName: topic,
              sourceFile: filePath,
              handlerModule,
            });
          }
        }

        // Pattern 4: schema references from decoder_config
        schemaRe.lastIndex = 0;
        while ((match = schemaRe.exec(content)) !== null) {
          const schema = match[1];
          if (!schema) continue;
          // Skip generic names that aren't real event types
          if (schema === 'Payload' || schema === 'Schema') continue;
          const key = `schema:${schema}`;
          if (!seen.has(key)) {
            seen.add(key);
            consumers.push({
              type: 'consumes_event',
              eventName: schema,
              sourceFile: filePath,
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
