import fs from 'fs';
import path from 'path';

/** Extracted Elixir module data */
export interface ElixirModule {
  name: string;
  type: string;
  filePath: string;
  moduledoc: string | null;
  functions: string[];
  tableName: string | null;
}

/** Directories to skip when scanning for .ex files */
const SKIP_DIRS = new Set([
  'node_modules',
  '_build',
  'deps',
  'vendor',
  'dist',
  '.elixir_ls',
  '.git',
]);

/** Max file size to process (500KB) */
const MAX_FILE_SIZE = 500 * 1024;

/**
 * Extract all Elixir modules from a repo.
 * Scans lib/ and apps/star/lib/ for .ex files (umbrella apps).
 */
export function extractElixirModules(repoPath: string): ElixirModule[] {
  const exFiles = findExFiles(repoPath);
  const modules: ElixirModule[] = [];

  for (const filePath of exFiles) {
    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) continue;

      const content = fs.readFileSync(filePath, 'utf-8');
      const relativePath = path.relative(repoPath, filePath);
      const parsed = parseElixirFile(relativePath, content);
      modules.push(...parsed);
    } catch {
      // Skip unreadable files
    }
  }

  return modules;
}

/**
 * Find all .ex files under lib/ and umbrella apps/app/lib/ directories.
 */
function findExFiles(repoPath: string): string[] {
  const files: string[] = [];

  // Standard lib/ and src/lib/ directories
  for (const libDir of [
    path.join(repoPath, 'lib'),
    path.join(repoPath, 'src', 'lib'),
  ]) {
    if (fs.existsSync(libDir)) {
      collectFiles(libDir, '.ex', files);
    }
  }

  // Umbrella apps: apps/*/lib/ and src/apps/*/lib/
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
