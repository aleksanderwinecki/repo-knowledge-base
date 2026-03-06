import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  getCurrentCommit,
  getChangedFiles,
  isCommitReachable,
  resolveDefaultBranch,
  getBranchCommit,
  listBranchFiles,
  readBranchFile,
  getChangedFilesSinceBranch,
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

describe('getChangedFiles', () => {
  it('detects added files', () => {
    initGitRepo(tmpDir);
    const firstCommit = getCurrentCommit(tmpDir)!;

    // Create and commit a new file
    fs.writeFileSync(path.join(tmpDir, 'new-file.txt'), 'content');
    execSync('git add new-file.txt', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "add file"', { cwd: tmpDir, stdio: 'pipe' });

    const changes = getChangedFiles(tmpDir, firstCommit);
    expect(changes.added).toContain('new-file.txt');
    expect(changes.modified).toHaveLength(0);
    expect(changes.deleted).toHaveLength(0);
  });

  it('detects modified files', () => {
    initGitRepo(tmpDir);

    // Create initial file
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'v1');
    execSync('git add file.txt', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "add file"', { cwd: tmpDir, stdio: 'pipe' });
    const afterAdd = getCurrentCommit(tmpDir)!;

    // Modify the file
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'v2');
    execSync('git add file.txt', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "modify file"', { cwd: tmpDir, stdio: 'pipe' });

    const changes = getChangedFiles(tmpDir, afterAdd);
    expect(changes.modified).toContain('file.txt');
  });

  it('detects deleted files', () => {
    initGitRepo(tmpDir);

    // Create and commit a file
    fs.writeFileSync(path.join(tmpDir, 'to-delete.txt'), 'content');
    execSync('git add to-delete.txt', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "add file"', { cwd: tmpDir, stdio: 'pipe' });
    const afterAdd = getCurrentCommit(tmpDir)!;

    // Delete the file
    fs.unlinkSync(path.join(tmpDir, 'to-delete.txt'));
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "delete file"', { cwd: tmpDir, stdio: 'pipe' });

    const changes = getChangedFiles(tmpDir, afterAdd);
    expect(changes.deleted).toContain('to-delete.txt');
  });

  it('returns empty lists when no changes', () => {
    initGitRepo(tmpDir);
    const sha = getCurrentCommit(tmpDir)!;

    const changes = getChangedFiles(tmpDir, sha);
    expect(changes.added).toHaveLength(0);
    expect(changes.modified).toHaveLength(0);
    expect(changes.deleted).toHaveLength(0);
  });

  it('returns empty lists for invalid commit', () => {
    initGitRepo(tmpDir);

    const changes = getChangedFiles(tmpDir, 'deadbeef0000deadbeef0000deadbeef0000dead');
    expect(changes.added).toHaveLength(0);
    expect(changes.modified).toHaveLength(0);
    expect(changes.deleted).toHaveLength(0);
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

describe('listBranchFiles', () => {
  it('returns all committed files from branch tree', () => {
    const dir = createRepoWithBranch('main', {
      'src/app.ts': 'console.log("hi")',
      'README.md': '# Hello',
      'lib/utils.ts': 'export {}',
    });
    try {
      const files = listBranchFiles(dir, 'main');
      expect(files).toContain('src/app.ts');
      expect(files).toContain('README.md');
      expect(files).toContain('lib/utils.ts');
      expect(files).toHaveLength(3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does NOT include uncommitted working tree files', () => {
    const dir = createRepoWithBranch('main', { 'committed.txt': 'yes' });
    try {
      // Write an uncommitted file to the working tree
      fs.writeFileSync(path.join(dir, 'uncommitted.txt'), 'nope');

      const files = listBranchFiles(dir, 'main');
      expect(files).toContain('committed.txt');
      expect(files).not.toContain('uncommitted.txt');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty array for non-existent branch', () => {
    const dir = createRepoWithBranch('main', { 'a.txt': 'content' });
    try {
      expect(listBranchFiles(dir, 'nonexistent')).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('readBranchFile', () => {
  it('returns file content from the named branch', () => {
    const dir = createRepoWithBranch('main', { 'hello.txt': 'world' });
    try {
      expect(readBranchFile(dir, 'main', 'hello.txt')).toBe('world');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns content from main even when working tree differs on feature branch', () => {
    const dir = createRepoWithBranch('main', { 'config.json': '{"v":1}' });
    try {
      // Create feature branch and modify file
      execSync('git checkout -b feature', { cwd: dir, stdio: 'pipe' });
      fs.writeFileSync(path.join(dir, 'config.json'), '{"v":2}');
      execSync('git add config.json', { cwd: dir, stdio: 'pipe' });
      execSync('git commit -m "update on feature"', { cwd: dir, stdio: 'pipe' });

      // Reading from main should return original content
      expect(readBranchFile(dir, 'main', 'config.json')).toBe('{"v":1}');
      // Reading from feature should return updated content
      expect(readBranchFile(dir, 'feature', 'config.json')).toBe('{"v":2}');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for non-existent file', () => {
    const dir = createRepoWithBranch('main', { 'exists.txt': 'yes' });
    try {
      expect(readBranchFile(dir, 'main', 'nope.txt')).toBeNull();
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
