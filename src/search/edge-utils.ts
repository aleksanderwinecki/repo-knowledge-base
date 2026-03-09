/** Map relationship types to human-readable mechanism labels */
export const MECHANISM_LABELS: Record<string, string> = {
  produces_event: 'Kafka producer',
  consumes_event: 'Kafka consumer',
  calls_grpc: 'gRPC',
  calls_http: 'HTTP',
  routes_to: 'Gateway',
  produces_kafka: 'Kafka producer',
  consumes_kafka: 'Kafka consumer',
  exposes_graphql: 'GraphQL',
};

/** Map user-facing mechanism names to relationship_type arrays */
export const MECHANISM_FILTER_MAP: Record<string, string[]> = {
  grpc: ['calls_grpc'],
  http: ['calls_http'],
  gateway: ['routes_to'],
  kafka: ['produces_kafka', 'consumes_kafka'],
  event: ['produces_event', 'consumes_event'],
};

/** Valid mechanism filter values for CLI/MCP validation */
export const VALID_MECHANISMS = Object.keys(MECHANISM_FILTER_MAP);

/** Relationship types that represent direct repo-to-repo edges */
export const DIRECT_EDGE_TYPES = ['calls_grpc', 'calls_http', 'routes_to'];

/** Relationship types for event-mediated edges */
export const EVENT_EDGE_TYPES = ['produces_event', 'consumes_event'];

/** Relationship types for kafka topic-mediated edges */
export const KAFKA_EDGE_TYPES = ['produces_kafka', 'consumes_kafka'];

/**
 * Extract confidence from edge metadata JSON.
 * Returns null for legacy edges without metadata.
 */
export function extractConfidence(metadata: string | null): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed.confidence ?? null;
  } catch {
    return null;
  }
}

/**
 * Extract a field from edge metadata JSON.
 */
export function extractMetadataField(metadata: string | null, field: string): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata);
    return parsed[field] ?? null;
  } catch {
    return null;
  }
}

/**
 * Format mechanism display string.
 * - Direct with confidence: "gRPC [high]"
 * - Event-mediated: "event (OrderCreated)"
 * - Kafka: "Kafka consumer [high]"
 * - Unresolved: "gRPC -> [unresolved: TargetName]"
 */
export function formatMechanism(
  relType: string,
  confidence: string | null,
  eventName?: string,
  unresolvedTarget?: string,
): string {
  const label = MECHANISM_LABELS[relType] ?? relType;

  if (unresolvedTarget) {
    return `${label} -> [unresolved: ${unresolvedTarget}]`;
  }

  if (eventName) {
    return `event (${eventName})`;
  }

  if (confidence) {
    return `${label} [${confidence}]`;
  }

  return label;
}

/**
 * Build a SQL IN clause with placeholders for the given types.
 * Returns { clause, params } for use in prepared statements.
 */
export function buildInClause(types: string[]): string {
  return types.map(() => '?').join(', ');
}

/**
 * Get the allowed relationship types based on mechanism filter and edge category.
 * Returns the intersection of the filter types and the category types,
 * or all category types if no filter is set.
 */
export function getAllowedTypes(
  mechanism: string | undefined,
  categoryTypes: string[],
): string[] {
  if (!mechanism) return categoryTypes;
  const filterTypes = MECHANISM_FILTER_MAP[mechanism];
  if (!filterTypes) return [];
  return categoryTypes.filter((t) => filterTypes.includes(t));
}
