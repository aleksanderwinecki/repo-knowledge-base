/**
 * Higher-order function for MCP tool error handling.
 * Wraps a synchronous tool handler with try/catch and MCP envelope formatting.
 *
 * Inner handler is SYNC (returns string) because all DB operations use
 * better-sqlite3 which is synchronous. The outer wrapper is async to satisfy
 * the MCP SDK's Promise<CallToolResult> contract.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function wrapToolHandler<Args>(
  toolName: string,
  handler: (args: Args) => string,
): (args: Args, extra: unknown) => Promise<CallToolResult> {
  return async (args: Args): Promise<CallToolResult> => {
    try {
      const text = handler(args);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: 'text', text: `Error in ${toolName}: ${message}` }],
        isError: true,
      };
    }
  };
}
