import { listBranchFiles, readBranchFile } from './git.js';

/** Extracted Elixir module data */
export interface ElixirModule {
  name: string;
  type: string;
  filePath: string;
  moduledoc: string | null;
  functions: string[];
  tableName: string | null;
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
    modulePositions.push({ name: match[1], start: match.index });
  }

  for (let i = 0; i < modulePositions.length; i++) {
    const { name, start } = modulePositions[i];
    const end =
      i + 1 < modulePositions.length
        ? modulePositions[i + 1].start
        : content.length;
    const moduleContent = content.slice(start, end);

    const moduledoc = extractModuledoc(moduleContent);
    const functions = extractPublicFunctions(moduleContent);
    const tableName = extractSchemaTable(moduleContent);
    const type = tableName ? 'schema' : classifyModule(name);

    modules.push({
      name,
      type,
      filePath,
      moduledoc,
      functions,
      tableName,
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
    return heredocMatch[1].trim() || null;
  }

  // Single-line: @moduledoc "..."
  const singleMatch = content.match(/@moduledoc\s+"([^"]*)"/);
  if (singleMatch) {
    return singleMatch[1].trim() || null;
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
    const args = match[2].trim();
    const arity = args ? args.split(',').length : 0;
    functionSet.add(`${fname}/${arity}`);
  }

  // Match zero-arity functions without parens
  while ((match = defNoParenRe.exec(content)) !== null) {
    const fname = match[1];
    // Don't add if we already have it from the parens match
    if (!Array.from(functionSet).some((f) => f.startsWith(`${fname}/`))) {
      functionSet.add(`${fname}/0`);
    }
  }

  return Array.from(functionSet).sort();
}

/**
 * Extract Ecto schema table name.
 */
function extractSchemaTable(content: string): string | null {
  const match = content.match(/schema\s+"(\w+)"/);
  return match ? match[1] : null;
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
