import type { EntityType } from '../types/entities.js';

/** Result from full-text search with contextual metadata */
export interface TextSearchResult {
  entityType: EntityType;
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
  /** Filter results to a specific entity type */
  entityTypeFilter?: EntityType;
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
  /** Filter by entity type */
  type?: EntityType;
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
  /** Connection mechanism (e.g. 'Kafka consumer', 'gRPC') */
  mechanism: string;
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
}
