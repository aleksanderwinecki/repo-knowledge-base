import { describe, it, expect } from 'vitest';
import { resolveOutputMode } from '../../src/cli/commands/index-cmd.js';

describe('resolveOutputMode', () => {
  it('returns json when --json flag is set even on TTY', () => {
    expect(resolveOutputMode({ json: true }, true)).toBe('json');
  });

  it('returns json when --json flag is set on non-TTY', () => {
    expect(resolveOutputMode({ json: true }, false)).toBe('json');
  });

  it('returns json when piped (non-TTY, no --json)', () => {
    expect(resolveOutputMode({ json: false }, false)).toBe('json');
  });

  it('returns json when isTTY is undefined (non-TTY)', () => {
    expect(resolveOutputMode({ json: false }, undefined)).toBe('json');
  });

  it('returns human on interactive TTY without --json', () => {
    expect(resolveOutputMode({ json: false }, true)).toBe('human');
  });
});
