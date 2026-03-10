import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProgressReporter,
  ErrorCollector,
} from '../../src/indexer/progress.js';

/** Minimal mock that behaves like a WriteStream for testing. */
function createMockStream(isTTY: boolean) {
  const writes: string[] = [];
  const calls: string[] = [];

  return {
    isTTY,
    writes,
    calls,
    write(data: string) {
      writes.push(data);
      calls.push(`write:${data}`);
      return true;
    },
    clearLine(dir: number) {
      calls.push(`clearLine:${dir}`);
      return true;
    },
    cursorTo(x: number) {
      calls.push(`cursorTo:${x}`);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
}

describe('ProgressReporter', () => {
  describe('TTY stream', () => {
    let stream: ReturnType<typeof createMockStream>;
    let reporter: ProgressReporter;

    beforeEach(() => {
      stream = createMockStream(true);
      reporter = new ProgressReporter(stream as unknown as NodeJS.WriteStream);
    });

    it('update() without label writes "Refreshing [N/T]..." with clearLine and cursorTo', () => {
      reporter.update(3, 10);
      expect(stream.calls).toEqual([
        'clearLine:0',
        'cursorTo:0',
        'write:Refreshing [3/10]...',
      ]);
    });

    it('update() with label writes "Indexing [N/T] label..." with clearLine and cursorTo', () => {
      reporter.update(3, 10, 'app-foo');
      expect(stream.calls).toEqual([
        'clearLine:0',
        'cursorTo:0',
        'write:Indexing [3/10] app-foo...',
      ]);
    });

    it('finish() clears the line', () => {
      reporter.finish();
      expect(stream.calls).toEqual([
        'clearLine:0',
        'cursorTo:0',
      ]);
    });

    it('finish(message) clears the line then writes message with newline', () => {
      reporter.finish('Done');
      expect(stream.calls).toEqual([
        'clearLine:0',
        'cursorTo:0',
        'write:Done\n',
      ]);
    });
  });

  describe('non-TTY stream', () => {
    let stream: ReturnType<typeof createMockStream>;
    let reporter: ProgressReporter;

    beforeEach(() => {
      stream = createMockStream(false);
      reporter = new ProgressReporter(stream as unknown as NodeJS.WriteStream);
    });

    it('update() without label writes "Refreshing [N/T]...\\n" without clearLine/cursorTo', () => {
      reporter.update(3, 10);
      expect(stream.calls).toEqual([
        'write:Refreshing [3/10]...\n',
      ]);
    });

    it('update() with label writes "Indexing [N/T] label...\\n" without clearLine/cursorTo', () => {
      reporter.update(3, 10, 'app-foo');
      expect(stream.calls).toEqual([
        'write:Indexing [3/10] app-foo...\n',
      ]);
    });

    it('finish() does nothing on non-TTY', () => {
      reporter.finish();
      expect(stream.calls).toEqual([]);
    });

    it('finish(message) writes message with newline, no clearLine', () => {
      reporter.finish('Done');
      expect(stream.calls).toEqual([
        'write:Done\n',
      ]);
    });
  });
});

describe('ErrorCollector', () => {
  let collector: ErrorCollector;

  beforeEach(() => {
    collector = new ErrorCollector();
  });

  describe('hasErrors', () => {
    it('returns false when empty', () => {
      expect(collector.hasErrors()).toBe(false);
    });

    it('returns true after addRefreshError', () => {
      collector.addRefreshError('app-foo', 'some error');
      expect(collector.hasErrors()).toBe(true);
    });

    it('returns true after addNoBranch', () => {
      collector.addNoBranch('app-foo');
      expect(collector.hasErrors()).toBe(true);
    });

    it('returns true after addIndexError', () => {
      collector.addIndexError('app-foo', 'index failed');
      expect(collector.hasErrors()).toBe(true);
    });
  });

  describe('error classification', () => {
    it('classifies "dirty working tree, skipping checkout" as dirty_tree', () => {
      collector.addRefreshError('app-a', 'dirty working tree, skipping checkout');
      const stream = createMockStream(false);
      collector.printSummary(stream as unknown as NodeJS.WriteStream);
      const output = stream.writes.join('');
      expect(output).toContain('Dirty working trees');
      expect(output).toContain('app-a');
    });

    it('classifies message containing "ETIMEDOUT" as timeout', () => {
      collector.addRefreshError('app-b', 'connect ETIMEDOUT 1.2.3.4:443');
      const stream = createMockStream(false);
      collector.printSummary(stream as unknown as NodeJS.WriteStream);
      const output = stream.writes.join('');
      expect(output).toContain('Timeouts');
      expect(output).toContain('app-b');
    });

    it('classifies message containing "SIGTERM" as timeout', () => {
      collector.addRefreshError('app-c', 'process killed with SIGTERM');
      const stream = createMockStream(false);
      collector.printSummary(stream as unknown as NodeJS.WriteStream);
      const output = stream.writes.join('');
      expect(output).toContain('Timeouts');
      expect(output).toContain('app-c');
    });

    it('classifies message containing "already checked out at" as worktree_conflict', () => {
      collector.addRefreshError('app-d', "fatal: 'main' is already checked out at /tmp/foo");
      const stream = createMockStream(false);
      collector.printSummary(stream as unknown as NodeJS.WriteStream);
      const output = stream.writes.join('');
      expect(output).toContain('Worktree conflicts');
      expect(output).toContain('app-d');
    });

    it('classifies message containing "is locked" as worktree_conflict', () => {
      collector.addRefreshError('app-e', "fatal: Unable to create '.git/index.lock': File is locked");
      const stream = createMockStream(false);
      collector.printSummary(stream as unknown as NodeJS.WriteStream);
      const output = stream.writes.join('');
      expect(output).toContain('Worktree conflicts');
      expect(output).toContain('app-e');
    });

    it('classifies other messages as other', () => {
      collector.addRefreshError('app-f', 'unknown git failure');
      const stream = createMockStream(false);
      collector.printSummary(stream as unknown as NodeJS.WriteStream);
      const output = stream.writes.join('');
      expect(output).toContain('Other errors');
      expect(output).toContain('app-f');
    });
  });

  describe('no-branch repos', () => {
    it('printSummary writes count and repo name for single no-branch repo', () => {
      collector.addNoBranch('app-foo');
      const stream = createMockStream(false);
      collector.printSummary(stream as unknown as NodeJS.WriteStream);
      const output = stream.writes.join('');
      expect(output).toContain('1 repos had no main/master branch');
      expect(output).toContain('app-foo');
    });

    it('printSummary lists all no-branch repo names', () => {
      collector.addNoBranch('app-foo');
      collector.addNoBranch('app-bar');
      collector.addNoBranch('app-baz');
      const stream = createMockStream(false);
      collector.printSummary(stream as unknown as NodeJS.WriteStream);
      const output = stream.writes.join('');
      expect(output).toContain('3 repos had no main/master branch');
      expect(output).toContain('app-foo');
      expect(output).toContain('app-bar');
      expect(output).toContain('app-baz');
    });
  });

  describe('printSummary grouping', () => {
    it('groups refresh errors by category with count and per-repo details', () => {
      collector.addRefreshError('app-a', 'dirty working tree, skipping checkout');
      collector.addRefreshError('app-b', 'dirty working tree, skipping checkout');
      collector.addRefreshError('app-c', 'connect ETIMEDOUT 1.2.3.4:443');
      const stream = createMockStream(false);
      collector.printSummary(stream as unknown as NodeJS.WriteStream);
      const output = stream.writes.join('');
      // Should show dirty_tree group with count 2
      expect(output).toContain('Dirty working trees (2)');
      expect(output).toContain('app-a');
      expect(output).toContain('app-b');
      // Should show timeout group with count 1
      expect(output).toContain('Timeouts (1)');
      expect(output).toContain('app-c');
    });

    it('writes nothing when no errors collected', () => {
      const stream = createMockStream(false);
      collector.printSummary(stream as unknown as NodeJS.WriteStream);
      expect(stream.writes).toEqual([]);
    });
  });

  describe('index errors', () => {
    it('addIndexError stores errors that appear in printSummary under indexing section', () => {
      collector.addIndexError('app-x', 'parse error in package.json');
      const stream = createMockStream(false);
      collector.printSummary(stream as unknown as NodeJS.WriteStream);
      const output = stream.writes.join('');
      expect(output).toContain('Indexing errors');
      expect(output).toContain('app-x');
      expect(output).toContain('parse error in package.json');
    });
  });
});
