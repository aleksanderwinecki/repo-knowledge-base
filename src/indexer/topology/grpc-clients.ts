import { listWorkingTreeFiles, readWorkingTreeFile } from '../git.js';
import type { ElixirModule } from '../elixir.js';
import type { TopologyEdge } from './types.js';

/**
 * Lib path prefixes where .ex files are expected.
 * Matches: lib/, src/lib/, apps/X/lib/, src/apps/X/lib/
 */
const LIB_PATH_PATTERNS = [
  /^lib\//,
  /^src\/lib\//,
  /^apps\/[^/]+\/lib\//,
  /^src\/apps\/[^/]+\/lib\//,
];

/**
 * Pattern 1: MockableRpcClient — hand-written client wrappers.
 * Captures: behaviour module name (e.g., "Rpc.Appointments.V1.RPCService.ClientBehaviour")
 */
const MOCKABLE_RPC_RE =
  /use\s+RpcClient\.MockableRpcClient,\s*\n?\s*behaviour:\s*([\w.]+)/g;

/**
 * Pattern 2: Generated RpcClient.Client — auto-generated client implementations.
 * Captures: (1) service module, (2) stub module
 */
const RPCCLIENT_CLIENT_RE =
  /use\s+RpcClient\.Client,\s*service:\s*([\w.]+),\s*stub:\s*([\w.]+)/g;

/**
 * Extract the domain/service name from a qualified Elixir module path.
 *
 * Examples:
 *   "Rpc.Appointments.V1.RPCService.ClientBehaviour" -> "Appointments"
 *   "Rpc.Customers.V1.RPCService.Stub" -> "Customers"
 *   "Fresha.Catalog.Protobuf.Rpc.V1.CatalogRpcService" -> "Catalog"
 *   "Rpc.Partners.V1.RPCService.Stub" -> "Partners"
 */
function extractServiceDomain(qualifiedName: string): string {
  const parts = qualifiedName.split('.');

  // Try to find "Rpc" segment
  const rpcIdx = parts.indexOf('Rpc');
  if (rpcIdx >= 0) {
    // When Rpc is at the start (e.g., "Rpc.Customers.V1.RPCService"), take next part
    if (rpcIdx === 0 && rpcIdx + 1 < parts.length) {
      return parts[rpcIdx + 1]!;
    }

    // When Rpc is in the middle (e.g., "Fresha.Customers.Protobuf.Rpc.V1.CustomersRpcService"),
    // look backward from Rpc for a domain-like name (skip "Protobuf", "Proto", etc.)
    const skipParts = new Set(['Protobuf', 'Proto', 'Grpc', 'Rpc']);
    for (let i = rpcIdx - 1; i >= 0; i--) {
      const part = parts[i]!;
      if (!skipParts.has(part) && part !== 'Fresha') {
        return part;
      }
    }

    // Fallback: skip version-like parts after Rpc and take the next meaningful part
    for (let i = rpcIdx + 1; i < parts.length; i++) {
      const part = parts[i]!;
      if (!/^V\d+$/.test(part) && part !== 'RPCService' && part !== 'Stub' && part !== 'ClientBehaviour') {
        return part;
      }
    }
  }

  // Fallback: take second part if it looks like a domain
  // e.g., "Fresha.Catalog.Protobuf..." -> "Catalog"
  if (parts.length >= 2) {
    return parts[1]!;
  }

  return qualifiedName;
}

/**
 * Check if a file path is under a test/spec directory or is a test file.
 */
function isTestPath(filePath: string): boolean {
  return (
    /(?:^|\/)test\//.test(filePath) ||
    /(?:^|\/)spec\//.test(filePath) ||
    filePath.endsWith('_test.exs') ||
    filePath.endsWith('_test.ex')
  );
}

/**
 * Extract gRPC client edges from an Elixir repo.
 *
 * Detects three patterns:
 * 1. `use RpcClient.MockableRpcClient, behaviour: ...` (hand-written wrappers)
 * 2. `use RpcClient.Client, service: ..., stub: ...` (generated clients)
 * 3. Reuses `ElixirModule.grpcStubs` for direct Stub.method() calls
 *
 * Deduplicates by normalized service domain name, prioritizing MockableRpcClient.
 * Returns TopologyEdge[] — pure data, no DB access.
 */
export function extractGrpcClientEdges(
  repoPath: string,
  elixirModules: ElixirModule[],
): TopologyEdge[] {
  // Map: normalized domain name -> TopologyEdge (for dedup)
  const edgeMap = new Map<string, TopologyEdge>();

  // Scan .ex files for patterns 1 and 2
  const allFiles = listWorkingTreeFiles(repoPath);
  const exFiles = allFiles.filter(
    (f) => f.endsWith('.ex') && LIB_PATH_PATTERNS.some((p) => p.test(f)) && !isTestPath(f),
  );

  for (const filePath of exFiles) {
    const content = readWorkingTreeFile(repoPath, filePath);
    if (!content) continue;

    // Pattern 1: MockableRpcClient
    MOCKABLE_RPC_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = MOCKABLE_RPC_RE.exec(content)) !== null) {
      const behaviourModule = match[1]!;
      const domain = extractServiceDomain(behaviourModule);
      const key = domain.toLowerCase();

      // MockableRpcClient always wins in dedup (it's the active client binding)
      edgeMap.set(key, {
        mechanism: 'grpc',
        sourceFile: filePath,
        targetServiceName: behaviourModule,
        metadata: { stub: behaviourModule, pattern: 'mockable' },
        confidence: 'high',
      });
    }

    // Pattern 2: RpcClient.Client
    RPCCLIENT_CLIENT_RE.lastIndex = 0;
    while ((match = RPCCLIENT_CLIENT_RE.exec(content)) !== null) {
      const serviceModule = match[1]!;
      const stubModule = match[2]!;
      const domain = extractServiceDomain(serviceModule);
      const key = domain.toLowerCase();

      // Only add if MockableRpcClient hasn't already claimed this domain
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          mechanism: 'grpc',
          sourceFile: filePath,
          targetServiceName: serviceModule,
          metadata: { stub: stubModule, pattern: 'client' },
          confidence: 'high',
        });
      }
    }
  }

  // Pattern 3: Reuse grpcStubs from already-parsed ElixirModules
  for (const mod of elixirModules) {
    if (isTestPath(mod.filePath)) continue;

    for (const stub of mod.grpcStubs) {
      const domain = extractServiceDomain(stub);
      const key = domain.toLowerCase();

      // Only add if not already detected by patterns 1 or 2
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          mechanism: 'grpc',
          sourceFile: mod.filePath,
          targetServiceName: stub,
          metadata: { stub, pattern: 'direct' },
          confidence: 'high',
        });
      }
    }
  }

  return Array.from(edgeMap.values());
}
