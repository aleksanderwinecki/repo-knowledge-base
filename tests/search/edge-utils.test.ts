import { describe, it, expect } from 'vitest';
import {
  MECHANISM_LABELS,
  MECHANISM_FILTER_MAP,
  VALID_MECHANISMS,
  DIRECT_EDGE_TYPES,
  EVENT_EDGE_TYPES,
  KAFKA_EDGE_TYPES,
  extractConfidence,
  extractMetadataField,
  formatMechanism,
  buildInClause,
  getAllowedTypes,
} from '../../src/search/edge-utils.js';

describe('edge-utils constants', () => {
  it('MECHANISM_LABELS maps calls_grpc to gRPC', () => {
    expect(MECHANISM_LABELS['calls_grpc']).toBe('gRPC');
  });

  it('MECHANISM_LABELS maps all expected relationship types', () => {
    expect(MECHANISM_LABELS['produces_event']).toBe('Kafka producer');
    expect(MECHANISM_LABELS['consumes_event']).toBe('Kafka consumer');
    expect(MECHANISM_LABELS['calls_http']).toBe('HTTP');
    expect(MECHANISM_LABELS['routes_to']).toBe('Gateway');
    expect(MECHANISM_LABELS['produces_kafka']).toBe('Kafka producer');
    expect(MECHANISM_LABELS['consumes_kafka']).toBe('Kafka consumer');
    expect(MECHANISM_LABELS['exposes_graphql']).toBe('GraphQL');
  });

  it('VALID_MECHANISMS contains grpc, http, gateway, kafka, event', () => {
    expect(VALID_MECHANISMS).toContain('grpc');
    expect(VALID_MECHANISMS).toContain('http');
    expect(VALID_MECHANISMS).toContain('gateway');
    expect(VALID_MECHANISMS).toContain('kafka');
    expect(VALID_MECHANISMS).toContain('event');
  });

  it('DIRECT_EDGE_TYPES contains calls_grpc, calls_http, routes_to', () => {
    expect(DIRECT_EDGE_TYPES).toContain('calls_grpc');
    expect(DIRECT_EDGE_TYPES).toContain('calls_http');
    expect(DIRECT_EDGE_TYPES).toContain('routes_to');
  });

  it('EVENT_EDGE_TYPES contains produces_event, consumes_event', () => {
    expect(EVENT_EDGE_TYPES).toContain('produces_event');
    expect(EVENT_EDGE_TYPES).toContain('consumes_event');
  });

  it('KAFKA_EDGE_TYPES contains produces_kafka, consumes_kafka', () => {
    expect(KAFKA_EDGE_TYPES).toContain('produces_kafka');
    expect(KAFKA_EDGE_TYPES).toContain('consumes_kafka');
  });

  it('MECHANISM_FILTER_MAP maps mechanism names to relationship types', () => {
    expect(MECHANISM_FILTER_MAP['grpc']).toEqual(['calls_grpc']);
    expect(MECHANISM_FILTER_MAP['http']).toEqual(['calls_http']);
    expect(MECHANISM_FILTER_MAP['gateway']).toEqual(['routes_to']);
    expect(MECHANISM_FILTER_MAP['kafka']).toEqual(['produces_kafka', 'consumes_kafka']);
    expect(MECHANISM_FILTER_MAP['event']).toEqual(['produces_event', 'consumes_event']);
  });
});

describe('extractConfidence', () => {
  it('returns confidence from valid JSON metadata', () => {
    expect(extractConfidence('{"confidence":"high"}')).toBe('high');
  });

  it('returns null for null metadata', () => {
    expect(extractConfidence(null)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(extractConfidence('invalid json')).toBeNull();
  });

  it('returns null when confidence field is missing', () => {
    expect(extractConfidence('{}')).toBeNull();
  });
});

describe('extractMetadataField', () => {
  it('extracts named field from JSON metadata', () => {
    expect(extractMetadataField('{"topic":"payments"}', 'topic')).toBe('payments');
  });

  it('returns null for null metadata', () => {
    expect(extractMetadataField(null, 'topic')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(extractMetadataField('not json', 'topic')).toBeNull();
  });

  it('returns null when field is missing', () => {
    expect(extractMetadataField('{"other":"value"}', 'topic')).toBeNull();
  });
});

describe('formatMechanism', () => {
  it('returns label with confidence', () => {
    expect(formatMechanism('calls_grpc', 'high')).toBe('gRPC [high]');
  });

  it('returns label without confidence', () => {
    expect(formatMechanism('calls_grpc', null)).toBe('gRPC');
  });

  it('returns event format with event name', () => {
    expect(formatMechanism('produces_event', null, 'OrderCreated')).toBe('event (OrderCreated)');
  });

  it('returns unresolved format with target', () => {
    expect(formatMechanism('calls_grpc', 'high', undefined, 'UnknownService')).toBe('gRPC -> [unresolved: UnknownService]');
  });

  it('falls back to relType when label not found', () => {
    expect(formatMechanism('unknown_type', null)).toBe('unknown_type');
  });
});

describe('buildInClause', () => {
  it('builds placeholder string for array', () => {
    expect(buildInClause(['a', 'b', 'c'])).toBe('?, ?, ?');
  });

  it('handles single element', () => {
    expect(buildInClause(['a'])).toBe('?');
  });

  it('handles empty array', () => {
    expect(buildInClause([])).toBe('');
  });
});

describe('getAllowedTypes', () => {
  it('returns all category types when mechanism is undefined', () => {
    expect(getAllowedTypes(undefined, ['calls_grpc'])).toEqual(['calls_grpc']);
  });

  it('returns intersection with filter types', () => {
    expect(getAllowedTypes('grpc', ['calls_grpc', 'calls_http'])).toEqual(['calls_grpc']);
  });

  it('returns empty array when no intersection', () => {
    expect(getAllowedTypes('http', ['calls_grpc'])).toEqual([]);
  });

  it('returns empty array for unknown mechanism', () => {
    expect(getAllowedTypes('bogus', ['calls_grpc'])).toEqual([]);
  });
});
