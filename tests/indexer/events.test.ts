import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { detectEventRelationships } from '../../src/indexer/events.js';
import type { ProtoDefinition } from '../../src/indexer/proto.js';
import type { ElixirModule } from '../../src/indexer/elixir.js';

let tmpDir: string;

function setupMockRepo(files: Record<string, string>): string {
  const repoDir = path.join(tmpDir, 'test-repo');
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return repoDir;
}

function makeProto(overrides: Partial<ProtoDefinition> = {}): ProtoDefinition {
  return {
    filePath: 'proto/events.proto',
    packageName: 'events',
    messages: [],
    services: [],
    ...overrides,
  };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-events-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('detectEventRelationships', () => {
  it('detects producers from proto message definitions', () => {
    const repoDir = setupMockRepo({
      'lib/handler.ex': 'defmodule MyApp.Handler do\nend',
    });
    const protos: ProtoDefinition[] = [
      makeProto({
        messages: [
          { name: 'BookingCreated', fields: [{ type: 'string', name: 'id' }] },
          { name: 'BookingCancelled', fields: [{ type: 'string', name: 'id' }] },
        ],
      }),
    ];

    const rels = detectEventRelationships(repoDir, protos, []);
    const producers = rels.filter((r) => r.type === 'produces_event');
    expect(producers).toHaveLength(2);
    expect(producers[0].eventName).toBe('BookingCreated');
    expect(producers[1].eventName).toBe('BookingCancelled');
  });

  it('detects consumers from handle_event patterns', () => {
    const repoDir = setupMockRepo({
      'lib/handler.ex': `
defmodule MyApp.BookingHandler do
  def handle_event(%BookingCreated{} = event) do
    :ok
  end

  def handle_event(%PaymentProcessed{} = event) do
    :ok
  end
end
`,
    });

    const rels = detectEventRelationships(repoDir, [], []);
    const consumers = rels.filter((r) => r.type === 'consumes_event');
    expect(consumers).toHaveLength(2);
    expect(consumers[0].eventName).toBe('BookingCreated');
    expect(consumers[1].eventName).toBe('PaymentProcessed');
    expect(consumers[0].handlerModule).toBe('MyApp.BookingHandler');
  });

  it('detects consumers from handle_message patterns', () => {
    const repoDir = setupMockRepo({
      'lib/consumer.ex': `
defmodule MyApp.Consumer do
  def handle_message(%BookingUpdated{} = msg) do
    :ok
  end
end
`,
    });

    const rels = detectEventRelationships(repoDir, [], []);
    const consumers = rels.filter((r) => r.type === 'consumes_event');
    expect(consumers).toHaveLength(1);
    expect(consumers[0].eventName).toBe('BookingUpdated');
  });

  it('detects both producers and consumers in same repo', () => {
    const repoDir = setupMockRepo({
      'lib/handler.ex': `
defmodule MyApp.Handler do
  def handle_event(%ExternalEvent{} = event) do
    :ok
  end
end
`,
    });

    const protos: ProtoDefinition[] = [
      makeProto({
        messages: [{ name: 'InternalEvent', fields: [{ type: 'string', name: 'id' }] }],
      }),
    ];

    const rels = detectEventRelationships(repoDir, protos, []);
    const producers = rels.filter((r) => r.type === 'produces_event');
    const consumers = rels.filter((r) => r.type === 'consumes_event');
    expect(producers).toHaveLength(1);
    expect(consumers).toHaveLength(1);
    expect(producers[0].eventName).toBe('InternalEvent');
    expect(consumers[0].eventName).toBe('ExternalEvent');
  });

  it('returns empty when no proto messages and no handlers', () => {
    const repoDir = setupMockRepo({
      'lib/plain.ex': `
defmodule MyApp.Plain do
  def hello, do: :world
end
`,
    });

    const rels = detectEventRelationships(repoDir, [], []);
    expect(rels).toHaveLength(0);
  });

  it('returns empty when repo has no lib/ directory', () => {
    const repoDir = setupMockRepo({
      'README.md': '# Hello',
    });

    const rels = detectEventRelationships(repoDir, [], []);
    expect(rels).toHaveLength(0);
  });

  it('scans umbrella apps for consumers', () => {
    const repoDir = setupMockRepo({
      'apps/booking/lib/handler.ex': `
defmodule Booking.Handler do
  def handle_event(%BookingCreated{} = e) do
    :ok
  end
end
`,
      'apps/payments/lib/handler.ex': `
defmodule Payments.Handler do
  def handle_event(%PaymentFailed{} = e) do
    :ok
  end
end
`,
    });

    const rels = detectEventRelationships(repoDir, [], []);
    const consumers = rels.filter((r) => r.type === 'consumes_event');
    expect(consumers).toHaveLength(2);
    const eventNames = consumers.map((c) => c.eventName).sort();
    expect(eventNames).toEqual(['BookingCreated', 'PaymentFailed']);
  });

  it('includes source file in relationship', () => {
    const repoDir = setupMockRepo({
      'lib/deep/nested/handler.ex': `
defmodule MyApp.Deep.Handler do
  def handle_event(%SomeEvent{} = e), do: :ok
end
`,
    });

    const rels = detectEventRelationships(repoDir, [], []);
    expect(rels[0].sourceFile).toContain('deep/nested/handler.ex');
  });

  it('handles namespaced event types', () => {
    const repoDir = setupMockRepo({
      'lib/handler.ex': `
defmodule MyApp.Handler do
  def handle_event(%Booking.Events.BookingCreated{} = e), do: :ok
end
`,
    });

    const rels = detectEventRelationships(repoDir, [], []);
    expect(rels).toHaveLength(1);
    expect(rels[0].eventName).toBe('Booking.Events.BookingCreated');
  });

  it('skips node_modules and _build directories', () => {
    const repoDir = setupMockRepo({
      'lib/real.ex': `
defmodule MyApp.Real do
  def handle_event(%RealEvent{} = e), do: :ok
end
`,
      'node_modules/pkg/lib/fake.ex': `
defmodule Fake do
  def handle_event(%FakeEvent{} = e), do: :ok
end
`,
      '_build/dev/lib/fake.ex': `
defmodule BuildFake do
  def handle_event(%BuildFakeEvent{} = e), do: :ok
end
`,
    });

    const rels = detectEventRelationships(repoDir, [], []);
    const consumers = rels.filter((r) => r.type === 'consumes_event');
    expect(consumers).toHaveLength(1);
    expect(consumers[0].eventName).toBe('RealEvent');
  });
});
