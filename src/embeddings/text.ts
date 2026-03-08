import { tokenizeForFts } from '../db/tokenizer.js';

/**
 * Entity data for embedding text composition.
 * Fields vary by entity type; unused fields should be null/undefined.
 */
export interface EmbeddingEntity {
  entityType: string;
  entityId: number;
  name?: string | null;
  type?: string | null;
  summary?: string | null;
  description?: string | null;
  schemaDefinition?: string | null;
  content?: string | null;
  repo?: string | null;
}

/**
 * Compose embedding input text from entity fields, then preprocess
 * through tokenizeForFts for CamelCase/snake_case splitting.
 *
 * Returns null if the entity type is unknown or all relevant fields are empty.
 */
export function composeEmbeddingText(entity: EmbeddingEntity): string | null {
  const parts: string[] = [];

  switch (entity.entityType) {
    case 'module':
      if (entity.name) parts.push(entity.name);
      if (entity.type) parts.push(entity.type);
      if (entity.summary) parts.push(entity.summary);
      break;
    case 'event':
      if (entity.name) parts.push(entity.name);
      if (entity.schemaDefinition) parts.push(entity.schemaDefinition);
      break;
    case 'service':
      if (entity.name) parts.push(entity.name);
      if (entity.description) parts.push(entity.description);
      break;
    case 'repo':
      if (entity.name) parts.push(entity.name);
      if (entity.description) parts.push(entity.description);
      break;
    case 'learned_fact':
      if (entity.content) parts.push(entity.content);
      if (entity.repo) parts.push(entity.repo);
      break;
    default:
      return null;
  }

  if (parts.length === 0) return null;

  // SEM-03: preprocess through tokenizeForFts
  return tokenizeForFts(parts.join(' '));
}
