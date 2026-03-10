import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  getCurrentCommit,
  isCommitReachable,
  resolveDefaultBranch,
  getBranchCommit,
  listWorkingTreeFiles,
  readWorkingTreeFile,
  getChangedFilesSinceBranch,
  gitRefresh,
} from '../../src/indexer/git.js';

let tmpDir: string;

function initGitRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: dir, stdio: 'pipe' });
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-git-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getCurrentCommit', () => {
  it('returns HEAD SHA for a git repo', () => {
    initGitRepo(tmpDir);
    const sha = getCurrentCommit(tmpDir);

    expect(sha).toBeTruthy();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('returns null for non-git directory', () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-plain-'));
    try {
      const sha = getCurrentCommit(plainDir);
      expect(sha).toBeNull();
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });
});

describe('isCommitReachable', () => {
  it('returns true for existing commit', () => {
    initGitRepo(tmpDir);
    const sha = getCurrentCommit(tmpDir)!;

    expect(isCommitReachable(tmpDir, sha)).toBe(true);
  });

  it('returns false for non-existent commit', () => {
    initGitRepo(tmpDir);

    expect(
      isCommitReachable(tmpDir, 'deadbeef0000deadbeef0000deadbeef0000dead'),
    ).toBe(false);
  });

  it('returns false for non-git directory', () => {
    const plainDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-plain-'));
    try {
      expect(isCommitReachable(plainDir, 'abc123')).toBe(false);
    } finally {
      fs.rmSync(plainDir, { recursive: true, force: true });
    }
  });
});

/**
 * Helper: create a temp git repo on a specified branch with files committed.
 */
function createRepoWithBranch(
  branchName: string,
  files: Record<string, string>,
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-branch-test-'));
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });

  // Write files
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  execSync('git add -A', { cwd: dir, stdio: 'pipe' });
  execSync('git commit -m "initial commit"', { cwd: dir, stdio: 'pipe' });

  // Rename the default branch to the desired name
  execSync(`git branch -M ${branchName}`, { cwd: dir, stdio: 'pipe' });

  return dir;
}

describe('resolveDefaultBranch', () => {
  it('returns "main" for repo with main branch', () => {
    const dir = createRepoWithBranch('main', { 'README.md': '# hello' });
    try {
      expect(resolveDefaultBranch(dir)).toBe('main');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns "master" for repo with only master branch', () => {
    const dir = createRepoWithBranch('master', { 'README.md': '# hello' });
    try {
      expect(resolveDefaultBranch(dir)).toBe('master');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for repo with non-standard branch name', () => {
    const dir = createRepoWithBranch('develop', { 'README.md': '# hello' });
    try {
      expect(resolveDefaultBranch(dir)).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prefers main over master when both exist', () => {
    const dir = createRepoWithBranch('main', { 'README.md': '# hello' });
    try {
      // Create a master branch alongside main
      execSync('git branch master', { cwd: dir, stdio: 'pipe' });
      expect(resolveDefaultBranch(dir)).toBe('main');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('getBranchCommit', () => {
  it('returns 40-char SHA for named branch', () => {
    const dir = createRepoWithBranch('main', { 'a.txt': 'content' });
    try {
      const sha = getBranchCommit(dir, 'main');
      expect(sha).toBeTruthy();
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for non-existent branch', () => {
    const dir = createRepoWithBranch('main', { 'a.txt': 'content' });
    try {
      expect(getBranchCommit(dir, 'nonexistent')).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('listWorkingTreeFiles', () => {
  it('returns all files from working tree recursively', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-wt-test-'));
    try {
      fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'src/app.ts'), 'console.log("hi")');
      fs.writeFileSync(path.join(dir, 'README.md'), '# Hello');
      fs.writeFileSync(path.join(dir, 'lib/utils.ts'), 'export {}');

      const files = listWorkingTreeFiles(dir);
      expect(files).toContain('src/app.ts');
      expect(files).toContain('README.md');
      expect(files).toContain('lib/utils.ts');
      expect(files).toHaveLength(3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips .git, node_modules, _build directories', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-wt-skip-'));
    try {
      fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
      fs.mkdirSync(path.join(dir, '_build'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.git/config'), 'git stuff');
      fs.writeFileSync(path.join(dir, 'node_modules/pkg.js'), 'module');
      fs.writeFileSync(path.join(dir, '_build/output'), 'compiled');
      fs.writeFileSync(path.join(dir, 'src.txt'), 'source');

      const files = listWorkingTreeFiles(dir);
      expect(files).toEqual(['src.txt']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty array for non-existent path', () => {
    expect(listWorkingTreeFiles('/tmp/nonexistent-rkb-path-xyz')).toEqual([]);
  });
});

describe('readWorkingTreeFile', () => {
  it('reads file content from working tree', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-wt-read-'));
    try {
      fs.writeFileSync(path.join(dir, 'hello.txt'), 'world');
      expect(readWorkingTreeFile(dir, 'hello.txt')).toBe('world');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for non-existent file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-wt-nofile-'));
    try {
      expect(readWorkingTreeFile(dir, 'nope.txt')).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for files over 500KB', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-wt-big-'));
    try {
      // Create a file just over 500KB
      const bigContent = 'x'.repeat(501 * 1024);
      fs.writeFileSync(path.join(dir, 'big.txt'), bigContent);
      expect(readWorkingTreeFile(dir, 'big.txt')).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('getChangedFilesSinceBranch', () => {
  it('returns added/modified/deleted files between commit and branch tip', () => {
    const dir = createRepoWithBranch('main', {
      'keep.txt': 'original',
      'modify.txt': 'v1',
      'delete-me.txt': 'bye',
    });
    try {
      const baseCommit = getCurrentCommit(dir)!;

      // Make changes: add, modify, delete
      fs.writeFileSync(path.join(dir, 'new-file.txt'), 'fresh');
      fs.writeFileSync(path.join(dir, 'modify.txt'), 'v2');
      fs.unlinkSync(path.join(dir, 'delete-me.txt'));
      execSync('git add -A', { cwd: dir, stdio: 'pipe' });
      execSync('git commit -m "various changes"', { cwd: dir, stdio: 'pipe' });

      const changes = getChangedFilesSinceBranch(dir, baseCommit, 'main');
      expect(changes.added).toContain('new-file.txt');
      expect(changes.modified).toContain('modify.txt');
      expect(changes.deleted).toContain('delete-me.txt');
      // keep.txt should not appear
      expect(changes.added).not.toContain('keep.txt');
      expect(changes.modified).not.toContain('keep.txt');
      expect(changes.deleted).not.toContain('keep.txt');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Helper: create a bare repo + clone to get a repo with origin remote.
 * Returns { bare, clone } paths.
 */
function createBareAndClone(): { bare: string; clone: string } {
  const bare = path.join(tmpDir, 'bare.git');
  const clone = path.join(tmpDir, 'cloned');

  // Create bare repo with main as default branch
  execSync(`git init --bare --initial-branch=main "${bare}"`, { stdio: 'pipe' });

  // Clone it (creates 'origin' remote automatically)
  execSync(`git clone "${bare}" "${clone}"`, { stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: clone, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: clone, stdio: 'pipe' });

  // Make an initial commit so main branch exists
  fs.writeFileSync(path.join(clone, 'README.md'), '# init');
  execSync('git add -A', { cwd: clone, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: clone, stdio: 'pipe' });
  // Ensure we're on main then push
  execSync('git branch -M main', { cwd: clone, stdio: 'pipe' });
  execSync('git push -u origin main', { cwd: clone, stdio: 'pipe' });

  return { bare, clone };
}

describe('gitRefresh', () => {
  it('fetches and resets to latest on default branch', () => {
    const { bare, clone } = createBareAndClone();

    // Add a commit to bare repo via a second clone
    const clone2 = path.join(tmpDir, 'clone2');
    execSync(`git clone "${bare}" "${clone2}"`, { stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: clone2, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: clone2, stdio: 'pipe' });
    fs.writeFileSync(path.join(clone2, 'new-file.txt'), 'hello from clone2');
    execSync('git add -A', { cwd: clone2, stdio: 'pipe' });
    execSync('git commit -m "new commit"', { cwd: clone2, stdio: 'pipe' });
    execSync('git push origin main', { cwd: clone2, stdio: 'pipe' });

    // Original clone doesn't have the new commit yet
    const beforeCommit = getCurrentCommit(clone);

    const result = gitRefresh(clone, 'main');
    expect(result.refreshed).toBe(true);
    expect(result.error).toBeUndefined();

    // Verify the new commit was pulled
    const afterCommit = getCurrentCommit(clone);
    expect(afterCommit).not.toBe(beforeCommit);
    expect(fs.existsSync(path.join(clone, 'new-file.txt'))).toBe(true);
  });

  it('returns error when no remote configured', () => {
    initGitRepo(tmpDir);

    const result = gitRefresh(tmpDir, 'main');
    expect(result.refreshed).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('skips checkout when already on default branch', () => {
    const { clone } = createBareAndClone();

    // Already on main, should succeed without checkout
    const result = gitRefresh(clone, 'main');
    expect(result.refreshed).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('returns error for dirty working tree on different branch', () => {
    const { clone } = createBareAndClone();

    // Create and checkout feature branch
    execSync('git checkout -b feature', { cwd: clone, stdio: 'pipe' });
    // Add uncommitted file (dirty working tree)
    fs.writeFileSync(path.join(clone, 'uncommitted.txt'), 'dirty');

    const result = gitRefresh(clone, 'main');
    expect(result.refreshed).toBe(false);
    expect(result.error).toMatch(/dirty/i);
  });

  it('checks out default branch when on feature branch with clean tree', () => {
    const { clone } = createBareAndClone();

    // Create feature branch with a committed change (clean tree)
    execSync('git checkout -b feature', { cwd: clone, stdio: 'pipe' });
    fs.writeFileSync(path.join(clone, 'feature-file.txt'), 'feature work');
    execSync('git add -A', { cwd: clone, stdio: 'pipe' });
    execSync('git commit -m "feature commit"', { cwd: clone, stdio: 'pipe' });

    const result = gitRefresh(clone, 'main');
    expect(result.refreshed).toBe(true);
    expect(result.error).toBeUndefined();

    // Should now be on main
    const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: clone,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trim();
    expect(currentBranch).toBe('main');
  });
});
