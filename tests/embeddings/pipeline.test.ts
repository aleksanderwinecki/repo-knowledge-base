import { describe, it, expect, vi } from 'vitest';

/**
 * Embedding pipeline tests.
 * These tests require model download on first run (~100MB).
 * Set SKIP_EMBEDDING_MODEL=1 to skip model-dependent tests in CI.
 *
 * Model-dependent tests use 120s timeout to accommodate first-run download.
 */

const SKIP_MODEL = process.env.SKIP_EMBEDDING_MODEL === '1';
const MODEL_TIMEOUT = 120_000;

describe('embedding pipeline', () => {
  describe('generateEmbedding', () => {
    it.skipIf(SKIP_MODEL)(
      'returns Float32Array of length 256',
      async () => {
        const { generateEmbedding } = await import('../../src/embeddings/pipeline.js');
        const result = await generateEmbedding('test text for embedding');
        expect(result).toBeInstanceOf(Float32Array);
        expect(result.length).toBe(256);
      },
      MODEL_TIMEOUT,
    );

    it.skipIf(SKIP_MODEL)(
      'produces L2-normalized output (norm ~1.0)',
      async () => {
        const { generateEmbedding } = await import('../../src/embeddings/pipeline.js');
        const result = await generateEmbedding('another test text');
        // Compute L2 norm
        let sumSq = 0;
        for (let i = 0; i < result.length; i++) {
          sumSq += result[i]! * result[i]!;
        }
        const norm = Math.sqrt(sumSq);
        expect(norm).toBeCloseTo(1.0, 1);
      },
      MODEL_TIMEOUT,
    );
  });

  describe('generateEmbeddingsBatch', () => {
    it.skipIf(SKIP_MODEL)(
      'returns correct count and dimensions for batch',
      async () => {
        const { generateEmbeddingsBatch } = await import('../../src/embeddings/pipeline.js');
        const texts = ['first text', 'second text', 'third text'];
        const results = await generateEmbeddingsBatch(texts);
        expect(results).toHaveLength(3);
        for (const vec of results) {
          expect(vec).toBeInstanceOf(Float32Array);
          expect(vec.length).toBe(256);
        }
      },
      MODEL_TIMEOUT,
    );

    it.skipIf(SKIP_MODEL)(
      'produces L2-normalized batch output',
      async () => {
        const { generateEmbeddingsBatch } = await import('../../src/embeddings/pipeline.js');
        const results = await generateEmbeddingsBatch(['text one', 'text two']);
        for (const vec of results) {
          let sumSq = 0;
          for (let i = 0; i < vec.length; i++) {
            sumSq += vec[i]! * vec[i]!;
          }
          const norm = Math.sqrt(sumSq);
          expect(norm).toBeCloseTo(1.0, 1);
        }
      },
      MODEL_TIMEOUT,
    );
  });

  describe('generateAllEmbeddings', () => {
    it('returns 0 when vec is unavailable', async () => {
      // Mock isVecAvailable to return false
      vi.doMock('../../src/db/vec.js', () => ({
        isVecAvailable: () => false,
        loadVecExtension: () => false,
      }));

      const { generateAllEmbeddings } = await import('../../src/embeddings/generate.js');
      // Pass a dummy db object -- it should never be touched
      const result = await generateAllEmbeddings({} as any, false);
      expect(result).toBe(0);

      vi.doUnmock('../../src/db/vec.js');
    });
  });
});
