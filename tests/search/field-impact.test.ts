import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { persistRepoData } from '../../src/indexer/writer.js';
import { analyzeFieldImpact, formatFieldImpactCompact } from '../../src/search/field-impact.js';
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

  it('returns consumer with nullability when downstream repo has same field', () => {
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
    expect(result.consumers[0].repoName).toBe('repo-b');
    expect(result.consumers[0].nullable).toBe(true);
    expect(result.consumers[0].fieldType).toBe('bigint');
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
