import { listBranchFiles, readBranchFile } from './git.js';

/** Extracted Elixir module data */
export interface ElixirModule {
  name: string;
  type: string;
  filePath: string;
  moduledoc: string | null;
  functions: string[];
  tableName: string | null;
  schemaFields: { name: string; type: string }[];
  associations: { kind: string; name: string; target: string }[];
  absintheTypes: { kind: string; name: string }[];
  grpcStubs: string[];
}

/** Max file size to process (500KB) */
const MAX_FILE_SIZE = 500 * 1024;

/**
 * Lib path prefixes where .ex files are expected.
 * Matches: lib/, src/lib/, apps/X/lib/, src/apps/X/lib/
 */
const LIB_PATH_PATTERNS = [
  /^lib\//,
  /^src\/lib\//,
  /^apps\/[^/]+\/lib\//,
  /^src\/apps\/[^/]+\/lib\//,
];

/**
 * Extract all Elixir modules from a repo by reading from a git branch.
 * Scans lib/ and apps/star/lib/ for .ex files (umbrella apps).
 */
export function extractElixirModules(repoPath: string, branch: string): ElixirModule[] {
  const allFiles = listBranchFiles(repoPath, branch);
  const modules: ElixirModule[] = [];

  // Filter for .ex files under lib paths
  const exFiles = allFiles.filter(
    (f) => f.endsWith('.ex') && LIB_PATH_PATTERNS.some((p) => p.test(f)),
  );

  for (const filePath of exFiles) {
    try {
      const content = readBranchFile(repoPath, branch, filePath);
      if (!content || content.length > MAX_FILE_SIZE) continue;

      const parsed = parseElixirFile(filePath, content);
      modules.push(...parsed);
    } catch {
      // Skip unreadable files
    }
  }

  return modules;
}

/**
 * Parse an Elixir file and extract all module definitions.
 */
export function parseElixirFile(
  filePath: string,
  content: string,
): ElixirModule[] {
  const modules: ElixirModule[] = [];
  const defmoduleRe = /defmodule\s+([\w.]+)\s+do\b/g;

  // Find all defmodule positions
  const modulePositions: { name: string; start: number }[] = [];
  let match;
  while ((match = defmoduleRe.exec(content)) !== null) {
    const name = match[1];
    if (!name) continue;
    modulePositions.push({ name, start: match.index });
  }

  for (let i = 0; i < modulePositions.length; i++) {
    const { name, start } = modulePositions[i]!;
    const end =
      i + 1 < modulePositions.length
        ? modulePositions[i + 1]!.start
        : content.length;
    const moduleContent = content.slice(start, end);

    const moduledoc = extractModuledoc(moduleContent);
    const functions = extractPublicFunctions(moduleContent);
    const tableName = extractSchemaTable(moduleContent);
    const { schemaFields, associations } = extractSchemaDetails(moduleContent);
    const absintheTypes = extractAbsintheTypes(moduleContent);
    const grpcStubs = extractGrpcStubs(moduleContent);
    const type = tableName ? 'schema' : classifyModule(name);

    modules.push({
      name,
      type,
      filePath,
      moduledoc,
      functions,
      tableName,
      schemaFields,
      associations,
      absintheTypes,
      grpcStubs,
    });
  }

  return modules;
}

/**
 * Extract @moduledoc content from module body.
 */
function extractModuledoc(content: string): string | null {
  // Check for @moduledoc false
  if (/@moduledoc\s+false\b/.test(content)) {
    return null;
  }

  // Heredoc: @moduledoc """..."""
  const heredocMatch = content.match(/@moduledoc\s+"""([\s\S]*?)"""/);
  if (heredocMatch) {
    return heredocMatch[1]?.trim() || null;
  }

  // Single-line: @moduledoc "..."
  const singleMatch = content.match(/@moduledoc\s+"([^"]*)"/);
  if (singleMatch) {
    return singleMatch[1]?.trim() || null;
  }

  return null;
}

/**
 * Extract public function signatures from module body.
 * Returns deduplicated list of "name/arity" strings.
 */
function extractPublicFunctions(content: string): string[] {
  const functionSet = new Set<string>();
  const defRe = /^\s+def\s+(\w+)\(([^)]*)\)/gm;
  // Also match def with no parens (arity 0)
  const defNoParenRe = /^\s+def\s+(\w+)\s*(?:,|do\b|when\b)/gm;

  let match;
  while ((match = defRe.exec(content)) !== null) {
    const fname = match[1];
    if (!fname) continue;
    const args = match[2]?.trim() ?? '';
    const arity = args ? args.split(',').length : 0;
    functionSet.add(`${fname}/${arity}`);
  }

  // Match zero-arity functions without parens
  while ((match = defNoParenRe.exec(content)) !== null) {
    const fname = match[1]!;
    // Don't add if we already have it from the parens match
    if (!Array.from(functionSet).some((f) => f.startsWith(`${fname}/`))) {
      functionSet.add(`${fname}/0`);
    }
  }

  return Array.from(functionSet).sort();
}

/**
 * Extract Ecto schema fields and associations from a schema block.
 * Only matches `schema "table" do` blocks -- skips embedded_schema.
 * Uses line-by-line extraction to avoid nested do...end pitfalls.
 */
function extractSchemaDetails(
  moduleContent: string,
): { schemaFields: { name: string; type: string }[]; associations: { kind: string; name: string; target: string }[] } {
  const empty = { schemaFields: [], associations: [] };

  // Match schema "table_name" do ... but NOT embedded_schema do
  const schemaStart = moduleContent.match(/\bschema\s+"(\w+)"\s+do\b/);
  if (!schemaStart) return empty;

  // Extract lines after the schema do declaration
  const startIdx = schemaStart.index! + schemaStart[0].length;
  const lines = moduleContent.slice(startIdx).split('\n');

  const schemaFields: { name: string; type: string }[] = [];
  const associations: { kind: string; name: string; target: string }[] = [];

  const fieldRe = /field[( ]+:(\w+),\s*:?(\w[\w.]*)/;
  const assocRe = /(belongs_to|has_many|has_one|many_to_many)[( ]+:(\w+),\s*(\w[\w.]*)/;

  // Track nesting depth to stop at the schema block's closing `end`
  let depth = 1;
  for (const line of lines) {
    const trimmed = line.trim();

    // Track nested do...end blocks
    if (/\bdo\b/.test(trimmed)) depth++;
    if (/^\s*end\b/.test(line) || trimmed === 'end') depth--;
    if (depth <= 0) break;

    const fieldMatch = trimmed.match(fieldRe);
    if (fieldMatch) {
      schemaFields.push({ name: fieldMatch[1]!, type: fieldMatch[2]! });
      continue;
    }

    const assocMatch = trimmed.match(assocRe);
    if (assocMatch) {
      associations.push({ kind: assocMatch[1]!, name: assocMatch[2]!, target: assocMatch[3]! });
    }
  }

  return { schemaFields, associations };
}

/**
 * Extract Ecto schema table name.
 */
function extractSchemaTable(content: string): string | null {
  const match = content.match(/schema\s+"(\w+)"/);
  return match ? match[1] ?? null : null;
}

/**
 * Extract Absinthe GraphQL macro definitions from module content.
 * Detects object, input_object, query, and mutation macros.
 */
function extractAbsintheTypes(moduleContent: string): { kind: string; name: string }[] {
  const types: { kind: string; name: string }[] = [];

  // Named macros: object :name do, input_object :name do
  const namedRe = /(object|input_object)\s+:(\w+)\s+do\b/g;
  let m;
  while ((m = namedRe.exec(moduleContent)) !== null) {
    types.push({ kind: m[1]!, name: m[2]! });
  }

  // Root macros: query do, mutation do (no atom name)
  const rootRe = /(query|mutation)\s+do\b/g;
  while ((m = rootRe.exec(moduleContent)) !== null) {
    types.push({ kind: m[1]!, name: m[1]! });
  }

  return types;
}

/**
 * Extract gRPC stub references from module content.
 * Pattern 1: use RpcClient.Client/MockableRpcClient with stub: keyword
 * Pattern 2: direct ServiceName.Stub.method_name() calls
 * Returns deduplicated stub module names.
 */
function extractGrpcStubs(moduleContent: string): string[] {
  const stubs = new Set<string>();

  // Pattern 1: use RpcClient.Client, ... stub: Module.Stub
  // The use statement may span multiple lines, so we search for stub: after RpcClient
  const rpcClientRe = /use\s+RpcClient\.(?:Client|MockableRpcClient)[\s\S]*?stub:\s*(\w+(?:\.\w+)*)/g;
  let m;
  while ((m = rpcClientRe.exec(moduleContent)) !== null) {
    stubs.add(m[1]!);
  }

  // Pattern 2: ServiceName.Stub.method_name(
  const stubCallRe = /(\w+(?:\.\w+)*)\.Stub\.(\w+)\s*\(/g;
  while ((m = stubCallRe.exec(moduleContent)) !== null) {
    stubs.add(`${m[1]!}.Stub`);
  }

  return Array.from(stubs);
}

/**
 * Classify module type based on naming conventions.
 */
function classifyModule(name: string): string {
  // Context modules
  if (/Context$/.test(name) || /\.Contexts?\./.test(name) || /\.Context$/.test(name)) {
    return 'context';
  }

  // Command modules
  if (/\.Commands?\./.test(name) || /Command$/.test(name)) {
    return 'command';
  }

  // Query modules
  if (/\.Queries?\./.test(name) || /Query$/.test(name)) {
    return 'query';
  }

  return 'module';
}
