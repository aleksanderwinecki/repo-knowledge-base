import type Database from 'better-sqlite3';
import type { ImpactNode } from './types.js';
import { buildGraph, bfsUpstream } from './graph.js';

// ─── Impact-specific types (NOT shared graph types) ─────────────────────

/** A single service entry within a tier */
export interface ImpactServiceEntry {
  name: string;
  mechanisms: string[];
  confidence: Array<string | null>;
}

/** Statistics for an impact analysis result */
export interface ImpactStats {
  total: number;
  blastRadiusScore: number;
  mechanisms: Record<string, number>;
}

/** Tiered impact analysis result */
export interface ImpactResult {
  service: string;
  tiers: {
    direct: ImpactServiceEntry[];
    indirect: ImpactServiceEntry[];
    transitive: ImpactServiceEntry[];
  };
  stats: ImpactStats;
  summary: string;
}

/** Options for analyzeImpact */
export interface ImpactOptions {
  mechanism?: string;
  maxDepth?: number;
}

/** Compact format for MCP responses (budget: 4000 chars) */
export interface ImpactCompact {
  summary: string;
  stats: ImpactStats;
  direct: Record<string, string[]>;
  indirect: Record<string, string[]>;
  transitive: Record<string, string[]>;
  transitive_truncated?: string;
}

// ─── Core function ──────────────────────────────────────────────────────

/**
 * Analyze the blast radius of a service: who depends on it and how badly.
 *
 * Builds the graph, runs BFS upstream, classifies nodes into tiers,
 * computes stats, and generates a human-readable summary.
 *
 * @throws Error if serviceName is not found in the graph
 */
export function analyzeImpact(
  db: Database.Database,
  serviceName: string,
  options?: ImpactOptions,
): ImpactResult {
  const graph = buildGraph(db);

  const repoId = graph.repoIds.get(serviceName);
  if (repoId === undefined) {
    throw new Error(`Service not found: ${serviceName}`);
  }

  const maxDepth = options?.maxDepth ?? 3;
  const mechanismFilter = options?.mechanism;

  const nodes = bfsUpstream(graph, repoId, maxDepth, mechanismFilter);

  const tiers = classifyByTier(nodes);
  const stats = computeStats(tiers);
  const summary = buildSummary(serviceName, tiers, stats);

  return { service: serviceName, tiers, stats, summary };
}

// ─── Tier classification ────────────────────────────────────────────────

function classifyByTier(nodes: ImpactNode[]): ImpactResult['tiers'] {
  const direct: ImpactServiceEntry[] = [];
  const indirect: ImpactServiceEntry[] = [];
  const transitive: ImpactServiceEntry[] = [];

  for (const node of nodes) {
    const entry = nodeToEntry(node);

    if (node.depth === 1) {
      direct.push(entry);
    } else if (node.depth === 2) {
      indirect.push(entry);
    } else {
      // depth 3+ -> single transitive bucket
      transitive.push(entry);
    }
  }

  return { direct, indirect, transitive };
}

function nodeToEntry(node: ImpactNode): ImpactServiceEntry {
  // Dedupe mechanisms, keep all confidence values
  const mechanismSet = new Set<string>();
  const confidence: Array<string | null> = [];

  for (const edge of node.edges) {
    mechanismSet.add(edge.mechanism);
    confidence.push(edge.confidence);
  }

  return {
    name: node.repoName,
    mechanisms: [...mechanismSet],
    confidence,
  };
}

// ─── Stats computation ──────────────────────────────────────────────────

function computeStats(tiers: ImpactResult['tiers']): ImpactStats {
  const total = tiers.direct.length + tiers.indirect.length + tiers.transitive.length;
  const blastRadiusScore =
    tiers.direct.length * 3 +
    tiers.indirect.length * 2 +
    tiers.transitive.length * 1;

  // Count mechanism occurrences across ALL edges in all tiers
  const mechanisms: Record<string, number> = {};
  const allEntries = [...tiers.direct, ...tiers.indirect, ...tiers.transitive];
  for (const entry of allEntries) {
    for (const mech of entry.mechanisms) {
      mechanisms[mech] = (mechanisms[mech] ?? 0) + 1;
    }
  }

  return { total, blastRadiusScore, mechanisms };
}

// ─── Summary builder ────────────────────────────────────────────────────

function buildSummary(
  serviceName: string,
  tiers: ImpactResult['tiers'],
  stats: ImpactStats,
): string {
  return `${serviceName}: ${tiers.direct.length} direct, ${tiers.indirect.length} indirect, ${tiers.transitive.length} transitive (score: ${stats.blastRadiusScore})`;
}

// ─── Formatters ─────────────────────────────────────────────────────────

/**
 * Verbose formatter: returns the full ImpactResult as-is.
 * CLI will JSON.stringify this for display.
 */
export function formatImpactVerbose(result: ImpactResult): ImpactResult {
  return result;
}

/**
 * Compact formatter for MCP responses.
 * - Per-service: name -> mechanisms array (no confidence)
 * - Always includes: summary, stats, all direct, all indirect
 * - Transitive: fill until 4000-char budget, then "...and N more"
 */
export function formatImpactCompact(result: ImpactResult): ImpactCompact {
  const MAX_CHARS = 4000;

  // Build the fixed parts first (summary, stats, direct, indirect)
  const direct = entriesToCompactMap(result.tiers.direct);
  const indirect = entriesToCompactMap(result.tiers.indirect);

  const base: ImpactCompact = {
    summary: result.summary,
    stats: result.stats,
    direct,
    indirect,
    transitive: {},
  };

  // Measure what we have so far, reserving space for truncation message
  // We need to know the max possible truncation message to budget correctly
  const totalTransitive = result.tiers.transitive.length;
  const maxTruncationMsg = `...and ${totalTransitive} more`;
  const truncationReserve = JSON.stringify({ transitive_truncated: maxTruncationMsg }).length;

  // Calculate remaining budget for transitive entries
  const baseSerialized = JSON.stringify(base);
  // The base has transitive:{} which is 16 chars ("transitive":{}). We'll replace it.
  let remainingBudget = MAX_CHARS - baseSerialized.length - truncationReserve;

  // Fill transitive entries until budget exhausted
  const transitive: Record<string, string[]> = {};
  let includedCount = 0;

  for (const entry of result.tiers.transitive) {
    const entryJson = JSON.stringify({ [entry.name]: entry.mechanisms });
    // Account for comma separator and merge into the transitive object
    const costEstimate = entryJson.length; // rough: key + value + comma overhead

    if (remainingBudget - costEstimate < 0) {
      break;
    }

    transitive[entry.name] = entry.mechanisms;
    remainingBudget -= costEstimate;
    includedCount++;
  }

  base.transitive = transitive;

  // Add truncation message if we didn't include all transitive services
  const omitted = totalTransitive - includedCount;
  if (omitted > 0) {
    base.transitive_truncated = `...and ${omitted} more`;
  }

  return base;
}

function entriesToCompactMap(entries: ImpactServiceEntry[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const entry of entries) {
    map[entry.name] = entry.mechanisms;
  }
  return map;
}
