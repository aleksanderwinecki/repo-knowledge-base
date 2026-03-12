import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { persistRepoData } from '../../src/indexer/writer.js';
import { analyzeFieldImpact, formatFieldImpactCompact } from '../../src/search/field-impact.js';
import type { FieldConsumer } from '../../src/search/field-impact.js';
import type { RepoMetadata } from '../../src/indexer/metadata.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let dbPath: string;

function makeMetadata(overrides: Partial<RepoMetadata> = {}): RepoMetadata {
  return {
    name: 'test-repo',
    path: '/tmp/test-repo',
    description: 'A test repository',
    techStack: ['elixir', 'phoenix'],
    keyFiles: ['README.md', 'mix.exs'],
    currentCommit: 'abc123def456abc123def456abc123def456abc1',
    defaultBranch: null,
    ...overrides,
  };
}

beforeEach(() => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-field-impact-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  const dir = path.dirname(dbPath);
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('analyzeFieldImpact', () => {
  it('returns repo as origin AND boundary when ecto + proto field share name in same repo', () => {
    persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-a' }),
      modules: [
        { name: 'MyApp.Employee', type: 'ecto_schema', filePath: 'lib/employee.ex', summary: null },
      ],
      events: [
        { name: 'EmployeeCreated', schemaDefinition: 'message EmployeeCreated {}', sourceFile: 'proto/employee.proto' },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'MyApp.Employee', fieldName: 'employee_id', fieldType: 'integer', nullable: false, sourceFile: 'lib/employee.ex' },
        { parentType: 'proto_message', parentName: 'EmployeeCreated', fieldName: 'employee_id', fieldType: 'int32', nullable: false, sourceFile: 'proto/employee.proto' },
      ],
    });

    const result = analyzeFieldImpact(db, 'employee_id');

    expect(result.fieldName).toBe('employee_id');
    expect(result.origins).toHaveLength(1);
    expect(result.origins[0].repoName).toBe('repo-a');
    expect(result.origins[0].parentType).toBe('ecto_schema');
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0].repoName).toBe('repo-a');
    expect(result.boundaries[0].parentName).toBe('EmployeeCreated');
  });

  it('returns confirmed consumer with via chain when downstream repo has same field + topic subscription', () => {
    // repo-a produces Kafka, repo-b consumes it and has ecto field employee_id
    const { repoId: repoAId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-a', path: '/tmp/repo-a' }),
      modules: [
        { name: 'MyApp.Employee', type: 'ecto_schema', filePath: 'lib/employee.ex', summary: null },
      ],
      events: [
        { name: 'EmployeeCreated', schemaDefinition: 'message EmployeeCreated {}', sourceFile: 'proto/employee.proto' },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'MyApp.Employee', fieldName: 'employee_id', fieldType: 'integer', nullable: false, sourceFile: 'lib/employee.ex' },
        { parentType: 'proto_message', parentName: 'EmployeeCreated', fieldName: 'employee_id', fieldType: 'int32', nullable: false, sourceFile: 'proto/employee.proto' },
      ],
    });

    const { repoId: repoBId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-b', path: '/tmp/repo-b' }),
      modules: [
        { name: 'Consumer.Employee', type: 'ecto_schema', filePath: 'lib/consumer_employee.ex', summary: null },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'Consumer.Employee', fieldName: 'employee_id', fieldType: 'bigint', nullable: true, sourceFile: 'lib/consumer_employee.ex' },
      ],
    });

    // Create kafka producer/consumer pair (graph resolves via topic matching)
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'produces_kafka', ?)",
    ).run(repoAId, JSON.stringify({ topic: 'employee-events', role: 'producer' }));
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'consumes_kafka', ?)",
    ).run(repoBId, JSON.stringify({ topic: 'employee-events', role: 'consumer' }));

    const result = analyzeFieldImpact(db, 'employee_id');

    expect(result.origins).toHaveLength(1);
    expect(result.origins[0].repoName).toBe('repo-a');
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0].topics).toContain('employee-events');
    expect(result.consumers).toHaveLength(1);

    const consumer = result.consumers[0] as FieldConsumer;
    expect(consumer.repoName).toBe('repo-b');
    expect(consumer.confidence).toBe('confirmed');
    expect(consumer.via).toBeDefined();
    expect(consumer.via!.topic).toBe('employee-events');
    expect(consumer.via!.event).toBe('EmployeeCreated');
    expect(consumer.nullable).toBe(true);
    expect(consumer.fieldType).toBe('bigint');
    expect(consumer.parentType).toBe('ecto_schema');
    expect(consumer.parentName).toBe('Consumer.Employee');
  });

  it('returns origins only when no proto boundary exists', () => {
    persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-a' }),
      modules: [
        { name: 'MyApp.User', type: 'ecto_schema', filePath: 'lib/user.ex', summary: null },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'MyApp.User', fieldName: 'internal_flag', fieldType: 'boolean', nullable: false, sourceFile: 'lib/user.ex' },
      ],
    });

    const result = analyzeFieldImpact(db, 'internal_flag');

    expect(result.origins).toHaveLength(1);
    expect(result.boundaries).toHaveLength(0);
    expect(result.consumers).toHaveLength(0);
  });

  it('returns empty result for nonexistent field', () => {
    const result = analyzeFieldImpact(db, 'nonexistent_field');

    expect(result.origins).toHaveLength(0);
    expect(result.boundaries).toHaveLength(0);
    expect(result.consumers).toHaveLength(0);
    expect(result.fieldName).toBe('nonexistent_field');
  });

  it('includes nullability at each hop', () => {
    persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-a' }),
      modules: [
        { name: 'Schema', type: 'ecto_schema', filePath: 'lib/s.ex', summary: null },
      ],
      events: [
        { name: 'Proto', schemaDefinition: 'message Proto {}', sourceFile: 'proto/p.proto' },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'Schema', fieldName: 'status', fieldType: 'string', nullable: false, sourceFile: 'lib/s.ex' },
        { parentType: 'proto_message', parentName: 'Proto', fieldName: 'status', fieldType: 'string', nullable: true, sourceFile: 'proto/p.proto' },
      ],
    });

    const result = analyzeFieldImpact(db, 'status');

    expect(result.origins[0].nullable).toBe(false);
    expect(result.boundaries[0].nullable).toBe(true);
  });

  it('returns topic-inferred consumer when subscriber has no ecto field match', () => {
    // repo-a has ecto + proto field, produces to topic
    // repo-c subscribes to topic but has NO ecto field matching the traced field
    const { repoId: repoAId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-a', path: '/tmp/repo-a' }),
      modules: [
        { name: 'MyApp.Booking', type: 'ecto_schema', filePath: 'lib/booking.ex', summary: null },
      ],
      events: [
        { name: 'BookingCreated', schemaDefinition: 'message BookingCreated {}', sourceFile: 'proto/booking.proto' },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'MyApp.Booking', fieldName: 'capacity', fieldType: 'integer', nullable: false, sourceFile: 'lib/booking.ex' },
        { parentType: 'proto_message', parentName: 'BookingCreated', fieldName: 'capacity', fieldType: 'int32', nullable: false, sourceFile: 'proto/booking.proto' },
      ],
    });

    const { repoId: repoCId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-c', path: '/tmp/repo-c' }),
      modules: [
        { name: 'Notifier.Handler', type: 'module', filePath: 'lib/handler.ex', summary: null },
      ],
      // No ecto field 'capacity' in repo-c
    });

    // repo-a produces to booking-events topic, repo-c consumes it
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'produces_kafka', ?)",
    ).run(repoAId, JSON.stringify({ topic: 'booking-events', role: 'producer' }));
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'consumes_kafka', ?)",
    ).run(repoCId, JSON.stringify({ topic: 'booking-events', role: 'consumer' }));

    const result = analyzeFieldImpact(db, 'capacity');

    expect(result.consumers).toHaveLength(1);
    const consumer = result.consumers[0] as FieldConsumer;
    expect(consumer.repoName).toBe('repo-c');
    expect(consumer.confidence).toBe('inferred');
    expect(consumer.via).toBeDefined();
    expect(consumer.via!.topic).toBe('booking-events');
    expect(consumer.via!.event).toBe('BookingCreated');
    // Inferred consumers should NOT have ecto field details
    expect(consumer.parentType).toBeUndefined();
    expect(consumer.parentName).toBeUndefined();
    expect(consumer.fieldType).toBeUndefined();
    expect(consumer.nullable).toBeUndefined();
  });

  it('excludes boundary repo from consumers (self-loop exclusion)', () => {
    // repo-a has proto field and both produces + consumes the same topic
    const { repoId: repoAId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-a', path: '/tmp/repo-a' }),
      modules: [
        { name: 'MyApp.Resource', type: 'ecto_schema', filePath: 'lib/resource.ex', summary: null },
      ],
      events: [
        { name: 'ResourceUpdated', schemaDefinition: 'message ResourceUpdated {}', sourceFile: 'proto/resource.proto' },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'MyApp.Resource', fieldName: 'resource_id', fieldType: 'integer', nullable: false, sourceFile: 'lib/resource.ex' },
        { parentType: 'proto_message', parentName: 'ResourceUpdated', fieldName: 'resource_id', fieldType: 'int32', nullable: false, sourceFile: 'proto/resource.proto' },
      ],
    });

    // repo-a produces AND consumes the same topic (idempotent replay pattern)
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'produces_kafka', ?)",
    ).run(repoAId, JSON.stringify({ topic: 'resource-events', role: 'producer' }));
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'consumes_kafka', ?)",
    ).run(repoAId, JSON.stringify({ topic: 'resource-events', role: 'consumer' }));

    const result = analyzeFieldImpact(db, 'resource_id');

    // repo-a should NOT appear as its own consumer
    expect(result.consumers).toHaveLength(0);
    expect(result.boundaries).toHaveLength(1);
    expect(result.origins).toHaveLength(1);
  });

  it('returns no consumers when no topic subscribers exist besides boundary', () => {
    // repo-a produces to a topic but nobody else subscribes
    const { repoId: repoAId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-a', path: '/tmp/repo-a' }),
      modules: [
        { name: 'MyApp.Item', type: 'ecto_schema', filePath: 'lib/item.ex', summary: null },
      ],
      events: [
        { name: 'ItemCreated', schemaDefinition: 'message ItemCreated {}', sourceFile: 'proto/item.proto' },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'MyApp.Item', fieldName: 'item_code', fieldType: 'string', nullable: false, sourceFile: 'lib/item.ex' },
        { parentType: 'proto_message', parentName: 'ItemCreated', fieldName: 'item_code', fieldType: 'string', nullable: false, sourceFile: 'proto/item.proto' },
      ],
    });

    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'produces_kafka', ?)",
    ).run(repoAId, JSON.stringify({ topic: 'item-events', role: 'producer' }));

    const result = analyzeFieldImpact(db, 'item_code');

    expect(result.consumers).toHaveLength(0);
    expect(result.boundaries).toHaveLength(1);
    expect(result.boundaries[0].topics).toContain('item-events');
  });

  it('includes inferred consumers in summary count', () => {
    const { repoId: repoAId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-a', path: '/tmp/repo-a' }),
      modules: [
        { name: 'MyApp.Sale', type: 'ecto_schema', filePath: 'lib/sale.ex', summary: null },
      ],
      events: [
        { name: 'SaleCompleted', schemaDefinition: 'message SaleCompleted {}', sourceFile: 'proto/sale.proto' },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'MyApp.Sale', fieldName: 'sale_amount', fieldType: 'decimal', nullable: false, sourceFile: 'lib/sale.ex' },
        { parentType: 'proto_message', parentName: 'SaleCompleted', fieldName: 'sale_amount', fieldType: 'double', nullable: false, sourceFile: 'proto/sale.proto' },
      ],
    });

    const { repoId: repoBId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-b', path: '/tmp/repo-b' }),
    });
    const { repoId: repoCId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-c', path: '/tmp/repo-c' }),
    });

    // repo-a produces, repo-b and repo-c consume (no ecto match -> both inferred)
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'produces_kafka', ?)",
    ).run(repoAId, JSON.stringify({ topic: 'sale-events', role: 'producer' }));
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'consumes_kafka', ?)",
    ).run(repoBId, JSON.stringify({ topic: 'sale-events', role: 'consumer' }));
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'consumes_kafka', ?)",
    ).run(repoCId, JSON.stringify({ topic: 'sale-events', role: 'consumer' }));

    const result = analyzeFieldImpact(db, 'sale_amount');

    expect(result.consumers).toHaveLength(2);
    // Summary should say "2 consumers"
    expect(result.summary).toContain('2 consumers');
  });

  it('handles multiple boundaries and topics with correct via chains', () => {
    // repo-a has two proto messages with the same field, produces to two different topics
    const { repoId: repoAId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-a', path: '/tmp/repo-a' }),
      modules: [
        { name: 'MyApp.Order', type: 'ecto_schema', filePath: 'lib/order.ex', summary: null },
      ],
      events: [
        { name: 'OrderCreated', schemaDefinition: 'message OrderCreated {}', sourceFile: 'proto/order.proto' },
        { name: 'OrderUpdated', schemaDefinition: 'message OrderUpdated {}', sourceFile: 'proto/order.proto' },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'MyApp.Order', fieldName: 'total', fieldType: 'decimal', nullable: false, sourceFile: 'lib/order.ex' },
        { parentType: 'proto_message', parentName: 'OrderCreated', fieldName: 'total', fieldType: 'double', nullable: false, sourceFile: 'proto/order.proto' },
        { parentType: 'proto_message', parentName: 'OrderUpdated', fieldName: 'total', fieldType: 'double', nullable: true, sourceFile: 'proto/order.proto' },
      ],
    });

    const { repoId: repoBId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-b', path: '/tmp/repo-b' }),
    });

    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'produces_kafka', ?)",
    ).run(repoAId, JSON.stringify({ topic: 'order-created', role: 'producer' }));
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'produces_kafka', ?)",
    ).run(repoAId, JSON.stringify({ topic: 'order-updated', role: 'producer' }));
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'consumes_kafka', ?)",
    ).run(repoBId, JSON.stringify({ topic: 'order-created', role: 'consumer' }));

    const result = analyzeFieldImpact(db, 'total');

    expect(result.consumers).toHaveLength(1);
    const consumer = result.consumers[0] as FieldConsumer;
    expect(consumer.repoName).toBe('repo-b');
    expect(consumer.confidence).toBe('inferred');
    expect(consumer.via).toBeDefined();
    // Via should reference one of the topics and one of the proto messages
    expect(consumer.via!.topic).toBeTruthy();
    expect(consumer.via!.event).toBeTruthy();
  });

  it('includes Kafka topics from graph edges on boundary entries', () => {
    const { repoId: repoAId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-a', path: '/tmp/repo-a' }),
      modules: [
        { name: 'MyApp.Order', type: 'ecto_schema', filePath: 'lib/order.ex', summary: null },
      ],
      events: [
        { name: 'OrderCreated', schemaDefinition: 'message OrderCreated {}', sourceFile: 'proto/order.proto' },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'MyApp.Order', fieldName: 'order_id', fieldType: 'integer', nullable: false, sourceFile: 'lib/order.ex' },
        { parentType: 'proto_message', parentName: 'OrderCreated', fieldName: 'order_id', fieldType: 'int32', nullable: false, sourceFile: 'proto/order.proto' },
      ],
    });

    const { repoId: repoBId } = persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-b', path: '/tmp/repo-b' }),
    });

    // Kafka producer + consumer pairs (graph resolves these via topic matching)
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'produces_kafka', ?)",
    ).run(repoAId, JSON.stringify({ topic: 'order-events', role: 'producer' }));
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'consumes_kafka', ?)",
    ).run(repoBId, JSON.stringify({ topic: 'order-events', role: 'consumer' }));

    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'produces_kafka', ?)",
    ).run(repoAId, JSON.stringify({ topic: 'order-updates', role: 'producer' }));
    db.prepare(
      "INSERT INTO edges (source_type, source_id, target_type, target_id, relationship_type, metadata) VALUES ('repo', ?, 'service_name', 0, 'consumes_kafka', ?)",
    ).run(repoBId, JSON.stringify({ topic: 'order-updates', role: 'consumer' }));

    const result = analyzeFieldImpact(db, 'order_id');

    expect(result.boundaries[0].topics).toContain('order-events');
    expect(result.boundaries[0].topics).toContain('order-updates');
  });
});

describe('attribute-resolved Ecto nullability in field impact', () => {
  it('reflects attribute-resolved required fields as nullable: false', () => {
    // Simulate what the pipeline produces after Task 1's enriched requiredFields:
    // @required_fields ~w(name email)a -> requiredFields: ['name', 'email']
    // So name/email should be nullable: false, bio should be nullable: true (cast-only)
    persistRepoData(db, {
      metadata: makeMetadata({ name: 'ecto-repo' }),
      modules: [
        { name: 'MyApp.User', type: 'ecto_schema', filePath: 'lib/user.ex', summary: null },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'MyApp.User', fieldName: 'name', fieldType: 'string', nullable: false, sourceFile: 'lib/user.ex' },
        { parentType: 'ecto_schema', parentName: 'MyApp.User', fieldName: 'email', fieldType: 'string', nullable: false, sourceFile: 'lib/user.ex' },
        { parentType: 'ecto_schema', parentName: 'MyApp.User', fieldName: 'bio', fieldType: 'string', nullable: true, sourceFile: 'lib/user.ex' },
      ],
    });

    // Required field should be not nullable
    const nameResult = analyzeFieldImpact(db, 'name');
    expect(nameResult.origins).toHaveLength(1);
    expect(nameResult.origins[0].nullable).toBe(false);

    // Optional field (cast-only) should be nullable
    const bioResult = analyzeFieldImpact(db, 'bio');
    expect(bioResult.origins).toHaveLength(1);
    expect(bioResult.origins[0].nullable).toBe(true);
  });

  it('required field via attribute resolution + optional field both correct in same query', () => {
    persistRepoData(db, {
      metadata: makeMetadata({ name: 'attr-repo' }),
      modules: [
        { name: 'MyApp.Profile', type: 'ecto_schema', filePath: 'lib/profile.ex', summary: null },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'MyApp.Profile', fieldName: 'user_id', fieldType: 'integer', nullable: false, sourceFile: 'lib/profile.ex' },
        { parentType: 'ecto_schema', parentName: 'MyApp.Profile', fieldName: 'avatar', fieldType: 'string', nullable: true, sourceFile: 'lib/profile.ex' },
      ],
    });

    const requiredResult = analyzeFieldImpact(db, 'user_id');
    expect(requiredResult.origins[0].nullable).toBe(false);

    const optionalResult = analyzeFieldImpact(db, 'avatar');
    expect(optionalResult.origins[0].nullable).toBe(true);
  });
});

describe('formatFieldImpactCompact', () => {
  it('produces compact output with summary, origins, boundaries, consumers', () => {
    persistRepoData(db, {
      metadata: makeMetadata({ name: 'repo-a' }),
      modules: [
        { name: 'Schema', type: 'ecto_schema', filePath: 'lib/s.ex', summary: null },
      ],
      events: [
        { name: 'Proto', schemaDefinition: 'message Proto {}', sourceFile: 'proto/p.proto' },
      ],
      fields: [
        { parentType: 'ecto_schema', parentName: 'Schema', fieldName: 'id', fieldType: 'integer', nullable: false, sourceFile: 'lib/s.ex' },
        { parentType: 'proto_message', parentName: 'Proto', fieldName: 'id', fieldType: 'int32', nullable: false, sourceFile: 'proto/p.proto' },
      ],
    });

    const result = analyzeFieldImpact(db, 'id');
    const compact = formatFieldImpactCompact(result);

    expect(compact.summary).toContain('id');
    expect(compact.field).toBe('id');
    expect(compact.origins).toHaveLength(1);
    expect(compact.origins[0].repo).toBe('repo-a');
    expect(compact.origins[0].schema).toBe('Schema');
    expect(compact.origins[0].type).toBe('integer');
    expect(compact.origins[0].nullable).toBe(false);
    expect(compact.boundaries).toHaveLength(1);
    expect(compact.boundaries[0].proto).toBe('Proto');
    expect(compact.consumers).toHaveLength(0);
  });

  it('respects 4000 char budget', () => {
    // Create many origins to test budget
    const fields = [];
    const modules = [];
    for (let i = 0; i < 100; i++) {
      modules.push({ name: `Schema${i}`, type: 'ecto_schema', filePath: `lib/s${i}.ex`, summary: null });
      fields.push({
        parentType: 'ecto_schema' as const,
        parentName: `Schema${i}`,
        fieldName: 'common_field',
        fieldType: 'string',
        nullable: true,
        sourceFile: `lib/s${i}.ex`,
      });
    }

    persistRepoData(db, {
      metadata: makeMetadata({ name: 'big-repo' }),
      modules,
      fields,
    });

    const result = analyzeFieldImpact(db, 'common_field');
    const compact = formatFieldImpactCompact(result);
    const serialized = JSON.stringify(compact);

    expect(serialized.length).toBeLessThanOrEqual(4000);
  });
});
