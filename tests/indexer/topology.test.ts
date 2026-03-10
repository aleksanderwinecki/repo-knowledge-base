import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ElixirModule } from '../../src/indexer/elixir.js';

// Mock git module before importing extractors
vi.mock('../../src/indexer/git.js', () => ({
  listBranchFiles: vi.fn(() => []),
  readBranchFile: vi.fn(() => null),
}));

import { listBranchFiles, readBranchFile } from '../../src/indexer/git.js';
import { extractGrpcClientEdges } from '../../src/indexer/topology/grpc-clients.js';
import { extractHttpClientEdges } from '../../src/indexer/topology/http-clients.js';
import { extractKafkaEdges } from '../../src/indexer/topology/kafka.js';

const mockListBranchFiles = vi.mocked(listBranchFiles);
const mockReadBranchFile = vi.mocked(readBranchFile);

function makeModule(overrides: Partial<ElixirModule> = {}): ElixirModule {
  return {
    name: 'TestModule',
    type: 'module',
    filePath: 'lib/test.ex',
    moduledoc: null,
    functions: [],
    tableName: null,
    schemaFields: [],
    associations: [],
    absintheTypes: [],
    grpcStubs: [],
    requiredFields: [],
    ...overrides,
  };
}

describe('grpc-clients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects MockableRpcClient behaviour pattern', () => {
    const content = `
defmodule Checkout.GrpcClients.Appointments do
  use RpcClient.MockableRpcClient,
    behaviour: Rpc.Appointments.V1.RPCService.ClientBehaviour

  def get_appointment(request) do
    call(:get_appointment, request)
  end
end`;

    mockListBranchFiles.mockReturnValue(['lib/checkout/grpc_clients/appointments.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractGrpcClientEdges('/repo', 'main', []);

    expect(edges.length).toBeGreaterThanOrEqual(1);
    const edge = edges.find((e) => e.targetServiceName.includes('Appointments'));
    expect(edge).toBeDefined();
    expect(edge!.mechanism).toBe('grpc');
    expect(edge!.confidence).toBe('high');
    expect(edge!.metadata.pattern).toBe('mockable');
  });

  it('detects RpcClient.Client with service and stub', () => {
    const content = `
defmodule Fresha.Catalog.Protobuf.Rpc.V1.CatalogRpcService.Client do
  use RpcClient.Client, service: Fresha.Catalog.Protobuf.Rpc.V1.CatalogRpcService, stub: Fresha.Catalog.Protobuf.Rpc.V1.CatalogRpcService.Stub
end`;

    mockListBranchFiles.mockReturnValue(['lib/generated/catalog_service_client_impl.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractGrpcClientEdges('/repo', 'main', []);

    expect(edges.length).toBeGreaterThanOrEqual(1);
    const edge = edges.find((e) => e.targetServiceName.includes('Catalog'));
    expect(edge).toBeDefined();
    expect(edge!.mechanism).toBe('grpc');
    expect(edge!.confidence).toBe('high');
    expect(edge!.metadata.pattern).toBe('client');
    expect(edge!.metadata.stub).toContain('Stub');
  });

  it('reuses existing grpcStubs from ElixirModule[]', () => {
    const modules: ElixirModule[] = [
      makeModule({
        name: 'Checkout.OrderProcessor',
        filePath: 'lib/checkout/order_processor.ex',
        grpcStubs: ['Rpc.Partners.V1.RPCService.Stub'],
      }),
    ];

    mockListBranchFiles.mockReturnValue([]);
    mockReadBranchFile.mockReturnValue(null);

    const edges = extractGrpcClientEdges('/repo', 'main', modules);

    expect(edges.length).toBeGreaterThanOrEqual(1);
    const edge = edges.find((e) => e.targetServiceName.includes('Partners'));
    expect(edge).toBeDefined();
    expect(edge!.mechanism).toBe('grpc');
    expect(edge!.confidence).toBe('high');
    expect(edge!.metadata.pattern).toBe('direct');
  });

  it('deduplicates by service name', () => {
    // Both MockableRpcClient and generated Client for the same service
    const mockableContent = `
defmodule Checkout.GrpcClients.Customers do
  use RpcClient.MockableRpcClient,
    behaviour: Rpc.Customers.V1.RPCService.ClientBehaviour
end`;

    const generatedContent = `
defmodule Fresha.Customers.Protobuf.Rpc.V1.CustomersRpcService.Client do
  use RpcClient.Client, service: Fresha.Customers.Protobuf.Rpc.V1.CustomersRpcService, stub: Fresha.Customers.Protobuf.Rpc.V1.CustomersRpcService.Stub
end`;

    mockListBranchFiles.mockReturnValue([
      'lib/checkout/grpc_clients/customers.ex',
      'lib/generated/customers_client_impl.ex',
    ]);
    mockReadBranchFile.mockImplementation((_repo, _branch, filePath) => {
      if (filePath === 'lib/checkout/grpc_clients/customers.ex') return mockableContent;
      if (filePath === 'lib/generated/customers_client_impl.ex') return generatedContent;
      return null;
    });

    const edges = extractGrpcClientEdges('/repo', 'main', []);

    // Should deduplicate to one edge for "Customers"
    const customerEdges = edges.filter((e) =>
      e.targetServiceName.toLowerCase().includes('customers')
    );
    expect(customerEdges.length).toBe(1);
  });

  it('skips files under test/ or *_test.exs paths', () => {
    const content = `
defmodule Test.GrpcClients.Appointments do
  use RpcClient.MockableRpcClient,
    behaviour: Rpc.Appointments.V1.RPCService.ClientBehaviour
end`;

    mockListBranchFiles.mockReturnValue([
      'test/grpc_clients/appointments_test.exs',
      'lib/test/grpc_mock.ex',
    ]);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractGrpcClientEdges('/repo', 'main', []);

    expect(edges.length).toBe(0);
  });
});

describe('http-clients', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects Tesla.Middleware.BaseUrl pattern', () => {
    const content = `
defmodule MyApp.InternalClient do
  use Tesla

  plug Tesla.Middleware.BaseUrl, "https://some-service.internal"
  plug Tesla.Middleware.JSON
end`;

    mockListBranchFiles.mockReturnValue(['lib/my_app/internal_client.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractHttpClientEdges('/repo', 'main');

    expect(edges.length).toBe(1);
    expect(edges[0]!.mechanism).toBe('http');
    expect(edges[0]!.confidence).toBe('low');
    expect(edges[0]!.metadata.url).toBe('https://some-service.internal');
  });

  it('detects @base_url module attribute pattern', () => {
    const content = `
defmodule MyApp.ApiClient do
  @base_url "https://payments.internal/api"

  def get_payment(id) do
    HTTPoison.get!(@base_url <> "/payments/#{id}")
  end
end`;

    mockListBranchFiles.mockReturnValue(['lib/my_app/api_client.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractHttpClientEdges('/repo', 'main');

    expect(edges.length).toBe(1);
    expect(edges[0]!.confidence).toBe('low');
    expect(edges[0]!.metadata.url).toBe('https://payments.internal/api');
  });

  it('skips known external URLs', () => {
    const content = `
defmodule MyApp.GoogleClient do
  use Tesla
  plug Tesla.Middleware.BaseUrl, "https://accounts.google.com"
end

defmodule MyApp.OpenAIClient do
  use Tesla
  plug Tesla.Middleware.BaseUrl, "https://api.openai.com"
end

defmodule MyApp.StripeClient do
  @base_url "https://api.stripe.com/v1"
end`;

    mockListBranchFiles.mockReturnValue(['lib/my_app/clients.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractHttpClientEdges('/repo', 'main');

    expect(edges.length).toBe(0);
  });

  it('returns empty array when no HTTP client patterns found', () => {
    const content = `
defmodule MyApp.PureLogic do
  def add(a, b), do: a + b
end`;

    mockListBranchFiles.mockReturnValue(['lib/my_app/pure_logic.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractHttpClientEdges('/repo', 'main');

    expect(edges.length).toBe(0);
  });
});

describe('kafka', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('detects @topic_name module attribute as producer', () => {
    const content = `
defmodule Appointments.Events.AppointmentsHydration do
  @topic_name "appointments.hydration-events-v1"

  def produce(event) do
    Kafkaesque.Producer.produce_batch(@worker, @topic_name, [event])
  end
end`;

    mockListBranchFiles.mockReturnValue(['lib/appointments/events/hydration.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractKafkaEdges('/repo', 'main');

    const producers = edges.filter((e) => e.metadata.role === 'producer');
    expect(producers.length).toBe(1);
    expect(producers[0]!.mechanism).toBe('kafka');
    expect(producers[0]!.confidence).toBe('high');
    expect(producers[0]!.metadata.topic).toBe('appointments.hydration-events-v1');
  });

  it('detects Kafkaesque.Producer.produce_batch pattern', () => {
    const content = `
defmodule MyApp.EventPublisher do
  @topic_name "orders.created-v1"

  def publish(events) do
    Kafkaesque.Producer.produce_batch(@worker_name, @topic_name, events)
  end
end`;

    mockListBranchFiles.mockReturnValue(['lib/my_app/event_publisher.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractKafkaEdges('/repo', 'main');

    expect(edges.length).toBeGreaterThanOrEqual(1);
    const producer = edges.find((e) => e.metadata.role === 'producer');
    expect(producer).toBeDefined();
    expect(producer!.metadata.topic).toBe('orders.created-v1');
  });

  it('detects Kafkaesque.Consumer topics_config pattern', () => {
    const content = `
defmodule MyApp.OrderEventsConsumer do
  use Kafkaesque.Consumer,
    topics_config: %{
      "orders.created-v1" => %{
        handler: MyApp.Handlers.OrderCreated
      }
    }
end`;

    mockListBranchFiles.mockReturnValue(['lib/my_app/consumers/order_events.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractKafkaEdges('/repo', 'main');

    const consumers = edges.filter((e) => e.metadata.role === 'consumer');
    expect(consumers.length).toBe(1);
    expect(consumers[0]!.mechanism).toBe('kafka');
    expect(consumers[0]!.confidence).toBe('high');
    expect(consumers[0]!.metadata.topic).toBe('orders.created-v1');
  });

  it('detects Outbox.emit as producer pattern', () => {
    const content = `
defmodule MyApp.OrderCreator do
  @topic_name "orders.events-v1"

  def create(params) do
    order = do_create(params)
    Outbox.emit(@topic_name, order)
    order
  end
end`;

    mockListBranchFiles.mockReturnValue(['lib/my_app/order_creator.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractKafkaEdges('/repo', 'main');

    const producers = edges.filter((e) => e.metadata.role === 'producer');
    expect(producers.length).toBe(1);
    expect(producers[0]!.metadata.topic).toBe('orders.events-v1');
  });

  it('returns empty when file has no Kafka patterns', () => {
    const content = `
defmodule MyApp.MathHelper do
  def add(a, b), do: a + b
end`;

    mockListBranchFiles.mockReturnValue(['lib/my_app/math_helper.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractKafkaEdges('/repo', 'main');

    expect(edges.length).toBe(0);
  });

  it('detects ConsumerSupervisor topics variant', () => {
    const content = `
defmodule MyApp.ConsumerSup do
  use Kafkaesque.ConsumerSupervisor,
    topics: ["checkout.payments-v1"]
end`;

    mockListBranchFiles.mockReturnValue(['lib/my_app/consumer_sup.ex']);
    mockReadBranchFile.mockReturnValue(content);

    const edges = extractKafkaEdges('/repo', 'main');

    const consumers = edges.filter((e) => e.metadata.role === 'consumer');
    expect(consumers.length).toBe(1);
    expect(consumers[0]!.metadata.topic).toBe('checkout.payments-v1');
  });
});
