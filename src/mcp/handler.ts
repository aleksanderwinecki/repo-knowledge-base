/**
 * Higher-order function for MCP tool error handling.
 * Wraps a tool handler with try/catch and MCP envelope formatting.
 *
 * Inner handler may be sync (returns string) or async (returns Promise<string>)
 * to support async operations like auto-sync. The outer wrapper is always async
 * to satisfy the MCP SDK's Promise<CallToolResult> contract.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export function wrapToolHandler<Args>(
  toolName: string,
  handler: (args: Args) => string | Promise<string>,
): (args: Args, extra: unknown) => Promise<CallToolResult> {
  return async (args: Args): Promise<CallToolResult> => {
    try {
      const text = await handler(args);
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
