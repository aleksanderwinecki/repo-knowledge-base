import { pipeline, layer_norm, env } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import path from 'path';
import os from 'os';

/** Matryoshka truncation dimension for nomic-embed-text-v1.5 */
export const MATRYOSHKA_DIM = 256;

/** Model identifier on Hugging Face Hub */
const MODEL_ID = 'nomic-ai/nomic-embed-text-v1.5';

/** Singleton pipeline instance */
let extractor: FeatureExtractionPipeline | null = null;

/**
 * Get or create the embedding pipeline (singleton).
 * Lazy-loads the model on first call. Subsequent calls return the cached instance.
 */
export async function getEmbeddingPipeline(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    // Cache models in a stable location across reinstalls
    env.cacheDir = path.join(os.homedir(), '.kb', 'models');

    console.log('Downloading embedding model (first run only)...');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    extractor = (await (pipeline as any)('feature-extraction', MODEL_ID, {
      dtype: 'fp32',
    })) as FeatureExtractionPipeline;
  }
  return extractor;
}

/**
 * Generate a single 256d embedding from text.
 * Applies "search_document: " prefix, mean pooling, layer_norm,
 * Matryoshka truncation to 256d, and L2 normalization.
 */
export async function generateEmbedding(text: string): Promise<Float32Array> {
  const pipe = await getEmbeddingPipeline();

  // nomic-embed-text requires task-specific prefix for indexing
  const prefixedText = `search_document: ${text}`;

  // Run inference with mean pooling
  let output = await pipe(prefixedText, { pooling: 'mean' });

  // Matryoshka truncation: layer_norm -> slice to 256d -> L2 normalize
  const dimSize = output.dims[1] ?? MATRYOSHKA_DIM;
  output = layer_norm(output, [dimSize])
    .slice(null, [0, MATRYOSHKA_DIM])
    .normalize(2, -1);

  return new Float32Array((output.data as Float32Array).slice(0, MATRYOSHKA_DIM));
}

/**
 * Generate embeddings for a batch of texts.
 * Each text gets "search_document: " prefix, then the batch is processed
 * with mean pooling + Matryoshka truncation to 256d + L2 normalization.
 *
 * Returns one Float32Array per input text.
 */
export async function generateEmbeddingsBatch(
  texts: string[],
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const pipe = await getEmbeddingPipeline();

  // Prefix each text for indexing
  const prefixed = texts.map((t) => `search_document: ${t}`);

  // Batch inference with mean pooling
  let output = await pipe(prefixed, { pooling: 'mean' });

  // Matryoshka truncation: layer_norm -> slice to 256d -> L2 normalize
  const batchDimSize = output.dims[1] ?? MATRYOSHKA_DIM;
  output = layer_norm(output, [batchDimSize])
    .slice(null, [0, MATRYOSHKA_DIM])
    .normalize(2, -1);

  // Extract per-text Float32Array from batched tensor
  const results: Float32Array[] = [];
  const data = output.data as Float32Array;
  for (let j = 0; j < texts.length; j++) {
    results.push(new Float32Array(data.slice(j * MATRYOSHKA_DIM, (j + 1) * MATRYOSHKA_DIM)));
  }
  return results;
}
