// Public API exports
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
