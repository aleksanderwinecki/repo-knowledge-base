import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

/**
 * Get the current HEAD commit SHA for a repo.
 * Returns null if the directory is not a git repo or git fails.
 */
export function getCurrentCommit(repoPath: string): string | null {
  try {
    const sha = execSync('git rev-parse HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return sha || null;
  } catch {
    // Expected: not a git repo or git unavailable
    return null;
  }
}

/**
 * Check if a commit SHA is reachable (exists) in the repo.
 * Returns false if the commit was garbage collected or never existed.
 */
export function isCommitReachable(
  repoPath: string,
  commitSha: string,
): boolean {
  try {
    execSync(`git cat-file -t ${commitSha}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    // Expected: commit GC'd or invalid SHA
    return false;
  }
}

/**
 * Resolve the default branch for a repo.
 * Uses `gh repo view` to detect the actual default branch from GitHub,
 * falls back to main/master probing for repos without a GitHub remote.
 */
export function resolveDefaultBranch(repoPath: string): string | null {
  // Try gh CLI first — knows the real default branch
  try {
    const result = execSync('gh repo view --json defaultBranchRef --jq .defaultBranchRef.name', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 5000,
    }).trim();
    if (result) {
      // Verify the branch exists locally
      try {
        execSync(`git rev-parse --verify refs/heads/${result}`, {
          cwd: repoPath,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return result;
      } catch {
        // Branch from GitHub not available locally, fall through
      }
    }
  } catch {
    // gh not available or no GitHub remote, fall through
  }

  // Fallback: try main, then master
  try {
    execSync('git rev-parse --verify refs/heads/main', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 'main';
  } catch {
    // main doesn't exist, try master
  }

  try {
    execSync('git rev-parse --verify refs/heads/master', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 'master';
  } catch {
    // master doesn't exist either
    return null;
  }
}

/**
 * Get the commit SHA for a named branch.
 * Returns the full 40-char SHA or null if the branch doesn't exist.
 */
export function getBranchCommit(
  repoPath: string,
  branch: string,
): string | null {
  try {
    const sha = execSync(`git rev-parse refs/heads/${branch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return sha || null;
  } catch {
    // Branch doesn't exist
    return null;
  }
}

/**
 * Fetch from origin and reset the local default branch to match remote.
 * Safe for repos on feature branches: checks for dirty working tree before checkout.
 * Returns { refreshed: true } on success, { refreshed: false, error } on failure.
 */
export function gitRefresh(
  repoPath: string,
  branch: string,
): { refreshed: boolean; error?: string } {
  try {
    // Fetch latest from remote
    execSync('git fetch origin', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30000,
    });

    // Check current branch
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (currentBranch !== branch) {
      // Not on default branch -- check for dirty working tree
      const status = execSync('git status --porcelain', {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();

      if (status) {
        return { refreshed: false, error: 'dirty working tree, skipping checkout' };
      }

      execSync(`git checkout ${branch}`, {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    // Fast-forward to remote
    execSync(`git reset --hard origin/${branch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    return { refreshed: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { refreshed: false, error: msg };
  }
}

/**
 * Get files changed between a commit and a branch tip.
 * Uses `git diff --name-status` to categorize changes by status.
 * Returns empty lists on failure.
 */
export function getChangedFilesSinceBranch(
  repoPath: string,
  sinceCommit: string,
  branch: string,
): { added: string[]; modified: string[]; deleted: string[] } {
  try {
    const output = execSync(
      `git diff --name-status ${sinceCommit}..${branch}`,
      {
        cwd: repoPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    ).trim();

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    if (!output) {
      return { added, modified, deleted };
    }

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;

      const [status, ...pathParts] = line.split('\t');
      const changedPath = pathParts.join('\t');

      if (!changedPath) continue;

      if (status?.startsWith('A')) {
        added.push(changedPath);
      } else if (status?.startsWith('M')) {
        modified.push(changedPath);
      } else if (status?.startsWith('D')) {
        deleted.push(changedPath);
      } else if (status?.startsWith('R')) {
        if (pathParts[0]) deleted.push(pathParts[0]);
        if (pathParts[1]) added.push(pathParts[1]);
      }
    }

    return { added, modified, deleted };
  } catch {
    // Expected: sinceCommit unreachable or GC'd
    return { added: [], modified: [], deleted: [] };
  }
}

/** Directories to skip when walking the working tree */
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '_build',
  'deps',
  'vendor',
  'dist',
  '.elixir_ls',
]);

/** Max file size for readWorkingTreeFile (500KB) */
const MAX_READ_SIZE = 500 * 1024;

/**
 * List all files in the repo working tree, skipping common non-source directories.
 * Returns relative paths with forward-slash separators.
 * Returns empty array if path doesn't exist or isn't readable.
 */
export function listWorkingTreeFiles(repoPath: string): string[] {
  try {
    const results: string[] = [];
    const stack: string[] = [''];

    while (stack.length > 0) {
      const rel = stack.pop()!;
      const abs = rel ? path.join(repoPath, rel) : repoPath;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (SKIP_DIRS.has(entry.name)) continue;
          const dirRel = rel ? `${rel}/${entry.name}` : entry.name;
          stack.push(dirRel);
        } else if (entry.isFile()) {
          const fileRel = rel ? `${rel}/${entry.name}` : entry.name;
          results.push(fileRel);
        }
      }
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Read a file from the repo working tree via filesystem.
 * Returns null if file doesn't exist, is unreadable, or exceeds 500KB.
 */
export function readWorkingTreeFile(repoPath: string, filePath: string): string | null {
  try {
    const fullPath = path.join(repoPath, filePath);
    const stat = fs.statSync(fullPath);
    if (stat.size > MAX_READ_SIZE) return null;
    return fs.readFileSync(fullPath, 'utf-8');
  } catch {
    return null;
  }
}
