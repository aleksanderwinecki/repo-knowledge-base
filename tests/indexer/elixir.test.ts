import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { extractElixirModules, parseElixirFile } from '../../src/indexer/elixir.js';

let tmpDir: string;

function setupMockElixirRepo(files: Record<string, string>): string {
  const repoDir = path.join(tmpDir, 'test-repo');
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(repoDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }
  return repoDir;
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-elixir-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseElixirFile', () => {
  it('extracts defmodule name', () => {
    const content = `
defmodule MyApp.Booking do
  def hello, do: :world
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('MyApp.Booking');
  });

  it('extracts @moduledoc from heredoc', () => {
    const content = `
defmodule MyApp.Booking do
  @moduledoc """
  Handles bookings for the platform.
  """

  def create(attrs), do: :ok
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules[0].moduledoc).toBe('Handles bookings for the platform.');
  });

  it('extracts @moduledoc from single-line string', () => {
    const content = `
defmodule MyApp.Simple do
  @moduledoc "A simple module"
  def run, do: :ok
end
`;
    const modules = parseElixirFile('lib/simple.ex', content);
    expect(modules[0].moduledoc).toBe('A simple module');
  });

  it('handles @moduledoc false', () => {
    const content = `
defmodule MyApp.Internal do
  @moduledoc false
  def secret, do: :hidden
end
`;
    const modules = parseElixirFile('lib/internal.ex', content);
    expect(modules[0].moduledoc).toBeNull();
  });

  it('extracts public function signatures', () => {
    const content = `
defmodule MyApp.Booking do
  def create(attrs), do: :ok
  def cancel(id, reason), do: :ok
  def list(), do: []
  defp validate(attrs), do: :ok
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules[0].functions).toContain('create/1');
    expect(modules[0].functions).toContain('cancel/2');
    expect(modules[0].functions).toContain('list/0');
  });

  it('ignores private functions (defp)', () => {
    const content = `
defmodule MyApp.Booking do
  def public_fn(x), do: x
  defp private_fn(x), do: x
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules[0].functions).toContain('public_fn/1');
    expect(modules[0].functions).not.toContain('private_fn/1');
  });

  it('classifies context modules', () => {
    const content = `defmodule BookingContext do\nend`;
    const modules = parseElixirFile('lib/booking_context.ex', content);
    expect(modules[0].type).toBe('context');
  });

  it('classifies command modules', () => {
    const content = `defmodule BookingContext.Commands.CreateBooking do\nend`;
    const modules = parseElixirFile('lib/commands/create.ex', content);
    expect(modules[0].type).toBe('command');
  });

  it('classifies query modules', () => {
    const content = `defmodule BookingContext.Queries.GetSlots do\nend`;
    const modules = parseElixirFile('lib/queries/get_slots.ex', content);
    expect(modules[0].type).toBe('query');
  });

  it('detects Ecto schema with table name', () => {
    const content = `
defmodule MyApp.Booking do
  use Ecto.Schema

  schema "bookings" do
    field :name, :string
    timestamps()
  end
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules[0].type).toBe('schema');
    expect(modules[0].tableName).toBe('bookings');
  });

  it('handles multiple modules in one file', () => {
    const content = `
defmodule MyApp.ModuleA do
  @moduledoc "Module A"
  def a, do: :a
end

defmodule MyApp.ModuleB do
  @moduledoc "Module B"
  def b, do: :b
end
`;
    const modules = parseElixirFile('lib/multi.ex', content);
    expect(modules).toHaveLength(2);
    expect(modules[0].name).toBe('MyApp.ModuleA');
    expect(modules[1].name).toBe('MyApp.ModuleB');
  });

  it('deduplicates multi-clause functions', () => {
    const content = `
defmodule MyApp.Handler do
  def handle(:ok), do: :ok
  def handle(:error), do: :error
  def handle(_other), do: :unknown
end
`;
    const modules = parseElixirFile('lib/handler.ex', content);
    const handleFns = modules[0].functions.filter((f) => f.startsWith('handle/'));
    expect(handleFns).toHaveLength(1);
    expect(handleFns[0]).toBe('handle/1');
  });
});

describe('ecto schema extraction', () => {
  it('extracts schema fields with name and type', () => {
    const content = `
defmodule MyApp.Booking do
  use Ecto.Schema

  schema "bookings" do
    field :date, :date
    field :status, :string
    timestamps()
  end
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules[0].schemaFields).toEqual([
      { name: 'date', type: 'date' },
      { name: 'status', type: 'string' },
    ]);
  });

  it('extracts associations with kind, name, and target', () => {
    const content = `
defmodule MyApp.Booking do
  use Ecto.Schema

  schema "bookings" do
    field :date, :date
    belongs_to :user, MyApp.Accounts.User
    has_many :items, MyApp.Booking.Item
    timestamps()
  end
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules[0].associations).toEqual([
      { kind: 'belongs_to', name: 'user', target: 'MyApp.Accounts.User' },
      { kind: 'has_many', name: 'items', target: 'MyApp.Booking.Item' },
    ]);
  });

  it('captures has_one and many_to_many association kinds', () => {
    const content = `
defmodule MyApp.User do
  use Ecto.Schema

  schema "users" do
    has_one :profile, MyApp.Profile
    many_to_many :roles, MyApp.Role, join_through: "users_roles"
    timestamps()
  end
end
`;
    const modules = parseElixirFile('lib/user.ex', content);
    expect(modules[0].associations).toContainEqual(
      { kind: 'has_one', name: 'profile', target: 'MyApp.Profile' },
    );
    expect(modules[0].associations).toContainEqual(
      { kind: 'many_to_many', name: 'roles', target: 'MyApp.Role' },
    );
  });

  it('skips embedded_schema - returns no schemaFields', () => {
    const content = `
defmodule MyApp.Address do
  use Ecto.Schema

  embedded_schema do
    field :street, :string
    field :city, :string
  end
end
`;
    const modules = parseElixirFile('lib/address.ex', content);
    expect(modules[0].schemaFields).toEqual([]);
    expect(modules[0].associations).toEqual([]);
  });

  it('returns empty schemaFields and associations for module without schema', () => {
    const content = `
defmodule MyApp.Helper do
  def format(x), do: x
end
`;
    const modules = parseElixirFile('lib/helper.ex', content);
    expect(modules[0].schemaFields).toEqual([]);
    expect(modules[0].associations).toEqual([]);
  });

  it('captures parenthesized field syntax field(:name, :type)', () => {
    const content = `
defmodule MyApp.Event do
  use Ecto.Schema

  schema "events" do
    field(:name, :string)
    field(:payload, :map)
    field :status, :string
    timestamps()
  end
end
`;
    const modules = parseElixirFile('lib/event.ex', content);
    expect(modules[0].schemaFields).toEqual([
      { name: 'name', type: 'string' },
      { name: 'payload', type: 'map' },
      { name: 'status', type: 'string' },
    ]);
  });

  it('does not include timestamps() in schemaFields', () => {
    const content = `
defmodule MyApp.Booking do
  use Ecto.Schema

  schema "bookings" do
    field :name, :string
    timestamps()
  end
end
`;
    const modules = parseElixirFile('lib/booking.ex', content);
    expect(modules[0].schemaFields).toEqual([{ name: 'name', type: 'string' }]);
    // timestamps should NOT appear as a field
    expect(modules[0].schemaFields.find((f: any) => f.name === 'inserted_at')).toBeUndefined();
    expect(modules[0].schemaFields.find((f: any) => f.name === 'updated_at')).toBeUndefined();
  });
});

describe('absinthe macro extraction', () => {
  it('extracts object macro with atom name', () => {
    const content = `
defmodule MyApp.Schema.Types do
  use Absinthe.Schema.Notation

  object :booking do
    field :id, :id
    field :date, :date
  end
end
`;
    const modules = parseElixirFile('lib/schema/types.ex', content);
    expect(modules[0].absintheTypes).toEqual([
      { kind: 'object', name: 'booking' },
    ]);
  });

  it('extracts input_object, query, and mutation macros', () => {
    const content = `
defmodule MyApp.Schema do
  use Absinthe.Schema

  query do
    field :bookings, list_of(:booking)
  end

  mutation do
    field :create_booking, :booking
  end

  input_object :booking_input do
    field :date, :date
  end
end
`;
    const modules = parseElixirFile('lib/schema.ex', content);
    expect(modules[0].absintheTypes).toContainEqual({ kind: 'query', name: 'query' });
    expect(modules[0].absintheTypes).toContainEqual({ kind: 'mutation', name: 'mutation' });
    expect(modules[0].absintheTypes).toContainEqual({ kind: 'input_object', name: 'booking_input' });
  });

  it('query/mutation blocks without atom name use kind as name', () => {
    const content = `
defmodule MyApp.Schema do
  use Absinthe.Schema

  query do
    field :me, :user
  end

  mutation do
    field :login, :session
  end
end
`;
    const modules = parseElixirFile('lib/schema.ex', content);
    const query = modules[0].absintheTypes.find((t: any) => t.kind === 'query');
    expect(query).toEqual({ kind: 'query', name: 'query' });
    const mutation = modules[0].absintheTypes.find((t: any) => t.kind === 'mutation');
    expect(mutation).toEqual({ kind: 'mutation', name: 'mutation' });
  });

  it('returns empty absintheTypes for module without Absinthe macros', () => {
    const content = `
defmodule MyApp.Helper do
  def format(x), do: x
end
`;
    const modules = parseElixirFile('lib/helper.ex', content);
    expect(modules[0].absintheTypes).toEqual([]);
  });
});

describe('grpc stub detection', () => {
  it('detects RpcClient.Client with stub keyword', () => {
    const content = `
defmodule MyApp.Rpc.AppointmentsClient do
  use RpcClient.Client,
    service: Rpc.Appointments.V1.RPCService,
    stub: Rpc.Appointments.V1.RPCService.Stub
end
`;
    const modules = parseElixirFile('lib/rpc/appointments_client.ex', content);
    expect(modules[0].grpcStubs).toEqual(['Rpc.Appointments.V1.RPCService.Stub']);
  });

  it('detects direct Stub.method() calls', () => {
    const content = `
defmodule MyApp.Booking.Service do
  def create_booking(channel, request) do
    BookingService.Stub.create_booking(channel, request)
  end
end
`;
    const modules = parseElixirFile('lib/booking/service.ex', content);
    expect(modules[0].grpcStubs).toEqual(['BookingService.Stub']);
  });

  it('detects RpcClient.MockableRpcClient pattern', () => {
    const content = `
defmodule MyApp.Rpc.MockClient do
  use RpcClient.MockableRpcClient,
    service: Rpc.Payments.V1.RPCService,
    stub: Rpc.Payments.V1.RPCService.Stub
end
`;
    const modules = parseElixirFile('lib/rpc/mock_client.ex', content);
    expect(modules[0].grpcStubs).toEqual(['Rpc.Payments.V1.RPCService.Stub']);
  });

  it('returns empty grpcStubs for module without gRPC usage', () => {
    const content = `
defmodule MyApp.Helper do
  def format(x), do: x
end
`;
    const modules = parseElixirFile('lib/helper.ex', content);
    expect(modules[0].grpcStubs).toEqual([]);
  });
});

describe('parseElixirFile module attribute integration', () => {
  it('populates optionalFields from @optional_fields attribute', () => {
    const content = `
defmodule MyApp.User do
  use Ecto.Schema

  @required_fields ~w(name email)a
  @optional_fields ~w(bio phone)a

  schema "users" do
    field :name, :string
    field :email, :string
    field :bio, :string
    field :phone, :string
  end

  def changeset(user, attrs) do
    user
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
  end
end`;
    const modules = parseElixirFile('lib/my_app/user.ex', content);
    expect(modules).toHaveLength(1);
    expect(modules[0].optionalFields).toEqual(expect.arrayContaining(['bio', 'phone']));
    expect(modules[0].optionalFields).toHaveLength(2);
  });

  it('populates castFields from cast/4 calls', () => {
    const content = `
defmodule MyApp.User do
  use Ecto.Schema

  @required_fields ~w(name email)a
  @optional_fields ~w(bio phone)a

  schema "users" do
    field :name, :string
    field :email, :string
    field :bio, :string
    field :phone, :string
  end

  def changeset(user, attrs) do
    user
    |> cast(attrs, @required_fields ++ @optional_fields)
    |> validate_required(@required_fields)
  end
end`;
    const modules = parseElixirFile('lib/my_app/user.ex', content);
    expect(modules).toHaveLength(1);
    expect(modules[0].castFields).toEqual(expect.arrayContaining(['name', 'email', 'bio', 'phone']));
    expect(modules[0].castFields).toHaveLength(4);
  });

  it('populates requiredFields including attribute-resolved fields from validate_required(@attr)', () => {
    const content = `
defmodule MyApp.User do
  use Ecto.Schema

  @required_fields ~w(name email)a

  schema "users" do
    field :name, :string
    field :email, :string
    field :bio, :string
  end

  def changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email, :bio])
    |> validate_required(@required_fields)
  end
end`;
    const modules = parseElixirFile('lib/my_app/user.ex', content);
    expect(modules).toHaveLength(1);
    expect(modules[0].requiredFields).toEqual(expect.arrayContaining(['name', 'email']));
    expect(modules[0].requiredFields).toHaveLength(2);
  });

  it('computes optionalFields as cast-only fields (in cast but not required)', () => {
    const content = `
defmodule MyApp.Profile do
  use Ecto.Schema

  schema "profiles" do
    field :name, :string
    field :bio, :string
    field :avatar, :string
  end

  def changeset(profile, attrs) do
    profile
    |> cast(attrs, [:name, :bio, :avatar])
    |> validate_required([:name])
  end
end`;
    const modules = parseElixirFile('lib/my_app/profile.ex', content);
    expect(modules).toHaveLength(1);
    expect(modules[0].requiredFields).toEqual(['name']);
    expect(modules[0].castFields).toEqual(expect.arrayContaining(['name', 'bio', 'avatar']));
    expect(modules[0].optionalFields).toEqual(expect.arrayContaining(['bio', 'avatar']));
    expect(modules[0].optionalFields).not.toContain('name');
  });

  it('handles module with no changeset - empty optionalFields and castFields', () => {
    const content = `
defmodule MyApp.Helper do
  def format(x), do: x
end`;
    const modules = parseElixirFile('lib/helper.ex', content);
    expect(modules).toHaveLength(1);
    expect(modules[0].optionalFields).toEqual([]);
    expect(modules[0].castFields).toEqual([]);
  });
});

describe('extractElixirModules (working tree)', () => {
  function setupGitElixirRepo(files: Record<string, string>): string {
    const repoDir = path.join(tmpDir, 'git-elixir-repo');
    fs.mkdirSync(repoDir, { recursive: true });

    const { execSync } = require('child_process');
    execSync('git init', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });
    execSync('git checkout -b main', { cwd: repoDir, stdio: 'pipe' });

    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(repoDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }
    execSync('git add -A', { cwd: repoDir, stdio: 'pipe' });
    execSync('git commit -m "initial"', { cwd: repoDir, stdio: 'pipe' });

    return repoDir;
  }

  it('finds modules from working tree in lib/ directory', () => {
    const repoDir = setupGitElixirRepo({
      'lib/booking.ex': `defmodule MyApp.Booking do\n  def create(x), do: x\nend`,
    });

    const modules = extractElixirModules(repoDir);
    expect(modules).toHaveLength(1);
    expect(modules[0].name).toBe('MyApp.Booking');
  });

  it('finds modules from working tree in apps/ umbrella structure', () => {
    const repoDir = setupGitElixirRepo({
      'apps/booking/lib/booking.ex': `defmodule Booking do\nend`,
      'apps/payments/lib/payments.ex': `defmodule Payments do\nend`,
    });

    const modules = extractElixirModules(repoDir);
    expect(modules).toHaveLength(2);
  });

  it('returns empty for working tree with no lib/ files', () => {
    const repoDir = setupGitElixirRepo({
      'README.md': '# Hello',
    });

    const modules = extractElixirModules(repoDir);
    expect(modules).toHaveLength(0);
  });

  it('reads from working tree (includes all files present on disk)', () => {
    const repoDir = setupGitElixirRepo({
      'lib/main_module.ex': `defmodule MainModule do\nend`,
    });

    const { execSync } = require('child_process');
    // Create feature branch with additional module
    execSync('git checkout -b feature/new', { cwd: repoDir, stdio: 'pipe' });
    const featurePath = path.join(repoDir, 'lib', 'feature_module.ex');
    fs.writeFileSync(featurePath, `defmodule FeatureModule do\nend`);
    execSync('git add -A && git commit -m "feature"', { cwd: repoDir, stdio: 'pipe' });

    // Working tree is on feature branch, both modules are visible
    const modules = extractElixirModules(repoDir);
    expect(modules).toHaveLength(2);
    const names = modules.map(m => m.name).sort();
    expect(names).toEqual(['FeatureModule', 'MainModule']);
  });
});
