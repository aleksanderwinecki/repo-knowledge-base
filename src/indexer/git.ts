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
