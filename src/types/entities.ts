/** Core entity types for the repo knowledge base */

export interface Repo {
  id: number;
  name: string;
  path: string;
  description: string | null;
  lastIndexedCommit: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface File {
  id: number;
  repoId: number;
  path: string;
  language: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Module {
  id: number;
  repoId: number;
  fileId: number | null;
  name: string;
  type: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Service {
  id: number;
  repoId: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  id: number;
  repoId: number;
  name: string;
  schemaDefinition: string | null;
  sourceFile: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Edge {
  id: number;
  sourceType: string;
  sourceId: number;
  targetType: string;
  targetId: number;
  relationshipType: string;
  sourceFile: string | null;
  metadata: string | null;
  createdAt: string;
}

/** Valid entity types for the knowledge base */
export type EntityType = 'repo' | 'file' | 'module' | 'service' | 'event' | 'learned_fact' | 'field';

/** Valid relationship types */
export type RelationshipType =
  | 'produces_event'
  | 'consumes_event'
  | 'calls_grpc'
  | 'exposes_graphql'
  | 'calls_http'
  | 'routes_to'
  | 'produces_kafka'
  | 'consumes_kafka';
