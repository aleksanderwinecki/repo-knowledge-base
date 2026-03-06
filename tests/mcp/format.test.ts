import { describe, it, expect } from 'vitest';
import { formatResponse } from '../../src/mcp/format.js';

describe('formatResponse', () => {
  const simpleSummary = (items: unknown[]) => `Found ${items.length} results`;

  it('returns all items when under 4KB with truncated=false', () => {
    const items = [
      { name: 'foo', value: 1 },
      { name: 'bar', value: 2 },
      { name: 'baz', value: 3 },
    ];

    const result = formatResponse(items, simpleSummary);
    const parsed = JSON.parse(result);

    expect(parsed.data).toHaveLength(3);
    expect(parsed.truncated).toBe(false);
    expect(parsed.total).toBe(3);
    expect(parsed.summary).toBe('Found 3 results');
    expect(result.length).toBeLessThanOrEqual(4000);
  });

  it('truncates large item sets to fit under 4KB with truncated=true', () => {
    // Generate 100 items with large string fields
    const items = Array.from({ length: 100 }, (_, i) => ({
      name: `item-${i}`,
      description: 'x'.repeat(200),
    }));

    const result = formatResponse(items, simpleSummary);
    const parsed = JSON.parse(result);

    expect(result.length).toBeLessThanOrEqual(4000);
    expect(parsed.truncated).toBe(true);
    expect(parsed.total).toBe(100);
    expect(parsed.data.length).toBeLessThan(100);
  });

  it('handles items that exceed 4KB even at limit=1 via recursive reduction', () => {
    // Single item with a massive string field
    const items = [{ name: 'huge', content: 'x'.repeat(5000) }];

    const result = formatResponse(items, simpleSummary);
    const parsed = JSON.parse(result);

    expect(result.length).toBeLessThanOrEqual(4000);
    expect(parsed.data).toHaveLength(1);
    expect(parsed.truncated).toBe(false);
    // The content field should be truncated
    expect(parsed.data[0].content.length).toBeLessThan(5000);
  });

  it('returns proper structure for empty input', () => {
    const result = formatResponse([], simpleSummary);
    const parsed = JSON.parse(result);

    expect(parsed.summary).toBe('Found 0 results');
    expect(parsed.data).toEqual([]);
    expect(parsed.total).toBe(0);
    expect(parsed.truncated).toBe(false);
    expect(result.length).toBeLessThanOrEqual(4000);
  });

  it('calls custom summaryFn with the truncated array', () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    let receivedCount = -1;
    const trackingSummary = (shown: unknown[]) => {
      receivedCount = shown.length;
      return `Showing ${shown.length} of many`;
    };

    const result = formatResponse(items, trackingSummary, 5);
    const parsed = JSON.parse(result);

    expect(receivedCount).toBe(5);
    expect(parsed.data).toHaveLength(5);
    expect(parsed.summary).toBe('Showing 5 of many');
  });

  it('always includes summary, data, total, and truncated fields', () => {
    const result = formatResponse([{ a: 1 }], simpleSummary);
    const parsed = JSON.parse(result);

    expect(parsed).toHaveProperty('summary');
    expect(parsed).toHaveProperty('data');
    expect(parsed).toHaveProperty('total');
    expect(parsed).toHaveProperty('truncated');
  });

  it('output is always valid JSON string under 4000 characters', () => {
    // Test with various sizes
    const sizes = [0, 1, 5, 50, 200];
    for (const size of sizes) {
      const items = Array.from({ length: size }, (_, i) => ({
        id: i,
        text: `item ${i} with some content padding`,
      }));

      const result = formatResponse(items, simpleSummary);

      expect(result.length).toBeLessThanOrEqual(4000);
      expect(() => JSON.parse(result)).not.toThrow();
    }
  });

  it('respects custom maxItems parameter', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ id: i }));

    const result = formatResponse(items, simpleSummary, 3);
    const parsed = JSON.parse(result);

    expect(parsed.data).toHaveLength(3);
    expect(parsed.total).toBe(10);
    expect(parsed.truncated).toBe(true);
  });
});
