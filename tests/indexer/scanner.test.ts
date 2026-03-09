import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { discoverRepos } from '../../src/indexer/scanner.js';

let tmpDir: string;

function createMockRepo(
  parentDir: string,
  name: string,
  options: { git?: boolean; projectFile?: string } = {},
): string {
  const repoDir = path.join(parentDir, name);
  fs.mkdirSync(repoDir, { recursive: true });

  if (options.git !== false) {
    fs.mkdirSync(path.join(repoDir, '.git'));
  }

  if (options.projectFile) {
    fs.writeFileSync(path.join(repoDir, options.projectFile), '');
  }

  return repoDir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-scanner-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('discoverRepos', () => {
  it('discovers repos with .git and mix.exs', () => {
    createMockRepo(tmpDir, 'elixir-service', { projectFile: 'mix.exs' });
    createMockRepo(tmpDir, 'another-service', { projectFile: 'mix.exs' });

    const repos = discoverRepos(tmpDir);
    expect(repos).toHaveLength(2);
    expect(repos[0]).toContain('another-service');
    expect(repos[1]).toContain('elixir-service');
  });

  it('discovers repos with .git and package.json', () => {
    createMockRepo(tmpDir, 'node-app', { projectFile: 'package.json' });

    const repos = discoverRepos(tmpDir);
    expect(repos).toHaveLength(1);
    expect(repos[0]).toContain('node-app');
  });

  it('discovers repos with .git and Gemfile', () => {
    createMockRepo(tmpDir, 'ruby-app', { projectFile: 'Gemfile' });

    const repos = discoverRepos(tmpDir);
    expect(repos).toHaveLength(1);
  });

  it('skips directories without .git', () => {
    createMockRepo(tmpDir, 'no-git', { git: false, projectFile: 'mix.exs' });

    const repos = discoverRepos(tmpDir);
    expect(repos).toHaveLength(0);
  });

  it('skips directories without project files', () => {
    createMockRepo(tmpDir, 'bare-git', { git: true });

    const repos = discoverRepos(tmpDir);
    expect(repos).toHaveLength(0);
  });

  it('skips non-directory entries', () => {
    fs.writeFileSync(path.join(tmpDir, 'not-a-dir'), 'content');

    const repos = discoverRepos(tmpDir);
    expect(repos).toHaveLength(0);
  });

  it('returns sorted paths', () => {
    createMockRepo(tmpDir, 'z-repo', { projectFile: 'mix.exs' });
    createMockRepo(tmpDir, 'a-repo', { projectFile: 'mix.exs' });
    createMockRepo(tmpDir, 'm-repo', { projectFile: 'package.json' });

    const repos = discoverRepos(tmpDir);
    expect(repos).toHaveLength(3);
    expect(path.basename(repos[0])).toBe('a-repo');
    expect(path.basename(repos[1])).toBe('m-repo');
    expect(path.basename(repos[2])).toBe('z-repo');
  });

  it('throws on non-existent root directory', () => {
    expect(() => discoverRepos('/tmp/does-not-exist-rkb-test')).toThrow(
      'Root directory does not exist',
    );
  });

  it('discovers symlinked repo directories', () => {
    // Create a real repo in a separate directory
    const externalDir = path.join(tmpDir, 'external');
    fs.mkdirSync(externalDir, { recursive: true });
    const realRepoDir = path.join(externalDir, 'linked-service');
    fs.mkdirSync(realRepoDir);
    fs.mkdirSync(path.join(realRepoDir, '.git'));
    fs.writeFileSync(path.join(realRepoDir, 'mix.exs'), '');

    // Symlink it into the scan root
    const scanRoot = tmpDir;
    fs.symlinkSync(realRepoDir, path.join(scanRoot, 'linked-service'));

    const repos = discoverRepos(scanRoot);
    expect(repos).toHaveLength(1);
    expect(repos[0]).toContain('linked-service');
  });

  it('ignores broken symlinks (dangling)', () => {
    // Create a symlink pointing to non-existent target
    fs.symlinkSync('/tmp/does-not-exist-rkb-test-target', path.join(tmpDir, 'broken-link'));

    // Should not crash and return 0 repos
    const repos = discoverRepos(tmpDir);
    expect(repos).toHaveLength(0);
  });

  it('skips node_modules directory', () => {
    const nmDir = path.join(tmpDir, 'node_modules');
    fs.mkdirSync(nmDir);
    fs.mkdirSync(path.join(nmDir, '.git'));
    fs.writeFileSync(path.join(nmDir, 'package.json'), '{}');

    const repos = discoverRepos(tmpDir);
    expect(repos).toHaveLength(0);
  });
});
