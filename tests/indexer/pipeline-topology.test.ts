import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { indexAllRepos } from '../../src/indexer/pipeline.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let dbPath: string;
let tmpDir: string;

/**
 * Create a git-initialized repo with the given files.
 * Returns the repo path.
 */
function createGitRepo(
  name: string,
  files: Record<string, string>,
): string {
  const repoDir = path.join(tmpDir, 'repos', name);
  fs.mkdirSync(repoDir, { recursive: true });

  execSync('git init', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: repoDir, stdio: 'pipe' });

  return repoDir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-topo-pipeline-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('topology pipeline integration', () => {
  it('produces calls_grpc edges from gRPC client repo', async () => {
    // Create a proto repo that defines the service
    createGitRepo('app-customers', {
      'mix.exs': 'defmodule Customers.MixProject do\nend',
      'proto/customers.proto': `
syntax = "proto3";
package customers;

service RPCService {
  rpc GetCustomer (GetCustomerRequest) returns (GetCustomerResponse);
}

message GetCustomerRequest { string id = 1; }
message GetCustomerResponse { string name = 1; }
`,
    });

    // Create the gRPC client repo
    createGitRepo('app-test-grpc', {
      'mix.exs': 'defmodule TestGrpc.MixProject do\nend',
      'lib/grpc_client.ex': `
defmodule TestGrpc.GrpcClient do
  use RpcClient.MockableRpcClient,
    behaviour: Rpc.Customers.V1.RPCService.ClientBehaviour
end
`,
    });

    const results = await indexAllRepos(db, { force: true, rootDir: path.join(tmpDir, 'repos') });
    const successRepos = results.filter(r => r.status === 'success');
    expect(successRepos.length).toBe(2);

    // Check for calls_grpc edges from the test-grpc repo
    const grpcRepo = db.prepare('SELECT id FROM repos WHERE name = ?').get('app-test-grpc') as { id: number };
    const grpcEdges = db.prepare(
      "SELECT * FROM edges WHERE source_type = 'repo' AND source_id = ? AND relationship_type = 'calls_grpc'"
    ).all(grpcRepo.id) as { metadata: string; source_file: string }[];

    expect(grpcEdges.length).toBeGreaterThanOrEqual(1);

    // Verify metadata is valid JSON with confidence
    for (const edge of grpcEdges) {
      expect(edge.metadata).toBeTruthy();
      const meta = JSON.parse(edge.metadata);
      expect(meta.confidence).toBeDefined();
    }
  });

  it('produces produces_kafka edges from Kafka producer repo', async () => {
    createGitRepo('app-test-kafka', {
      'mix.exs': 'defmodule TestKafka.MixProject do\nend',
      'lib/producer.ex': `
defmodule TestKafka.Producer do
  @topic_name "test.events-v1"
  @worker :test_producer

  def produce(messages) do
    Kafkaesque.Producer.produce_batch(@worker, @topic_name, messages)
  end
end
`,
    });

    const results = await indexAllRepos(db, { force: true, rootDir: path.join(tmpDir, 'repos') });
    expect(results.filter(r => r.status === 'success').length).toBe(1);

    const kafkaRepo = db.prepare('SELECT id FROM repos WHERE name = ?').get('app-test-kafka') as { id: number };
    const kafkaEdges = db.prepare(
      "SELECT * FROM edges WHERE source_type = 'repo' AND source_id = ? AND relationship_type = 'produces_kafka'"
    ).all(kafkaRepo.id) as { metadata: string; source_file: string }[];

    expect(kafkaEdges.length).toBeGreaterThanOrEqual(1);

    // Verify metadata contains topic
    const meta = JSON.parse(kafkaEdges[0]!.metadata);
    expect(meta.topic).toBe('test.events-v1');
    expect(meta.confidence).toBe('high');
  });

  it('produces routes_to edges from gateway repo', async () => {
    // Create the target repo with a name that sorts before the gateway repo
    // so it's persisted first in the serial Phase 3 (alphabetical discovery order).
    createGitRepo('app-a-backend', {
      'mix.exs': 'defmodule Backend.MixProject do\nend',
      'lib/placeholder.ex': 'defmodule Backend.Placeholder do\nend',
    });

    createGitRepo('app-b-gateway', {
      'package.json': '{"name": "app-b-gateway"}',
      'compose/services/customers.ts': `
import { describe } from '@fresha/gateway';
export default describe({
  name: "Customers",
  schemaSource: { repo: "app-a-backend" }
});
`,
    });

    const results = await indexAllRepos(db, { force: true, rootDir: path.join(tmpDir, 'repos') });
    expect(results.filter(r => r.status === 'success').length).toBe(2);

    const gwRepo = db.prepare('SELECT id FROM repos WHERE name = ?').get('app-b-gateway') as { id: number };
    const routeEdges = db.prepare(
      "SELECT * FROM edges WHERE source_type = 'repo' AND source_id = ? AND relationship_type = 'routes_to'"
    ).all(gwRepo.id) as { metadata: string; target_type: string; target_id: number }[];

    expect(routeEdges.length).toBeGreaterThanOrEqual(1);

    // Verify the edge points to the target repo
    const targetRepo = db.prepare('SELECT id FROM repos WHERE name = ?').get('app-a-backend') as { id: number };
    expect(routeEdges[0]!.target_type).toBe('repo');
    expect(routeEdges[0]!.target_id).toBe(targetRepo.id);

    // Verify metadata
    const meta = JSON.parse(routeEdges[0]!.metadata);
    expect(meta.serviceName).toBe('Customers');
    expect(meta.confidence).toBe('medium');
  });

  it('all topology edges have non-null valid JSON metadata', async () => {
    createGitRepo('app-meta-check', {
      'mix.exs': 'defmodule MetaCheck.MixProject do\nend',
      'lib/grpc_client.ex': `
defmodule MetaCheck.GrpcClient do
  use RpcClient.MockableRpcClient,
    behaviour: Rpc.SomeService.V1.RPCService.ClientBehaviour
end
`,
    });

    await indexAllRepos(db, { force: true, rootDir: path.join(tmpDir, 'repos') });

    // Check ALL topology edge types for valid metadata
    const topologyTypes = ['calls_grpc', 'calls_http', 'routes_to', 'produces_kafka', 'consumes_kafka'];
    const allTopologyEdges = db.prepare(
      `SELECT * FROM edges WHERE relationship_type IN (${topologyTypes.map(() => '?').join(', ')})`
    ).all(...topologyTypes) as { metadata: string | null; relationship_type: string }[];

    for (const edge of allTopologyEdges) {
      expect(edge.metadata).not.toBeNull();
      const meta = JSON.parse(edge.metadata!);
      expect(meta.confidence).toBeDefined();
    }
  });

  it('no duplicate gRPC edges (old insertGrpcClientEdges replaced)', async () => {
    // Create service-defining repo
    createGitRepo('app-booking', {
      'mix.exs': 'defmodule Booking.MixProject do\nend',
      'proto/booking.proto': `
syntax = "proto3";
package booking;

service BookingService {
  rpc CreateBooking (CreateBookingRequest) returns (CreateBookingResponse);
}

message CreateBookingRequest { string id = 1; }
message CreateBookingResponse { string id = 1; }
`,
    });

    // Create repo with gRPC stub that also triggers the old insertGrpcClientEdges path
    createGitRepo('app-grpc-dedup', {
      'mix.exs': 'defmodule GrpcDedup.MixProject do\nend',
      'lib/client.ex': `
defmodule GrpcDedup.Client do
  use RpcClient.MockableRpcClient,
    behaviour: Rpc.Booking.V1.BookingService.ClientBehaviour

  def call_stub do
    Rpc.Booking.V1.BookingService.Stub.create_booking(%{})
  end
end
`,
    });

    await indexAllRepos(db, { force: true, rootDir: path.join(tmpDir, 'repos') });

    const dedupRepo = db.prepare('SELECT id FROM repos WHERE name = ?').get('app-grpc-dedup') as { id: number };
    const grpcEdges = db.prepare(
      "SELECT * FROM edges WHERE source_type = 'repo' AND source_id = ? AND relationship_type = 'calls_grpc'"
    ).all(dedupRepo.id) as { id: number }[];

    // Should be exactly 1 edge, not 2 (topology framework deduplicates)
    expect(grpcEdges.length).toBe(1);
  });

  it('surgical re-index still produces topology edges', async () => {
    createGitRepo('app-surgical-topo', {
      'mix.exs': 'defmodule SurgicalTopo.MixProject do\nend',
      'lib/producer.ex': `
defmodule SurgicalTopo.Producer do
  @topic_name "surgical.events-v1"
  @worker :surgical_producer

  def produce(messages) do
    Kafkaesque.Producer.produce_batch(@worker, @topic_name, messages)
  end
end
`,
    });

    // First full index
    await indexAllRepos(db, { force: true, rootDir: path.join(tmpDir, 'repos') });

    const repo = db.prepare('SELECT id FROM repos WHERE name = ?').get('app-surgical-topo') as { id: number };
    const initialEdges = db.prepare(
      "SELECT * FROM edges WHERE source_type = 'repo' AND source_id = ? AND relationship_type = 'produces_kafka'"
    ).all(repo.id);
    expect(initialEdges.length).toBeGreaterThanOrEqual(1);

    // Modify a file to trigger surgical re-index
    const repoDir = path.join(tmpDir, 'repos', 'app-surgical-topo');
    fs.writeFileSync(path.join(repoDir, 'lib/other.ex'), `
defmodule SurgicalTopo.Other do
  def hello, do: :world
end
`);
    execSync('git add -A && git commit -m "add other module"', { cwd: repoDir, stdio: 'pipe' });

    // Re-index without force (should use surgical mode)
    await indexAllRepos(db, { force: false, rootDir: path.join(tmpDir, 'repos') });

    // Topology edges should still be present after surgical re-index
    const afterEdges = db.prepare(
      "SELECT * FROM edges WHERE source_type = 'repo' AND source_id = ? AND relationship_type = 'produces_kafka'"
    ).all(repo.id);
    expect(afterEdges.length).toBeGreaterThanOrEqual(1);
  });
});
