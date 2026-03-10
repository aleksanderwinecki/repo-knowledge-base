import { listWorkingTreeFiles, readWorkingTreeFile } from '../git.js';
import type { TopologyEdge } from './types.js';

/**
 * Regex matching compose/services/*.ts files (direct children only).
 * Captures filenames like compose/services/appointments.ts but NOT
 * compose/services/nested/deep.ts or compose/other/thing.ts.
 */
const COMPOSE_SERVICE_RE = /^compose\/services\/[\w-]+\.ts$/;

/**
 * Regex to extract describe() calls with name + schemaSource.repo.
 * Captures: (1) service name, (2) repo name.
 *
 * Handles multiline formatting and extra whitespace.
 */
const DESCRIBE_RE =
  /describe\(\{\s*name:\s*"(\w+)"\s*,[\s\S]*?schemaSource:\s*\{\s*repo:\s*"([\w-]+)"/g;

/**
 * Extract gateway routing edges from a TypeScript-based gateway repo.
 *
 * Looks for compose/services/*.ts files containing `describe()` calls
 * with `schemaSource: { repo: "..." }` patterns (Partners API gateway format).
 *
 * Returns empty array for non-gateway repos.
 */
export function extractGatewayEdges(
  repoPath: string,
): TopologyEdge[] {
  const allFiles = listWorkingTreeFiles(repoPath);
  const serviceFiles = allFiles.filter((f) => COMPOSE_SERVICE_RE.test(f));

  if (serviceFiles.length === 0) {
    return [];
  }

  const edges: TopologyEdge[] = [];

  for (const filePath of serviceFiles) {
    const content = readWorkingTreeFile(repoPath, filePath);
    if (!content) continue;

    // Reset regex lastIndex for each file (global flag)
    DESCRIBE_RE.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = DESCRIBE_RE.exec(content)) !== null) {
      const serviceName = match[1]!;
      const repo = match[2]!;

      edges.push({
        mechanism: 'gateway',
        sourceFile: filePath,
        targetServiceName: repo,
        metadata: { serviceName, repo },
        confidence: 'medium',
      });
    }
  }

  return edges;
}
