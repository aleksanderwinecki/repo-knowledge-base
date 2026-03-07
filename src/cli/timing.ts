/**
 * Shared timing utility using perf_hooks.
 * Wraps sync/async functions with performance marks and measures.
 * Output goes to stderr only when reportTimings() is called.
 */

import { performance } from 'node:perf_hooks';

/**
 * Wrap a synchronous function with perf_hooks timing.
 */
export function withTiming<T>(name: string, fn: () => T): T {
  const start = `${name}:start`;
  const end = `${name}:end`;
  performance.mark(start);
  const result = fn();
  performance.mark(end);
  performance.measure(name, start, end);
  return result;
}

/**
 * Wrap an async function with perf_hooks timing.
 */
export async function withTimingAsync<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const start = `${name}:start`;
  const end = `${name}:end`;
  performance.mark(start);
  const result = await fn();
  performance.mark(end);
  performance.measure(name, start, end);
  return result;
}

/**
 * Report all collected timing measures to stderr.
 * Clears measures after reporting.
 */
export function reportTimings(): void {
  const entries = performance.getEntriesByType('measure');
  if (entries.length === 0) return;
  for (const entry of entries) {
    process.stderr.write(`[timing] ${entry.name}: ${entry.duration.toFixed(1)}ms\n`);
  }
  performance.clearMeasures();
  performance.clearMarks();
}
