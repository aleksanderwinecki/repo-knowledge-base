import type Database from 'better-sqlite3';
import { DIRECT_EDGE_TYPES } from './edge-utils.js';
import { extractMetadataField } from './edge-utils.js';

// ─── Types ───────────────────────────────────────────────────────────────

export interface ExplainResult {
  name: string;
  description: string | null;
  path: string;
  summary: string;
  talks_to: Record<string, string[]>;
  called_by: Record<string, string[]>;
  events: {
    produces: string[];
    consumes: string[];
  };
  modules: Record<string, { count: number; top: string[] }>;
  counts: {
    files: number;
    grpc_services: number;
  };
  hints: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────

/** Map relationship_type to short mechanism key */
const MECHANISM_MAP: Record<string, string> = {
  calls_grpc: 'grpc',
  calls_http: 'http',
  routes_to: 'gateway',
};

const CONNECTION_CAP = 20;

const AGENT_HINTS = [
  'Run kb_impact <this-service> to see blast radius',
  'Run kb_trace <this-service> <other-service> to trace a call path',
  'Run kb_deps <this-service> to see direct dependencies',
];

// ─── Core function ───────────────────────────────────────────────────────

/**
 * Build a structured service explanation card by aggregating data
 * from existing SQLite tables. Pure SQL -- no graph module dependency.
 *
 * @throws Error if service not found in repos table
 */
export function explainService(
  db: Database.Database,
  name: string,
): ExplainResult {
  // 1. Repo lookup
  const repo = db.prepare(
    'SELECT id, name, path, description FROM repos WHERE name = ?',
  ).get(name) as { id: number; name: string; path: string; description: string | null } | undefined;

  if (!repo) {
    throw new Error(`Service not found: ${name}`);
  }

  // 2. Connections
  const talksTo = new Map<string, Set<string>>();
  const calledBy = new Map<string, Set<string>>();

  gatherDirectOutbound(db, repo.id, talksTo);
  gatherDirectInbound(db, repo.id, calledBy);
  gatherEventMediatedOutbound(db, repo.id, talksTo);
  gatherEventMediatedInbound(db, repo.id, calledBy);
  gatherKafkaMediatedOutbound(db, repo.id, talksTo);
  gatherKafkaMediatedInbound(db, repo.id, calledBy);

  // Exclude self-references
  for (const [, names] of talksTo) names.delete(repo.name);
  for (const [, names] of calledBy) names.delete(repo.name);

  // Remove empty mechanism groups
  for (const [mech, names] of talksTo) {
    if (names.size === 0) talksTo.delete(mech);
  }
  for (const [mech, names] of calledBy) {
    if (names.size === 0) calledBy.delete(mech);
  }

  // Convert to sorted arrays and apply truncation
  const talksToRecord = mapToRecord(talksTo);
  const calledByRecord = mapToRecord(calledBy);
  const truncatedTalksTo = truncateConnections(talksToRecord, CONNECTION_CAP);
  const truncatedCalledBy = truncateConnections(calledByRecord, CONNECTION_CAP);

  // 3. Summary line
  const summary = buildConnectionSummary(talksToRecord, calledByRecord);

  // 4. Events
  const events = gatherEvents(db, repo.id);

  // 5. Modules
  const modules = gatherModules(db, repo.id);

  // 6. Counts
  const counts = gatherCounts(db, repo.id);

  // 7. Hints
  const hints = AGENT_HINTS.map(h => h.replace(/<this-service>/g, repo.name));

  return {
    name: repo.name,
    description: repo.description,
    path: repo.path,
    summary,
    talks_to: truncatedTalksTo,
    called_by: truncatedCalledBy,
    events,
    modules,
    counts,
    hints,
  };
}

// ─── Connection helpers ──────────────────────────────────────────────────

function addToMap(map: Map<string, Set<string>>, mechanism: string, serviceName: string): void {
  let set = map.get(mechanism);
  if (!set) {
    set = new Set();
    map.set(mechanism, set);
  }
  set.add(serviceName);
}

function gatherDirectOutbound(
  db: Database.Database,
  repoId: number,
  talksTo: Map<string, Set<string>>,
): void {
  const placeholders = DIRECT_EDGE_TYPES.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT r.name as target_name, e.relationship_type
    FROM edges e
    JOIN repos r ON r.id = e.target_id
    WHERE e.source_type = 'repo' AND e.source_id = ?
      AND e.target_type = 'repo'
      AND e.relationship_type IN (${placeholders})
  `).all(repoId, ...DIRECT_EDGE_TYPES) as Array<{ target_name: string; relationship_type: string }>;

  for (const row of rows) {
    const mech = MECHANISM_MAP[row.relationship_type] ?? row.relationship_type;
    addToMap(talksTo, mech, row.target_name);
  }
}

function gatherDirectInbound(
  db: Database.Database,
  repoId: number,
  calledBy: Map<string, Set<string>>,
): void {
  const placeholders = DIRECT_EDGE_TYPES.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT r.name as source_name, e.relationship_type
    FROM edges e
    JOIN repos r ON r.id = e.source_id
    WHERE e.target_type = 'repo' AND e.target_id = ?
      AND e.source_type = 'repo'
      AND e.relationship_type IN (${placeholders})
  `).all(repoId, ...DIRECT_EDGE_TYPES) as Array<{ source_name: string; relationship_type: string }>;

  for (const row of rows) {
    const mech = MECHANISM_MAP[row.relationship_type] ?? row.relationship_type;
    addToMap(calledBy, mech, row.source_name);
  }
}

function gatherEventMediatedOutbound(
  db: Database.Database,
  repoId: number,
  talksTo: Map<string, Set<string>>,
): void {
  // Find events this repo produces, then find other repos that consume them
  const producedEvents = db.prepare(`
    SELECT e.target_id as event_id
    FROM edges e
    WHERE e.source_type = 'repo' AND e.source_id = ?
      AND e.relationship_type = 'produces_event'
  `).all(repoId) as Array<{ event_id: number }>;

  for (const evt of producedEvents) {
    const consumers = db.prepare(`
      SELECT r.name as repo_name
      FROM edges e
      JOIN repos r ON r.id = e.source_id
      WHERE e.target_type = 'event' AND e.target_id = ?
        AND e.relationship_type = 'consumes_event'
        AND e.source_id != ?
    `).all(evt.event_id, repoId) as Array<{ repo_name: string }>;

    for (const consumer of consumers) {
      addToMap(talksTo, 'event', consumer.repo_name);
    }
  }
}

function gatherEventMediatedInbound(
  db: Database.Database,
  repoId: number,
  calledBy: Map<string, Set<string>>,
): void {
  // Find events this repo consumes, then find other repos that produce them
  const consumedEvents = db.prepare(`
    SELECT e.target_id as event_id
    FROM edges e
    WHERE e.source_type = 'repo' AND e.source_id = ?
      AND e.relationship_type = 'consumes_event'
  `).all(repoId) as Array<{ event_id: number }>;

  for (const evt of consumedEvents) {
    const producers = db.prepare(`
      SELECT r.name as repo_name
      FROM edges e
      JOIN repos r ON r.id = e.source_id
      WHERE e.target_type = 'event' AND e.target_id = ?
        AND e.relationship_type = 'produces_event'
        AND e.source_id != ?
    `).all(evt.event_id, repoId) as Array<{ repo_name: string }>;

    for (const producer of producers) {
      addToMap(calledBy, 'event', producer.repo_name);
    }
  }
}

function gatherKafkaMediatedOutbound(
  db: Database.Database,
  repoId: number,
  talksTo: Map<string, Set<string>>,
): void {
  // Find kafka topics this repo produces
  const myEdges = db.prepare(`
    SELECT metadata FROM edges
    WHERE source_type = 'repo' AND source_id = ?
      AND relationship_type = 'produces_kafka'
  `).all(repoId) as Array<{ metadata: string | null }>;

  const topics = new Set<string>();
  for (const edge of myEdges) {
    const topic = extractMetadataField(edge.metadata, 'topic');
    if (topic) topics.add(topic);
  }
  if (topics.size === 0) return;

  // Find other repos that consume the same topics
  const otherEdges = db.prepare(`
    SELECT source_id, metadata FROM edges
    WHERE source_type = 'repo' AND source_id != ?
      AND relationship_type = 'consumes_kafka'
  `).all(repoId) as Array<{ source_id: number; metadata: string | null }>;

  const repoStmt = db.prepare('SELECT name FROM repos WHERE id = ?');
  for (const edge of otherEdges) {
    const topic = extractMetadataField(edge.metadata, 'topic');
    if (!topic || !topics.has(topic)) continue;
    const repo = repoStmt.get(edge.source_id) as { name: string } | undefined;
    if (repo) addToMap(talksTo, 'kafka', repo.name);
  }
}

function gatherKafkaMediatedInbound(
  db: Database.Database,
  repoId: number,
  calledBy: Map<string, Set<string>>,
): void {
  // Find kafka topics this repo consumes
  const myEdges = db.prepare(`
    SELECT metadata FROM edges
    WHERE source_type = 'repo' AND source_id = ?
      AND relationship_type = 'consumes_kafka'
  `).all(repoId) as Array<{ metadata: string | null }>;

  const topics = new Set<string>();
  for (const edge of myEdges) {
    const topic = extractMetadataField(edge.metadata, 'topic');
    if (topic) topics.add(topic);
  }
  if (topics.size === 0) return;

  // Find other repos that produce the same topics
  const otherEdges = db.prepare(`
    SELECT source_id, metadata FROM edges
    WHERE source_type = 'repo' AND source_id != ?
      AND relationship_type = 'produces_kafka'
  `).all(repoId) as Array<{ source_id: number; metadata: string | null }>;

  const repoStmt = db.prepare('SELECT name FROM repos WHERE id = ?');
  for (const edge of otherEdges) {
    const topic = extractMetadataField(edge.metadata, 'topic');
    if (!topic || !topics.has(topic)) continue;
    const repo = repoStmt.get(edge.source_id) as { name: string } | undefined;
    if (repo) addToMap(calledBy, 'kafka', repo.name);
  }
}

// ─── Conversion & truncation ─────────────────────────────────────────────

function mapToRecord(map: Map<string, Set<string>>): Record<string, string[]> {
  const record: Record<string, string[]> = {};
  for (const [mech, names] of map) {
    record[mech] = [...names].sort();
  }
  return record;
}

/**
 * Truncate connections to a cap per direction.
 * If total unique services exceeds cap, trim entries and add "...and N more".
 */
function truncateConnections(
  connections: Record<string, string[]>,
  cap: number,
): Record<string, string[]> {
  const totalServices = Object.values(connections).flat().length;
  if (totalServices <= cap) return connections;

  const excess = totalServices - cap;
  const result: Record<string, string[]> = {};

  // Collect all entries sorted by mechanism group size descending (trim largest first)
  const entries = Object.entries(connections).sort((a, b) => b[1].length - a[1].length);

  let remaining = excess;
  for (const [mech, names] of entries) {
    if (remaining <= 0) {
      result[mech] = [...names];
    } else {
      const trimCount = Math.min(remaining, names.length - 1); // keep at least 1
      if (trimCount > 0) {
        result[mech] = names.slice(0, names.length - trimCount);
        remaining -= trimCount;
      } else {
        result[mech] = [...names];
      }
    }
  }

  if (excess > 0) {
    // Add truncation marker to the first (largest) mechanism group
    const firstMech = entries[0]![0];
    result[firstMech] = [...(result[firstMech] ?? []), `...and ${excess} more`];
  }

  return result;
}

// ─── Summary builder ─────────────────────────────────────────────────────

/**
 * Build the count-based summary line.
 * Uses pre-truncation counts (full connection data).
 */
function buildConnectionSummary(
  talksTo: Record<string, string[]>,
  calledBy: Record<string, string[]>,
): string {
  const outTotal = Object.values(talksTo).reduce((sum, arr) => sum + arr.length, 0);
  const inTotal = Object.values(calledBy).reduce((sum, arr) => sum + arr.length, 0);

  let outPart: string;
  if (outTotal > 0) {
    const breakdown = Object.entries(talksTo)
      .map(([mech, names]) => `${names.length} via ${mech}`)
      .join(', ');
    outPart = `Talks to ${outTotal} services (${breakdown})`;
  } else {
    outPart = 'Talks to 0 services';
  }

  return `${outPart}. Called by ${inTotal} services.`;
}

// ─── Events ──────────────────────────────────────────────────────────────

function gatherEvents(
  db: Database.Database,
  repoId: number,
): { produces: string[]; consumes: string[] } {
  const produces = db.prepare(`
    SELECT ev.name
    FROM edges e
    JOIN events ev ON ev.id = e.target_id
    WHERE e.source_type = 'repo' AND e.source_id = ?
      AND e.relationship_type = 'produces_event'
  `).all(repoId) as Array<{ name: string }>;

  const consumes = db.prepare(`
    SELECT ev.name
    FROM edges e
    JOIN events ev ON ev.id = e.target_id
    WHERE e.source_type = 'repo' AND e.source_id = ?
      AND e.relationship_type = 'consumes_event'
  `).all(repoId) as Array<{ name: string }>;

  return {
    produces: produces.map(r => r.name).sort(),
    consumes: consumes.map(r => r.name).sort(),
  };
}

// ─── Modules ─────────────────────────────────────────────────────────────

function gatherModules(
  db: Database.Database,
  repoId: number,
): Record<string, { count: number; top: string[] }> {
  const counts = db.prepare(
    'SELECT type, COUNT(*) as count FROM modules WHERE repo_id = ? GROUP BY type ORDER BY count DESC',
  ).all(repoId) as Array<{ type: string | null; count: number }>;

  const topStmt = db.prepare(
    'SELECT name FROM modules WHERE repo_id = ? AND type = ? ORDER BY name LIMIT 5',
  );

  const result: Record<string, { count: number; top: string[] }> = {};
  for (const row of counts) {
    if (row.type === null) continue;
    const topNames = topStmt.all(repoId, row.type) as Array<{ name: string }>;
    result[row.type] = {
      count: row.count,
      top: topNames.map(r => r.name),
    };
  }

  return result;
}

// ─── Counts ──────────────────────────────────────────────────────────────

function gatherCounts(
  db: Database.Database,
  repoId: number,
): { files: number; grpc_services: number } {
  const fileCount = db.prepare(
    'SELECT COUNT(*) as count FROM files WHERE repo_id = ?',
  ).get(repoId) as { count: number };

  const grpcServiceCount = db.prepare(
    'SELECT COUNT(*) as count FROM services WHERE repo_id = ?',
  ).get(repoId) as { count: number };

  return {
    files: fileCount.count,
    grpc_services: grpcServiceCount.count,
  };
}
