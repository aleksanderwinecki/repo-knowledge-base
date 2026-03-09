import type { EntityType } from '../types/entities.js';

/** Result from full-text search with contextual metadata */
export interface TextSearchResult {
  entityType: EntityType;
  subType: string;
  entityId: number;
  name: string;
  snippet: string;
  repoName: string;
  repoPath: string;
  filePath: string | null;
  relevance: number;
}

/** Options for text search */
export interface TextSearchOptions {
  /** Maximum number of results (default: 20) */
  limit?: number;
  /** Filter results to a specific repo by name */
  repoFilter?: string;
  /** Filter results to a specific entity type (coarse like 'module' or granular like 'schema') */
  entityTypeFilter?: string;
}

/** Structured entity card with relationship data */
export interface EntityCard {
  name: string;
  type: EntityType;
  repoName: string;
  filePath: string | null;
  description: string | null;
  relationships: EntityRelationship[];
}

/** A relationship edge on an entity card */
export interface EntityRelationship {
  direction: 'incoming' | 'outgoing';
  type: string;
  targetName: string;
  targetType: string;
}

/** Filters for entity queries */
export interface EntityFilters {
  /** Filter by entity type (coarse like 'module' or granular like 'schema') */
  type?: string;
  /** Filter by relationship type (e.g. 'consumes_event') */
  relationship?: string;
  /** Filter by repo name */
  repo?: string;
}

/** Result of a dependency query */
export interface DependencyResult {
  entity: { name: string; type: string; repoName: string };
  dependencies: DependencyNode[];
}

/** A single node in the dependency graph */
export interface DependencyNode {
  name: string;
  type: string;
  repoName: string;
  /** Connection mechanism (e.g. 'Kafka consumer', 'gRPC [high]') */
  mechanism: string;
  /** Confidence level from edge metadata ('high' | 'medium' | 'low' | null) */
  confidence: string | null;
  /** Depth from the queried entity (1 = direct) */
  depth: number;
  /** Full traversal path for multi-hop queries */
  path: string[];
}

/** Options for dependency queries */
export interface DependencyOptions {
  /** Query direction: upstream = what X depends on, downstream = what depends on X (default: 'upstream') */
  direction?: 'upstream' | 'downstream';
  /** Traversal depth: integer or 'all' (default: 1, max: 10) */
  depth?: number | 'all';
  /** Filter by repo name */
  repo?: string;
  /** Filter by communication mechanism ('grpc' | 'http' | 'gateway' | 'kafka' | 'event') */
  mechanism?: string;
}

/** A single edge in the in-memory service graph */
export interface GraphEdge {
  targetRepoId: number;
  mechanism: string;
  confidence: string | null;
  via: string | null;
  relationshipType: string;
}

/** In-memory service graph with forward and reverse adjacency lists */
export interface ServiceGraph {
  forward: Map<number, GraphEdge[]>;
  reverse: Map<number, GraphEdge[]>;
  repoNames: Map<number, string>;
  repoIds: Map<string, number>;
}

/** A node discovered during BFS traversal */
export interface BfsNode {
  repoId: number;
  repoName: string;
  depth: number;
}

/** A node in an upstream impact analysis result */
export interface ImpactNode {
  repoId: number;
  repoName: string;
  depth: number;
  edges: Array<{ mechanism: string; confidence: string | null }>;
}

/** A single hop in a shortest-path result */
export interface GraphHop {
  fromRepoId: number;
  fromRepoName: string;
  toRepoId: number;
  toRepoName: string;
  mechanism: string;
  confidence: string | null;
  via: string | null;
}
