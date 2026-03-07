// Public API exports

// Database
export { openDatabase, closeDatabase, registerShutdownHandlers } from './db/database.js';
export { initializeSchema, SCHEMA_VERSION } from './db/schema.js';
export type {
  Repo,
  File,
  Module,
  Service,
  Event,
  Edge,
  EntityType,
  RelationshipType,
} from './types/entities.js';
export { tokenizeForFts } from './db/tokenizer.js';
export { indexEntity, removeEntity, search } from './db/fts.js';
export type { SearchResult } from './db/fts.js';

// Indexer - Infrastructure (Plan 01)
export { discoverRepos } from './indexer/scanner.js';
export { extractMetadata } from './indexer/metadata.js';
export type { RepoMetadata } from './indexer/metadata.js';
export { getCurrentCommit, isCommitReachable } from './indexer/git.js';
export { persistRepoData, clearRepoEntities, clearRepoFiles } from './indexer/writer.js';
export type { RepoData, ModuleData, EventData, EdgeData } from './indexer/writer.js';

// Indexer - Extractors (Plan 02)
export { extractElixirModules } from './indexer/elixir.js';
export type { ElixirModule } from './indexer/elixir.js';
export { extractProtoDefinitions } from './indexer/proto.js';
export type { ProtoDefinition, ProtoMessage, ProtoService, ProtoField, ProtoRpc } from './indexer/proto.js';
export { detectEventRelationships } from './indexer/events.js';
export type { EventRelationship } from './indexer/events.js';
export { indexAllRepos, indexSingleRepo } from './indexer/pipeline.js';
export type { IndexResult, IndexOptions, IndexStats } from './indexer/pipeline.js';

// Search (Plan 03-01)
export { searchText, findEntity, queryDependencies } from './search/index.js';
export type {
  TextSearchResult,
  TextSearchOptions,
  EntityCard,
  EntityRelationship,
  EntityFilters,
  DependencyResult,
  DependencyNode,
  DependencyOptions,
} from './search/index.js';

// Knowledge (Plan 04-02)
export { learnFact, listFacts, forgetFact } from './knowledge/store.js';
export type { LearnedFact } from './knowledge/types.js';
