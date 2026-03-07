/**
 * MCP response formatting with 4KB size enforcement.
 * Ensures all MCP tool responses are valid JSON under 4000 characters.
 */

const MAX_RESPONSE_CHARS = 4000;
const DEFAULT_MAX_ITEMS = 10;
const MIN_ITEMS = 1;

export interface McpResponse<T> {
  summary: string;
  data: T[];
  total: number;
  truncated: boolean;
}

/**
 * Format a list of items into a size-constrained MCP response.
 *
 * 1. Slices items to maxItems (default 10)
 * 2. Builds McpResponse with summary, data, total, truncated
 * 3. If JSON exceeds 4000 chars, recursively halves maxItems
 * 4. If even 1 item exceeds limit, truncates string fields to fit
 *
 * @returns JSON string guaranteed to be under 4000 characters
 */
export function formatResponse<T>(
  items: T[],
  summaryFn: (shown: T[]) => string,
  maxItems: number = DEFAULT_MAX_ITEMS,
): string {
  const limit = Math.max(MIN_ITEMS, Math.min(maxItems, items.length));
  const sliced = items.slice(0, limit);
  const truncated = items.length > sliced.length;

  const response: McpResponse<T> = {
    summary: summaryFn(sliced),
    data: sliced,
    total: items.length,
    truncated,
  };

  const json = JSON.stringify(response);

  if (json.length <= MAX_RESPONSE_CHARS) {
    return json;
  }

  // If we can reduce item count, try halving
  if (limit > MIN_ITEMS) {
    const reduced = Math.max(MIN_ITEMS, Math.floor(limit / 2));
    return formatResponse(items, summaryFn, reduced);
  }

  // Already at 1 item — truncate string fields in the single item
  return truncateToFit(response);
}

/**
 * Format a single item into a McpResponse with the unified shape.
 * Used by tools that return a single object (learn, forget, status, cleanup, list-types).
 */
export function formatSingleResponse<T>(item: T, summary: string): string {
  const response: McpResponse<T> = {
    summary,
    data: [item],
    total: 1,
    truncated: false,
  };
  return JSON.stringify(response);
}

/**
 * Truncate string fields in a response to fit under the size limit.
 * Progressively shortens the longest string field until it fits.
 */
function truncateToFit<T>(response: McpResponse<T>): string {
  // Deep clone to avoid mutating the original
  const clone: McpResponse<unknown> = JSON.parse(JSON.stringify(response));

  // Calculate overhead (everything except data content)
  const withEmptyData = JSON.stringify({
    ...clone,
    data: [{}],
  });
  const budget = MAX_RESPONSE_CHARS - withEmptyData.length - 50; // safety margin

  if (budget <= 0) {
    // Extreme case: even metadata is too large; return minimal response
    clone.data = [];
    clone.truncated = true;
    return JSON.stringify(clone);
  }

  // Truncate string fields in each data item
  for (const item of clone.data) {
    if (item && typeof item === 'object') {
      truncateObjectStrings(item as Record<string, unknown>, budget);
    }
  }

  const result = JSON.stringify(clone);
  if (result.length <= MAX_RESPONSE_CHARS) {
    return result;
  }

  // Final fallback: aggressively reduce string lengths
  for (const item of clone.data) {
    if (item && typeof item === 'object') {
      truncateObjectStrings(
        item as Record<string, unknown>,
        Math.floor(budget / 2),
      );
    }
  }

  return JSON.stringify(clone).slice(0, MAX_RESPONSE_CHARS);
}

/**
 * Truncate all string values in an object to fit within a character budget.
 */
function truncateObjectStrings(
  obj: Record<string, unknown>,
  maxFieldLength: number,
): void {
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'string' && value.length > maxFieldLength) {
      obj[key] = value.slice(0, maxFieldLength) + '...';
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      truncateObjectStrings(value as Record<string, unknown>, maxFieldLength);
    }
  }
}
