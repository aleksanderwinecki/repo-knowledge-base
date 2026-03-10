import type { IndexResult } from '../indexer/pipeline.js';
import type { ErrorCollector } from '../indexer/progress.js';

/**
 * Print a compact human-readable summary of indexing results.
 *
 * Writes a one-line header with counts and elapsed time, then
 * delegates error details to ErrorCollector if any errors exist.
 */
export function printSummary(
  stream: NodeJS.WriteStream,
  results: IndexResult[],
  elapsedMs: number,
  errors: ErrorCollector,
): void {
  const total = results.length;
  const indexed = results.filter((r) => r.status === 'success').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;
  const errorCount = results.filter((r) => r.status === 'error').length;
  const elapsed = (elapsedMs / 1000).toFixed(1);
  const noun = total === 1 ? 'repo' : 'repos';

  stream.write(
    `Indexing complete: ${total} ${noun} (${indexed} indexed, ${skipped} skipped, ${errorCount} errors) in ${elapsed}s\n`,
  );

  if (errors.hasErrors()) {
    stream.write('\n');
    errors.printSummary(stream);
  }
}
