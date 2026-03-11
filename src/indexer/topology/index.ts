import type { ElixirModule } from '../elixir.js';
import { extractGrpcClientEdges } from './grpc-clients.js';
import { extractHttpClientEdges } from './http-clients.js';
import { extractGatewayEdges } from './gateway.js';
import { extractKafkaEdges } from './kafka.js';
export type { TopologyEdge, TopologyMechanism } from './types.js';
import type { TopologyEdge } from './types.js';

/**
 * Orchestrate all topology extractors for a single repo.
 * Combines gRPC, HTTP, gateway, and Kafka edge detection into
 * a single TopologyEdge[] result. Pure function -- no DB access.
 */
export function extractTopologyEdges(
  repoPath: string,
  elixirModules: ElixirModule[],
  fileList?: string[],
): TopologyEdge[] {
  return [
    ...extractGrpcClientEdges(repoPath, elixirModules, fileList),
    ...extractHttpClientEdges(repoPath, fileList),
    ...extractGatewayEdges(repoPath, fileList),
    ...extractKafkaEdges(repoPath, fileList),
  ];
}
