import { listBranchFiles, readBranchFile } from './git.js';

/** A parsed GraphQL type/input/enum/interface/union/scalar definition */
export interface GraphqlType {
  kind: string;
  name: string;
  body: string;
  extended: boolean;
}

/** A parsed GraphQL field from a type/input/interface body */
export interface GraphqlField {
  name: string;
  type: string;  // Full type expression including !, [], [!], etc.
}

/** Complete GraphQL file parse result */
export interface GraphqlDefinition {
  filePath: string;
  types: GraphqlType[];
}

/** Max file size to process (500KB) */
const MAX_FILE_SIZE = 500 * 1024;

/**
 * Extract all GraphQL definitions from a repo by reading from a git branch.
 * Scans the entire branch tree for .graphql files.
 */
export function extractGraphqlDefinitions(repoPath: string, branch: string): GraphqlDefinition[] {
  const allFiles = listBranchFiles(repoPath, branch);
  const graphqlFiles = allFiles.filter((f) => f.endsWith('.graphql'));
  const definitions: GraphqlDefinition[] = [];

  for (const filePath of graphqlFiles) {
    try {
      const content = readBranchFile(repoPath, branch, filePath);
      if (!content || content.length > MAX_FILE_SIZE) continue;

      const parsed = parseGraphqlFile(filePath, content);
      if (parsed.types.length > 0) {
        definitions.push(parsed);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return definitions;
}

/**
 * Parse a single GraphQL SDL file.
 * Extracts top-level type, input, enum, interface, union, and scalar definitions.
 */
export function parseGraphqlFile(filePath: string, content: string): GraphqlDefinition {
  const types: GraphqlType[] = [];

  // Extract definitions with braces: type, input, enum, interface
  // Handles optional "extend" prefix and optional "implements X & Y"
  const braceRe = /^(extend\s+)?(type|input|enum|interface)\s+(\w+)(?:\s+implements\s+[\w\s&]+)?\s*\{/gm;

  let match;
  while ((match = braceRe.exec(content)) !== null) {
    const extended = !!match[1];
    const kind = match[2]!;
    const name = match[3]!;
    const braceStart = match.index + match[0].length - 1;
    const braceEnd = findMatchingBrace(content, braceStart);

    if (braceEnd === -1) continue;

    const body = content.slice(braceStart + 1, braceEnd).trim();

    types.push({ kind, name, body, extended });
  }

  // Extract union definitions: union Name = Type1 | Type2
  const unionRe = /^(extend\s+)?union\s+(\w+)\s*=\s*(.+)/gm;
  while ((match = unionRe.exec(content)) !== null) {
    const extended = !!match[1];
    const name = match[2]!;
    const body = match[3]!.trim();
    types.push({ kind: 'union', name, body, extended });
  }

  // Extract scalar definitions: scalar Name
  const scalarRe = /^scalar\s+(\w+)/gm;
  while ((match = scalarRe.exec(content)) !== null) {
    const name = match[1]!;
    types.push({ kind: 'scalar', name, body: '', extended: false });
  }

  return { filePath, types };
}

/**
 * Parse field declarations from a GraphQL type/input/interface body.
 * Skips enum values (no colon), comment lines (# prefix), and empty lines.
 * Only use for type, input, and interface kinds -- not enum, union, or scalar.
 */
export function parseGraphqlFields(body: string): GraphqlField[] {
  const fields: GraphqlField[] = [];
  const fieldRe = /^\s*(\w+)(?:\([^)]*\))?\s*:\s*(\[?\w+!?\]?!?)/gm;
  let match;
  while ((match = fieldRe.exec(body)) !== null) {
    fields.push({ name: match[1]!, type: match[2]! });
  }
  return fields;
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
