import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { extractMetadata } from '../../src/indexer/metadata.js';

let tmpDir: string;

function setupMockRepo(name: string): string {
  const repoDir = path.join(tmpDir, name);
  fs.mkdirSync(repoDir, { recursive: true });

  // Initialize git so getCurrentCommit works
  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit --allow-empty -m "init"', { cwd: repoDir, stdio: 'pipe' });

  return repoDir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-meta-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('extractMetadata', () => {
  it('extracts name from directory basename', () => {
    const repoDir = setupMockRepo('my-service');
    fs.writeFileSync(path.join(repoDir, 'mix.exs'), '');

    const meta = extractMetadata(repoDir);
    expect(meta.name).toBe('my-service');
  });

  it('extracts description from README.md', () => {
    const repoDir = setupMockRepo('described-repo');
    fs.writeFileSync(
      path.join(repoDir, 'README.md'),
      '# My Service\n\nThis service handles booking management for the platform.\n\n## Installation\n',
    );

    const meta = extractMetadata(repoDir);
    expect(meta.description).toBe(
      'This service handles booking management for the platform.',
    );
  });

  it('falls back to CLAUDE.md when no README', () => {
    const repoDir = setupMockRepo('claude-only');
    fs.writeFileSync(
      path.join(repoDir, 'CLAUDE.md'),
      '# Agent Instructions\n\nThis is a payments microservice.\n\n## Rules\n',
    );

    const meta = extractMetadata(repoDir);
    expect(meta.description).toBe('This is a payments microservice.');
  });

  it('returns null description when no README or CLAUDE.md', () => {
    const repoDir = setupMockRepo('no-docs');

    const meta = extractMetadata(repoDir);
    expect(meta.description).toBeNull();
  });

  it('detects Elixir tech stack from mix.exs', () => {
    const repoDir = setupMockRepo('elixir-app');
    fs.writeFileSync(
      path.join(repoDir, 'mix.exs'),
      `
      defp deps do
        [
          {:phoenix, "~> 1.7"},
          {:ecto, "~> 3.10"},
          {:jason, "~> 1.0"}
        ]
      end
      `,
    );

    const meta = extractMetadata(repoDir);
    expect(meta.techStack).toContain('elixir');
    expect(meta.techStack).toContain('phoenix');
    expect(meta.techStack).toContain('ecto');
  });

  it('detects Node tech stack from package.json', () => {
    const repoDir = setupMockRepo('node-app');
    fs.writeFileSync(
      path.join(repoDir, 'package.json'),
      JSON.stringify({
        dependencies: { express: '^4.18.0', lodash: '^4.17.0' },
      }),
    );

    const meta = extractMetadata(repoDir);
    expect(meta.techStack).toContain('node');
    expect(meta.techStack).toContain('express');
    expect(meta.techStack).not.toContain('lodash'); // not in key deps list
  });

  it('detects multiple languages', () => {
    const repoDir = setupMockRepo('multi-lang');
    fs.writeFileSync(path.join(repoDir, 'mix.exs'), '');
    fs.writeFileSync(path.join(repoDir, 'package.json'), '{}');

    const meta = extractMetadata(repoDir);
    expect(meta.techStack).toContain('elixir');
    expect(meta.techStack).toContain('node');
  });

  it('lists key files that exist', () => {
    const repoDir = setupMockRepo('full-repo');
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Hi');
    fs.writeFileSync(path.join(repoDir, 'mix.exs'), '');
    fs.mkdirSync(path.join(repoDir, 'lib'));
    fs.mkdirSync(path.join(repoDir, 'test'));

    const meta = extractMetadata(repoDir);
    expect(meta.keyFiles).toContain('README.md');
    expect(meta.keyFiles).toContain('mix.exs');
    expect(meta.keyFiles).toContain('lib/');
    expect(meta.keyFiles).toContain('test/');
  });

  it('does not list non-existent key files', () => {
    const repoDir = setupMockRepo('minimal');

    const meta = extractMetadata(repoDir);
    expect(meta.keyFiles).not.toContain('README.md');
    expect(meta.keyFiles).not.toContain('mix.exs');
    expect(meta.keyFiles).not.toContain('lib/');
  });

  it('handles corrupted package.json gracefully', () => {
    const repoDir = setupMockRepo('broken-pkg');
    fs.writeFileSync(path.join(repoDir, 'package.json'), 'not valid json{{{');

    const meta = extractMetadata(repoDir);
    expect(meta.techStack).toContain('node'); // detected from file existence
    // Should not crash
  });

  it('returns current git commit', () => {
    const repoDir = setupMockRepo('with-commit');

    const meta = extractMetadata(repoDir);
    expect(meta.currentCommit).toBeTruthy();
    expect(meta.currentCommit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('stores the absolute path', () => {
    const repoDir = setupMockRepo('abs-path');

    const meta = extractMetadata(repoDir);
    expect(meta.path).toBe(repoDir);
    expect(path.isAbsolute(meta.path)).toBe(true);
  });
});
