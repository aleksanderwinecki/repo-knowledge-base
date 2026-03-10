import { describe, it, expect, vi } from 'vitest';
import { printSummary } from '../../src/cli/summary.js';
import { ErrorCollector } from '../../src/indexer/progress.js';
import type { IndexResult } from '../../src/indexer/pipeline.js';

/** Minimal mock that behaves like a WriteStream for testing. */
function createMockStream() {
  const writes: string[] = [];
  return {
    isTTY: false,
    writes,
    write(data: string) {
      writes.push(data);
      return true;
    },
    clearLine() {
      return true;
    },
    cursorTo() {
      return true;
    },
  } as unknown as NodeJS.WriteStream;
}

function makeResults(
  success: number,
  skipped: number,
  errors: number,
): IndexResult[] {
  const results: IndexResult[] = [];
  for (let i = 0; i < success; i++) {
    results.push({ repo: `repo-s-${i}`, status: 'success' });
  }
  for (let i = 0; i < skipped; i++) {
    results.push({
      repo: `repo-k-${i}`,
      status: 'skipped',
      skipReason: 'unchanged',
    });
  }
  for (let i = 0; i < errors; i++) {
    results.push({
      repo: `repo-e-${i}`,
      status: 'error',
      error: `failed ${i}`,
    });
  }
  return results;
}

describe('printSummary', () => {
  describe('SUM-01: Header line format', () => {
    it('formats header with plural repos', () => {
      const stream = createMockStream();
      const errors = new ErrorCollector();
      const results = makeResults(380, 15, 5);

      printSummary(stream, results, 42300, errors);

      expect(stream.writes[0]).toBe(
        'Indexing complete: 400 repos (380 indexed, 15 skipped, 5 errors) in 42.3s\n',
      );
    });

    it('formats header with singular repo', () => {
      const stream = createMockStream();
      const errors = new ErrorCollector();
      const results = makeResults(1, 0, 0);

      printSummary(stream, results, 1500, errors);

      expect(stream.writes[0]).toBe(
        'Indexing complete: 1 repo (1 indexed, 0 skipped, 0 errors) in 1.5s\n',
      );
    });

    it('uses total = results.length', () => {
      const stream = createMockStream();
      const errors = new ErrorCollector();
      const results = makeResults(10, 5, 2);

      printSummary(stream, results, 3000, errors);

      expect(stream.writes[0]).toContain('17 repos');
    });

    it('formats elapsed time to one decimal', () => {
      const stream = createMockStream();
      const errors = new ErrorCollector();
      const results = makeResults(5, 0, 0);

      printSummary(stream, results, 500, errors);

      expect(stream.writes[0]).toContain('in 0.5s');
    });
  });

  describe('SUM-02: Error listing', () => {
    it('delegates to ErrorCollector.printSummary when errors exist', () => {
      const stream = createMockStream();
      const errors = new ErrorCollector();
      errors.addIndexError('repo-bad', 'crash');
      const spy = vi.spyOn(errors, 'printSummary');

      const results = makeResults(9, 0, 1);
      printSummary(stream, results, 1000, errors);

      expect(spy).toHaveBeenCalledWith(stream);
    });

    it('does not call ErrorCollector.printSummary when no errors', () => {
      const stream = createMockStream();
      const errors = new ErrorCollector();
      const spy = vi.spyOn(errors, 'printSummary');

      const results = makeResults(10, 0, 0);
      printSummary(stream, results, 1000, errors);

      expect(spy).not.toHaveBeenCalled();
    });

    it('writes blank line separator before error details', () => {
      const stream = createMockStream();
      const errors = new ErrorCollector();
      errors.addIndexError('repo-x', 'boom');

      const results = makeResults(9, 0, 1);
      printSummary(stream, results, 1000, errors);

      // After header line, there should be a blank line separator
      expect(stream.writes[1]).toBe('\n');
    });

    it('writes error details to the same stream as header', () => {
      const stream = createMockStream();
      const errors = new ErrorCollector();
      errors.addIndexError('repo-x', 'boom');

      const results = makeResults(9, 0, 1);
      printSummary(stream, results, 1000, errors);

      // The stream should have header + blank line + error output
      const combined = stream.writes.join('');
      expect(combined).toContain('10 repos');
      expect(combined).toContain('repo-x');
    });
  });

  describe('SUM-03: Compactness', () => {
    it('header is exactly one line', () => {
      const stream = createMockStream();
      const errors = new ErrorCollector();
      const results = makeResults(380, 15, 5);

      printSummary(stream, results, 42300, errors);

      const header = stream.writes[0];
      // Exactly one newline at the end
      expect(header.split('\n').length).toBe(2); // "text" + "" after split
      expect(header.endsWith('\n')).toBe(true);
    });

    it('does not print per-repo success/skip lines', () => {
      const stream = createMockStream();
      const errors = new ErrorCollector();
      const results = makeResults(380, 15, 0);

      printSummary(stream, results, 42300, errors);

      // Should only have the header line, nothing else
      expect(stream.writes).toHaveLength(1);
      // None of the individual repo names appear
      expect(stream.writes[0]).not.toContain('repo-s-');
      expect(stream.writes[0]).not.toContain('repo-k-');
    });

    it('total output for 400 repos with 5 errors stays compact', () => {
      const stream = createMockStream();
      const errors = new ErrorCollector();
      for (let i = 0; i < 5; i++) {
        errors.addIndexError(`repo-err-${i}`, `error msg ${i}`);
      }
      const results = makeResults(380, 15, 5);

      printSummary(stream, results, 42300, errors);

      const totalOutput = stream.writes.join('');
      const lines = totalOutput.split('\n').filter((l) => l.length > 0);
      // Header (1) + error group header (1) + 5 error lines = 7 lines
      expect(lines.length).toBeLessThan(30);
    });
  });
});
