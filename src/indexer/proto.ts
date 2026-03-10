import { listBranchFiles, readBranchFile } from './git.js';

/** A single proto message field */
export interface ProtoField {
  type: string;
  name: string;
  optional: boolean;
}

/** A parsed proto message */
export interface ProtoMessage {
  name: string;
  fields: ProtoField[];
}

/** A single RPC definition in a service */
export interface ProtoRpc {
  name: string;
  inputType: string;
  outputType: string;
}

/** A parsed proto service */
export interface ProtoService {
  name: string;
  rpcs: ProtoRpc[];
}

/** Complete proto file parse result */
export interface ProtoDefinition {
  filePath: string;
  packageName: string | null;
  messages: ProtoMessage[];
  services: ProtoService[];
}

/** Max file size to process (500KB) */
const MAX_FILE_SIZE = 500 * 1024;

/**
 * Extract all proto definitions from a repo by reading from a git branch.
 * Scans the entire branch tree for .proto files.
 */
export function extractProtoDefinitions(repoPath: string, branch: string): ProtoDefinition[] {
  const allFiles = listBranchFiles(repoPath, branch);
  const protoFiles = allFiles.filter((f) => f.endsWith('.proto'));
  const definitions: ProtoDefinition[] = [];

  for (const filePath of protoFiles) {
    try {
      const content = readBranchFile(repoPath, branch, filePath);
      if (!content || content.length > MAX_FILE_SIZE) continue;

      const parsed = parseProtoFile(filePath, content);
      if (parsed.messages.length > 0 || parsed.services.length > 0) {
        definitions.push(parsed);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return definitions;
}

/**
 * Parse a single proto file.
 */
export function parseProtoFile(
  filePath: string,
  content: string,
): ProtoDefinition {
  const packageName = extractPackage(content);
  const messages = extractMessages(content);
  const services = extractServices(content);

  return { filePath, packageName, messages, services };
}

/**
 * Extract package declaration.
 */
function extractPackage(content: string): string | null {
  const match = content.match(/^package\s+([\w.]+)\s*;/m);
  return match ? match[1] ?? null : null;
}

/**
 * Extract all top-level messages with their fields.
 */
function extractMessages(content: string): ProtoMessage[] {
  const messages: ProtoMessage[] = [];
  const messageRe = /^message\s+(\w+)\s*\{/gm;

  let match;
  while ((match = messageRe.exec(content)) !== null) {
    const name = match[1]!;
    const braceStart = match.index + match[0].length - 1;
    const braceEnd = findMatchingBrace(content, braceStart);

    if (braceEnd === -1) continue;

    const body = content.slice(braceStart + 1, braceEnd);
    const fields = extractFields(body);

    messages.push({ name, fields });
  }

  return messages;
}

/**
 * Extract fields from a message body.
 * Captures the qualifier (repeated/optional/required) to determine optionality.
 */
function extractFields(body: string): ProtoField[] {
  const fields: ProtoField[] = [];
  const fieldRe =
    /^\s+(repeated\s+|optional\s+|required\s+)?(\w[\w.]*)\s+(\w+)\s*=\s*\d+/gm;

  let match;
  while ((match = fieldRe.exec(body)) !== null) {
    const qualifier = match[1]?.trim();
    // Skip nested message/enum/oneof declarations
    const type = match[2]!;
    if (['message', 'enum', 'oneof', 'reserved', 'option', 'extend'].includes(type)) {
      continue;
    }
    fields.push({ type, name: match[3]!, optional: qualifier === 'optional' });
  }

  return fields;
}

/**
 * Extract all services with their RPCs.
 */
function extractServices(content: string): ProtoService[] {
  const services: ProtoService[] = [];
  const serviceRe = /^service\s+(\w+)\s*\{/gm;

  let match;
  while ((match = serviceRe.exec(content)) !== null) {
    const name = match[1]!;
    const braceStart = match.index + match[0].length - 1;
    const braceEnd = findMatchingBrace(content, braceStart);

    if (braceEnd === -1) continue;

    const body = content.slice(braceStart + 1, braceEnd);
    const rpcs = extractRpcs(body);

    services.push({ name, rpcs });
  }

  return services;
}

/**
 * Extract RPCs from a service body.
 */
function extractRpcs(body: string): ProtoRpc[] {
  const rpcs: ProtoRpc[] = [];
  const rpcRe =
    /rpc\s+(\w+)\s*\(\s*(\w[\w.]*)\s*\)\s+returns\s+\(\s*(\w[\w.]*)\s*\)/g;

  let match;
  while ((match = rpcRe.exec(body)) !== null) {
    rpcs.push({
      name: match[1]!,
      inputType: match[2]!,
      outputType: match[3]!,
    });
  }

  return rpcs;
}

/**
 * Find the matching closing brace for an opening brace.
 * Handles nested braces.
 */
function findMatchingBrace(content: string, openIndex: number): number {
  let depth = 1;
  for (let i = openIndex + 1; i < content.length; i++) {
    if (content[i] === '{') depth++;
    else if (content[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
