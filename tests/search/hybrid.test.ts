import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TextSearchResult } from '../../src/search/types.js';

/**
 * Hybrid search tests using fully mocked FTS5 + KNN backends.
 * Validates RRF scoring, deduplication, degradation, and limit behavior.
 */

// Helper to create a mock TextSearchResult
function mockResult(overrides: Partial<TextSearchResult> & { entityId: number; name: string }): TextSearchResult {
  return {
    entityType: 'module',
    subType: 'module',
    entityId: overrides.entityId,
    name: overrides.name,
    snippet: overrides.name,
    repoName: 'test-repo',
    repoPath: '/repos/test-repo',
    filePath: null,
    relevance: 0.5,
    ...overrides,
  };
}

// Mock searchText (sync)
vi.mock('../../src/search/text.js', () => ({
  searchText: vi.fn().mockReturnValue([]),
}));

// Mock searchSemantic (async)
vi.mock('../../src/search/semantic.js', () => ({
  searchSemantic: vi.fn().mockResolvedValue([]),
}));

let mockSearchText: ReturnType<typeof vi.fn>;
let mockSearchSemantic: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  const textMod = await import('../../src/search/text.js');
  const semMod = await import('../../src/search/semantic.js');
  mockSearchText = textMod.searchText as unknown as ReturnType<typeof vi.fn>;
  mockSearchSemantic = semMod.searchSemantic as unknown as ReturnType<typeof vi.fn>;
  mockSearchText.mockReset().mockReturnValue([]);
  mockSearchSemantic.mockReset().mockResolvedValue([]);
});

describe('searchHybrid', () => {
  it('returns merged RRF-scored results when both lists have results', async () => {
    mockSearchText.mockReturnValue([
      mockResult({ entityId: 1, name: 'Alpha', relevance: 10 }),
      mockResult({ entityId: 2, name: 'Beta', relevance: 8 }),
    ]);
    mockSearchSemantic.mockResolvedValue([
      mockResult({ entityId: 3, name: 'Gamma', relevance: 0.9 }),
      mockResult({ entityId: 4, name: 'Delta', relevance: 0.7 }),
    ]);

    const { searchHybrid } = await import('../../src/search/hybrid.js');
    const results = await searchHybrid({} as any, 'test query');

    expect(results.length).toBe(4);
    // All results should have RRF scores as relevance
    for (const r of results) {
      expect(r.relevance).toBeGreaterThan(0);
    }
  });

  it('entity in both lists gets higher score than entity in only one', async () => {
    const sharedEntity = mockResult({ entityId: 1, name: 'Shared' });

    mockSearchText.mockReturnValue([
      sharedEntity,
      mockResult({ entityId: 2, name: 'FtsOnly', relevance: 9 }),
    ]);
    mockSearchSemantic.mockResolvedValue([
      { ...sharedEntity }, // same entity appears in both
      mockResult({ entityId: 3, name: 'VecOnly', relevance: 0.8 }),
    ]);

    const { searchHybrid } = await import('../../src/search/hybrid.js');
    const results = await searchHybrid({} as any, 'test query');

    const sharedResult = results.find((r) => r.entityId === 1);
    const singleResult = results.find((r) => r.entityId === 2);

    expect(sharedResult).toBeDefined();
    expect(singleResult).toBeDefined();
    expect(sharedResult!.relevance).toBeGreaterThan(singleResult!.relevance);
  });

  it('returns FTS-only results when searchSemantic returns []', async () => {
    mockSearchText.mockReturnValue([
      mockResult({ entityId: 1, name: 'Alpha', relevance: 10 }),
      mockResult({ entityId: 2, name: 'Beta', relevance: 8 }),
    ]);
    mockSearchSemantic.mockResolvedValue([]);

    const { searchHybrid } = await import('../../src/search/hybrid.js');
    const results = await searchHybrid({} as any, 'test query');

    expect(results.length).toBe(2);
    expect(results[0]!.name).toBe('Alpha');
    expect(results[1]!.name).toBe('Beta');
  });

  it('respects limit option', async () => {
    mockSearchText.mockReturnValue([
      mockResult({ entityId: 1, name: 'A' }),
      mockResult({ entityId: 2, name: 'B' }),
      mockResult({ entityId: 3, name: 'C' }),
    ]);
    mockSearchSemantic.mockResolvedValue([
      mockResult({ entityId: 4, name: 'D' }),
      mockResult({ entityId: 5, name: 'E' }),
    ]);

    const { searchHybrid } = await import('../../src/search/hybrid.js');
    const results = await searchHybrid({} as any, 'test query', { limit: 3 });

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it('results sorted by RRF score descending', async () => {
    mockSearchText.mockReturnValue([
      mockResult({ entityId: 1, name: 'First' }),
      mockResult({ entityId: 2, name: 'Second' }),
      mockResult({ entityId: 3, name: 'Third' }),
    ]);
    mockSearchSemantic.mockResolvedValue([
      mockResult({ entityId: 4, name: 'Fourth' }),
    ]);

    const { searchHybrid } = await import('../../src/search/hybrid.js');
    const results = await searchHybrid({} as any, 'test query');

    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1]!.relevance).toBeGreaterThanOrEqual(results[i]!.relevance);
    }
  });

  it('RRF scores use 1-indexed ranks (first entry = 1/(k+1))', async () => {
    mockSearchText.mockReturnValue([
      mockResult({ entityId: 1, name: 'OnlyFts' }),
    ]);
    mockSearchSemantic.mockResolvedValue([]);

    const { searchHybrid, RRF_K } = await import('../../src/search/hybrid.js');
    const results = await searchHybrid({} as any, 'test query');

    // First FTS entry at rank 1: score = 1/(k + 0 + 1) = 1/(60 + 1) = 1/61
    expect(results[0]!.relevance).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it('no duplicate entities in output', async () => {
    const shared = mockResult({ entityId: 1, name: 'Shared' });

    mockSearchText.mockReturnValue([
      shared,
      mockResult({ entityId: 2, name: 'OnlyFts' }),
    ]);
    mockSearchSemantic.mockResolvedValue([
      { ...shared },
      mockResult({ entityId: 3, name: 'OnlyVec' }),
    ]);

    const { searchHybrid } = await import('../../src/search/hybrid.js');
    const results = await searchHybrid({} as any, 'test query');

    // Check no duplicate entityIds
    const ids = results.map((r) => `${r.entityType}:${r.entityId}`);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });
});

describe('withAutoSyncAsync', () => {
  it('awaits async queryFn before extracting repo names', async () => {
    const { withAutoSyncAsync } = await import('../../src/mcp/sync.js');

    // Mock checkAndSyncRepos to be a no-op
    vi.doMock('../../src/mcp/sync.js', async (importOriginal) => {
      const original = await importOriginal<typeof import('../../src/mcp/sync.js')>();
      return {
        ...original,
        checkAndSyncRepos: vi.fn().mockResolvedValue({ synced: [], skipped: [] }),
      };
    });

    const asyncQuery = vi.fn().mockResolvedValue(['result1', 'result2']);
    const extractRepos = vi.fn().mockReturnValue(['repo-a']);

    // withAutoSyncAsync should await the async queryFn
    const mod = await import('../../src/mcp/sync.js');
    const result = await mod.withAutoSyncAsync(
      {} as any,
      asyncQuery,
      extractRepos,
    );

    expect(result).toEqual(['result1', 'result2']);
    expect(asyncQuery).toHaveBeenCalled();
    expect(extractRepos).toHaveBeenCalledWith(['result1', 'result2']);

    vi.doUnmock('../../src/mcp/sync.js');
  });
});
