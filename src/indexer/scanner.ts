import fs from 'fs';
import path from 'path';

/** Project file markers that indicate a directory is a real project repo */
const PROJECT_MARKERS = ['mix.exs', 'package.json', 'Gemfile', 'Cargo.toml', 'go.mod'];

/** Directories to skip during scanning */
const SKIP_DIRS = ['node_modules', '.git', '_build', 'deps', 'vendor', 'dist', '.elixir_ls'];

/**
 * Discover all repos under a root directory.
 * A directory is considered a repo if it has .git AND at least one project file.
 * Only scans immediate children of rootDir (not recursive).
 */
export function discoverRepos(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    throw new Error(`Root directory does not exist: ${rootDir}`);
  }

  const stat = fs.statSync(rootDir);
  if (!stat.isDirectory()) {
    throw new Error(`Root path is not a directory: ${rootDir}`);
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const repos: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || SKIP_DIRS.includes(entry.name)) {
      continue;
    }

    const dirPath = path.join(rootDir, entry.name);

    // Check for .git (directory or file for submodules)
    const hasGit = fs.existsSync(path.join(dirPath, '.git'));
    if (!hasGit) continue;

    // Check for at least one project file marker (root or src/ subdirectory)
    const hasProjectFile = PROJECT_MARKERS.some(
      (marker) =>
        fs.existsSync(path.join(dirPath, marker)) ||
        fs.existsSync(path.join(dirPath, 'src', marker)),
    );

    if (hasProjectFile) {
      repos.push(dirPath);
    }
  }

  return repos.sort();
}
