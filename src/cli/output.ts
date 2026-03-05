/**
 * JSON output helpers for CLI commands.
 * All CLI output goes through these functions to ensure consistent JSON formatting.
 */

/**
 * Write JSON data to stdout.
 */
export function output(data: unknown): void {
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/**
 * Write JSON error to stderr and exit with code 1.
 */
export function outputError(message: string, code?: string): never {
  process.stderr.write(
    JSON.stringify({ error: message, code: code ?? 'ERROR' }, null, 2) + '\n',
  );
  process.exit(1);
}
