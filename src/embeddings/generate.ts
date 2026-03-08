import type Database from 'better-sqlite3';
import { isVecAvailable } from '../db/vec.js';
import { composeEmbeddingText } from './text.js';
import type { EmbeddingEntity } from './text.js';
import { generateEmbeddingsBatch } from './pipeline.js';

/** Number of entities to embed in one batch */
const CHUNK_SIZE = 32;

/** Entity types and their DB table/column mappings for querying */
const ENTITY_QUERIES = [
  {
    type: 'module',
    sql: `SELECT id, name, type, summary FROM modules`,
    map: (row: any): EmbeddingEntity => ({
      entityType: 'module',
      entityId: row.id,
      name: row.name,
      type: row.type,
      summary: row.summary,
    }),
  },
  {
    type: 'event',
    sql: `SELECT id, name, schema_definition FROM events`,
    map: (row: any): EmbeddingEntity => ({
      entityType: 'event',
      entityId: row.id,
      name: row.name,
      schemaDefinition: row.schema_definition,
    }),
  },
  {
    type: 'service',
    sql: `SELECT id, name, description FROM services`,
    map: (row: any): EmbeddingEntity => ({
      entityType: 'service',
      entityId: row.id,
      name: row.name,
      description: row.description,
    }),
  },
  {
    type: 'repo',
    sql: `SELECT id, name, description FROM repos`,
    map: (row: any): EmbeddingEntity => ({
      entityType: 'repo',
      entityId: row.id,
      name: row.name,
      description: row.description,
    }),
  },
  {
    type: 'learned_fact',
    sql: `SELECT id, content, repo FROM learned_facts`,
    map: (row: any): EmbeddingEntity => ({
      entityType: 'learned_fact',
      entityId: row.id,
      content: row.content,
      repo: row.repo,
    }),
  },
] as const;

/**
 * Generate embeddings for all entities in the database.
 *
 * @param db - Database handle
 * @param force - If true, re-embed all entities. If false, only embed entities
 *   not already in entity_embeddings.
 * @returns Number of embeddings generated
 */
export async function generateAllEmbeddings(
  db: Database.Database,
  force: boolean,
): Promise<number> {
  if (!isVecAvailable()) return 0;

  // Build set of already-embedded entities for incremental mode
  let existingSet: Set<string> | null = null;
  if (!force) {
    const existing = db
      .prepare('SELECT entity_type, entity_id FROM entity_embeddings')
      .all() as { entity_type: string; entity_id: string }[];
    existingSet = new Set(existing.map((r) => `${r.entity_type}:${r.entity_id}`));
  }

  // Collect all entities to embed
  interface EmbeddingWork {
    entity: EmbeddingEntity;
    text: string;
  }

  const work: EmbeddingWork[] = [];

  for (const query of ENTITY_QUERIES) {
    const rows = db.prepare(query.sql).all();
    for (const row of rows) {
      const entity = query.map(row);

      // Skip already-embedded entities in incremental mode
      if (existingSet?.has(`${entity.entityType}:${entity.entityId}`)) {
        continue;
      }

      const text = composeEmbeddingText(entity);
      if (text === null) continue;

      work.push({ entity, text });
    }
  }

  if (work.length === 0) return 0;

  // Process in chunks
  const insertStmt = db.prepare(
    'INSERT INTO entity_embeddings(embedding, entity_type, entity_id) VALUES (?, ?, ?)',
  );

  let totalInserted = 0;

  for (let i = 0; i < work.length; i += CHUNK_SIZE) {
    const chunk = work.slice(i, i + CHUNK_SIZE);
    const texts = chunk.map((w) => w.text);

    try {
      // Async: generate embeddings
      const embeddings = await generateEmbeddingsBatch(texts);

      // Sync: batch-insert into vec0 within a transaction
      const insertChunk = db.transaction(() => {
        for (let j = 0; j < chunk.length; j++) {
          const embedding = embeddings[j]!;
          const entity = chunk[j]!.entity;
          insertStmt.run(
            Buffer.from(embedding.buffer),
            entity.entityType,
            String(entity.entityId),
          );
        }
      });
      insertChunk();

      totalInserted += chunk.length;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const chunkIdx = Math.floor(i / CHUNK_SIZE);
      console.warn(`Embedding chunk ${chunkIdx} failed: ${msg}`);
      // Continue to next chunk (Pitfall: embedding failures are isolated)
    }
  }

  return totalInserted;
}
