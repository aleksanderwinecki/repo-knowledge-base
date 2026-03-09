import { execSync } from 'child_process';

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
 * List all files committed on a branch (from the branch tree, not working directory).
 * Uses `git ls-tree` plumbing command. Returns empty array on failure.
 */
export function listBranchFiles(
  repoPath: string,
  branch: string,
): string[] {
  try {
    const output = execSync(`git ls-tree -r --name-only ${branch}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024, // 10MB
    }).trim();
    if (!output) return [];
    return output.split('\n').filter(Boolean);
  } catch {
    // Branch or repo not readable
    return [];
  }
}

/**
 * Read a file's content from a specific branch ref using `git show`.
 * Does NOT touch the working tree. Returns null if file or branch doesn't exist.
 */
export function readBranchFile(
  repoPath: string,
  branch: string,
  filePath: string,
): string | null {
  try {
    const content = execSync(`git show "${branch}:${filePath}"`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 500 * 1024, // 500KB, matching MAX_FILE_SIZE
    });
    return content;
  } catch {
    // File or branch doesn't exist
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
