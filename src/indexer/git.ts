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
    return null;
  }
}

/**
 * Get files changed between a commit and HEAD.
 * Returns categorized lists of added, modified, and deleted files.
 * Returns empty lists if git diff fails (e.g., commit was garbage collected).
 */
export function getChangedFiles(
  repoPath: string,
  sinceCommit: string,
): { added: string[]; modified: string[]; deleted: string[] } {
  try {
    const output = execSync(`git diff --name-status ${sinceCommit}..HEAD`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const added: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];

    if (!output) {
      return { added, modified, deleted };
    }

    for (const line of output.split('\n')) {
      if (!line.trim()) continue;

      const [status, ...pathParts] = line.split('\t');
      const filePath = pathParts.join('\t');

      if (!filePath) continue;

      // Handle rename status (R followed by similarity percentage)
      if (status?.startsWith('A')) {
        added.push(filePath);
      } else if (status?.startsWith('M')) {
        modified.push(filePath);
      } else if (status?.startsWith('D')) {
        deleted.push(filePath);
      } else if (status?.startsWith('R')) {
        // Rename: old path is deleted, new path is added
        // pathParts[0] is old name, pathParts[1] is new name
        if (pathParts[0]) deleted.push(pathParts[0]);
        if (pathParts[1]) added.push(pathParts[1]);
      }
    }

    return { added, modified, deleted };
  } catch {
    return { added: [], modified: [], deleted: [] };
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
    return false;
  }
}

/**
 * Resolve the default branch for a repo.
 * Tries main first, falls back to master, returns null if neither exists.
 * Hard-coded main/master only — non-standard branch names are not supported.
 */
export function resolveDefaultBranch(repoPath: string): string | null {
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
    return null;
  }
}

/**
 * Get files changed between a commit and a branch tip.
 * Uses `git diff --name-status` with the same parsing logic as getChangedFiles.
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
    return { added: [], modified: [], deleted: [] };
  }
}
