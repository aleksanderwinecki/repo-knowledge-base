import fs from 'fs';
import path from 'path';
import { getCurrentCommit, getBranchCommit, readBranchFile, listBranchFiles } from './git.js';

/** Metadata extracted from a single repo */
export interface RepoMetadata {
  name: string;
  path: string;
  description: string | null;
  techStack: string[];
  keyFiles: string[];
  currentCommit: string | null;
  defaultBranch: string | null;
}

/** Key Elixir deps to detect in mix.exs */
const ELIXIR_KEY_DEPS = [
  'phoenix',
  'ecto',
  'absinthe',
  'broadway',
  'oban',
  'commanded',
  'eventstore',
  'grpc',
];

/** Key Node.js deps to detect in package.json */
const NODE_KEY_DEPS = [
  'express',
  'fastify',
  'next',
  'react',
  'vue',
  'angular',
  'nestjs',
];

/** Hardcoded key files/dirs to check for */
const KEY_FILE_CANDIDATES = [
  'README.md',
  'CLAUDE.md',
  'AGENTS.md',
  'mix.exs',
  'package.json',
  'Gemfile',
  'Cargo.toml',
  'go.mod',
];

/** Top-level directories of interest */
const KEY_DIR_CANDIDATES = [
  'lib',
  'priv',
  'test',
  'tests',
  'proto',
  'src',
  'apps',
  'config',
];

/**
 * Extract metadata from a single repo.
 * When branch is provided, reads from git branch (not working tree).
 * When branch is null, falls back to filesystem-based reading.
 */
export function extractMetadata(repoPath: string, branch?: string | null): RepoMetadata {
  const name = path.basename(repoPath);

  if (branch) {
    // Branch-aware: read from git
    const description = extractDescriptionFromBranch(repoPath, branch);
    const techStack = detectTechStackFromBranch(repoPath, branch);
    const keyFiles = detectKeyFilesFromBranch(repoPath, branch);
    const currentCommit = getBranchCommit(repoPath, branch);

    return { name, path: repoPath, description, techStack, keyFiles, currentCommit, defaultBranch: branch };
  }

  // Fallback: filesystem-based (branch is null/undefined)
  const description = extractDescription(repoPath);
  const techStack = detectTechStack(repoPath);
  const keyFiles = detectKeyFiles(repoPath);
  const currentCommit = getCurrentCommit(repoPath);

  return { name, path: repoPath, description, techStack, keyFiles, currentCommit, defaultBranch: branch ?? null };
}

/**
 * Extract a description from README.md or CLAUDE.md.
 * Reads the first paragraph after the title heading.
 */
function extractDescription(repoPath: string): string | null {
  // Try README.md first, then CLAUDE.md
  for (const filename of ['README.md', 'CLAUDE.md']) {
    const filePath = path.join(repoPath, filename);
    if (!fs.existsSync(filePath)) continue;

    try {
      const content = fs.readFileSync(filePath, 'utf-8').slice(0, 2000);
      const desc = parseFirstParagraph(content);
      if (desc) return desc;
    } catch {
      // README not readable -- skip
      continue;
    }
  }

  return null;
}

/**
 * Parse the first meaningful paragraph from markdown content.
 * Skips the title line (# ...) and badges/images, takes text until next heading or blank line.
 */
function parseFirstParagraph(content: string): string | null {
  const lines = content.split('\n');
  let foundTitle = false;
  const paragraphLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines before/after title
    if (!trimmed) {
      if (foundTitle && paragraphLines.length > 0) {
        // End of paragraph
        break;
      }
      continue;
    }

    // Skip title heading
    if (trimmed.startsWith('# ') && !foundTitle) {
      foundTitle = true;
      continue;
    }

    // Stop at next heading
    if (trimmed.startsWith('##')) {
      break;
    }

    // Skip badges, images, HTML tags
    if (
      trimmed.startsWith('![') ||
      trimmed.startsWith('[![') ||
      trimmed.startsWith('<') ||
      trimmed.startsWith('---')
    ) {
      continue;
    }

    // Collect paragraph text
    if (foundTitle || !lines.some((l) => l.trim().startsWith('# '))) {
      paragraphLines.push(trimmed);
    }
  }

  const result = paragraphLines.join(' ').trim();
  return result || null;
}

/**
 * Detect the tech stack from project files and dependencies.
 */
function detectTechStack(repoPath: string): string[] {
  const stack: string[] = [];

  // Elixir
  const mixPath = path.join(repoPath, 'mix.exs');
  if (fs.existsSync(mixPath)) {
    stack.push('elixir');
    try {
      const mixContent = fs.readFileSync(mixPath, 'utf-8');
      for (const dep of ELIXIR_KEY_DEPS) {
        if (new RegExp(`\\{:${dep},`).test(mixContent)) {
          stack.push(dep);
        }
      }
    } catch {
      /* corrupted mix.exs — still report elixir */
    }
  }

  // Node.js
  const pkgPath = path.join(repoPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    stack.push('node');
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps: Record<string, string> = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      for (const dep of NODE_KEY_DEPS) {
        if (allDeps[dep] || allDeps[`@${dep}/core`]) {
          stack.push(dep);
        }
      }
    } catch {
      /* corrupted package.json — still report node */
    }
  }

  // Ruby
  if (fs.existsSync(path.join(repoPath, 'Gemfile'))) {
    stack.push('ruby');
  }

  // Rust
  if (fs.existsSync(path.join(repoPath, 'Cargo.toml'))) {
    stack.push('rust');
  }

  // Go
  if (fs.existsSync(path.join(repoPath, 'go.mod'))) {
    stack.push('go');
  }

  return stack;
}

/**
 * Detect key files and directories present in the repo.
 */
function detectKeyFiles(repoPath: string): string[] {
  const keyFiles: string[] = [];

  // Check hardcoded key files
  for (const file of KEY_FILE_CANDIDATES) {
    if (fs.existsSync(path.join(repoPath, file))) {
      keyFiles.push(file);
    }
  }

  // Check top-level directories
  for (const dir of KEY_DIR_CANDIDATES) {
    const dirPath = path.join(repoPath, dir);
    if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
      keyFiles.push(`${dir}/`);
    }
  }

  return keyFiles;
}

// ---- Branch-aware variants (read from git, not working tree) ----

/**
 * Extract description from README.md or CLAUDE.md on a git branch.
 */
function extractDescriptionFromBranch(repoPath: string, branch: string): string | null {
  for (const filename of ['README.md', 'CLAUDE.md']) {
    const content = readBranchFile(repoPath, branch, filename);
    if (!content) continue;

    const desc = parseFirstParagraph(content.slice(0, 2000));
    if (desc) return desc;
  }
  return null;
}

/**
 * Detect tech stack from project files on a git branch.
 */
function detectTechStackFromBranch(repoPath: string, branch: string): string[] {
  const stack: string[] = [];

  // Elixir
  const mixContent = readBranchFile(repoPath, branch, 'mix.exs');
  if (mixContent !== null) {
    stack.push('elixir');
    for (const dep of ELIXIR_KEY_DEPS) {
      if (new RegExp(`\\{:${dep},`).test(mixContent)) {
        stack.push(dep);
      }
    }
  }

  // Node.js
  const pkgContent = readBranchFile(repoPath, branch, 'package.json');
  if (pkgContent !== null) {
    stack.push('node');
    try {
      const pkg = JSON.parse(pkgContent);
      const allDeps: Record<string, string> = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      for (const dep of NODE_KEY_DEPS) {
        if (allDeps[dep] || allDeps[`@${dep}/core`]) {
          stack.push(dep);
        }
      }
    } catch {
      /* corrupted package.json -- still report node */
    }
  }

  // Ruby
  if (readBranchFile(repoPath, branch, 'Gemfile') !== null) {
    stack.push('ruby');
  }

  // Rust
  if (readBranchFile(repoPath, branch, 'Cargo.toml') !== null) {
    stack.push('rust');
  }

  // Go
  if (readBranchFile(repoPath, branch, 'go.mod') !== null) {
    stack.push('go');
  }

  return stack;
}

/**
 * Detect key files and directories from a git branch tree.
 */
function detectKeyFilesFromBranch(repoPath: string, branch: string): string[] {
  const branchFiles = listBranchFiles(repoPath, branch);
  const keyFiles: string[] = [];

  // Check hardcoded key files (exact match in branch tree)
  for (const file of KEY_FILE_CANDIDATES) {
    if (branchFiles.includes(file)) {
      keyFiles.push(file);
    }
  }

  // Check top-level directories (any file starting with dir/ means dir exists)
  for (const dir of KEY_DIR_CANDIDATES) {
    const prefix = `${dir}/`;
    if (branchFiles.some((f) => f.startsWith(prefix))) {
      keyFiles.push(prefix);
    }
  }

  return keyFiles;
}
