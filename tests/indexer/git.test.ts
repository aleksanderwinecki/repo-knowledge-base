import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import {
  getCurrentCommit,
  getChangedFiles,
  isCommitReachable,
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
