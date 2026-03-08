/** Communication mechanism types for topology edges */
export type TopologyMechanism = 'grpc' | 'http' | 'gateway' | 'kafka';

/**
 * Intermediate topology edge produced by extractors.
 * Pure data structure — no DB access. Resolved to entity IDs during persistence.
 */
export interface TopologyEdge {
  mechanism: TopologyMechanism;
  sourceFile: string;
  targetServiceName: string;    // Unresolved name (e.g., "Rpc.Partners.V1.RPCService")
  metadata: Record<string, string>;  // mechanism-specific context
  confidence: 'high' | 'medium' | 'low';
}
