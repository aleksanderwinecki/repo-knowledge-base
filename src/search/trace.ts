import type Database from 'better-sqlite3';
import { buildGraph, shortestPath } from './graph.js';

// ─── Trace-specific types ────────────────────────────────────────────────

/** A single hop in a trace result (no IDs, no confidence) */
export interface TraceHop {
  from: string;
  to: string;
  mechanism: string;
  via?: string; // Only present for event/kafka hops with non-null via
}

/** Result of a shortest-path trace between two services */
export interface TraceResult {
  from: string;
  to: string;
  path_summary: string;
  hop_count: number;
  hops: TraceHop[];
}

// ─── Core function ───────────────────────────────────────────────────────

/**
 * Trace the shortest path between two services.
 *
 * Builds the graph, validates both service names, handles same-service case,
 * then calls shortestPath and formats the result into a clean response shape
 * with a human-readable arrow-chain path summary.
 *
 * @throws Error if one or both services not found in the graph
 * @throws Error if no path exists between the two services
 */
export function traceRoute(
  db: Database.Database,
  from: string,
  to: string,
): TraceResult {
  const graph = buildGraph(db);

  // Validate both services upfront -- collect all missing, throw once
  const fromId = graph.repoIds.get(from);
  const toId = graph.repoIds.get(to);
  const missing: string[] = [];
  if (fromId === undefined) missing.push(from);
  if (toId === undefined) missing.push(to);
  if (missing.length > 0) {
    throw new Error(
      missing.length === 1
        ? `Service not found: ${missing[0]}`
        : `Services not found: ${missing.join(', ')}`,
    );
  }

  // Same-service case -- checked before calling shortestPath
  if (from === to) {
    return {
      from,
      to,
      path_summary: `${from} (same service)`,
      hop_count: 0,
      hops: [],
    };
  }

  const path = shortestPath(graph, fromId!, toId!);
  if (path === null) {
    throw new Error(`No path between ${from} and ${to}`);
  }

  // Map GraphHop[] to TraceHop[] -- strip IDs, strip confidence, conditionally include via
  const hops: TraceHop[] = path.map((hop) => {
    const entry: TraceHop = {
      from: hop.fromRepoName,
      to: hop.toRepoName,
      mechanism: hop.mechanism,
    };
    // Only include via for event/kafka hops when via is non-null
    if (hop.via && (hop.mechanism === 'event' || hop.mechanism === 'kafka')) {
      entry.via = hop.via;
    }
    return entry;
  });

  return {
    from,
    to,
    path_summary: buildPathSummary(hops),
    hop_count: hops.length,
    hops,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build arrow-chain path summary from hops.
 *
 * - grpc/http/gateway: "A -[grpc]-> B"
 * - event/kafka with via: "A -[event: OrderCreated]-> B"
 * - event/kafka without via: "A -[event]-> B"
 */
function buildPathSummary(hops: TraceHop[]): string {
  if (hops.length === 0) return '';
  let result = hops[0]!.from;
  for (const hop of hops) {
    const label = hop.via ? `${hop.mechanism}: ${hop.via}` : hop.mechanism;
    result += ` -[${label}]-> ${hop.to}`;
  }
  return result;
}
