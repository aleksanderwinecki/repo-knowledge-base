import { describe, it, expect } from 'vitest';
import { extractRequiredFields, parseElixirFile } from '../../src/indexer/elixir.js';
import { parseProtoFile } from '../../src/indexer/proto.js';

describe('Elixir required fields', () => {
  it('extracts fields from simple validate_required call', () => {
    const content = `
defmodule MyApp.User do
  def changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email, :status])
    |> validate_required(changeset, [:name, :email, :status])
  end
end`;
    const result = extractRequiredFields(content);
    expect(result).toEqual(new Set(['name', 'email', 'status']));
  });

  it('handles multi-line atom lists', () => {
    const content = `
defmodule MyApp.User do
  def changeset(user, attrs) do
    user
    |> validate_required(changeset, [
      :name,
      :email,
      :status
    ])
  end
end`;
    const result = extractRequiredFields(content);
    expect(result).toEqual(new Set(['name', 'email', 'status']));
  });

  it('unions required fields across multiple changesets', () => {
    const content = `
defmodule MyApp.User do
  def create_changeset(user, attrs) do
    user
    |> validate_required(changeset, [:name, :email])
  end

  def update_changeset(user, attrs) do
    user
    |> validate_required(changeset, [:status, :role])
  end
end`;
    const result = extractRequiredFields(content);
    expect(result).toEqual(new Set(['name', 'email', 'status', 'role']));
  });

  it('returns empty set for variable references like @required_fields', () => {
    const content = `
defmodule MyApp.User do
  def changeset(user, attrs) do
    user
    |> validate_required(@required_fields)
  end
end`;
    const result = extractRequiredFields(content);
    expect(result).toEqual(new Set());
  });

  it('handles pipe form |> validate_required([:name])', () => {
    const content = `
defmodule MyApp.User do
  def changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :bio])
    |> validate_required([:name])
  end
end`;
    const result = extractRequiredFields(content);
    expect(result).toEqual(new Set(['name']));
  });

  it('returns empty set when no validate_required present', () => {
    const content = `
defmodule MyApp.User do
  def changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email])
  end
end`;
    const result = extractRequiredFields(content);
    expect(result).toEqual(new Set());
  });

  it('parseElixirFile populates requiredFields on ElixirModule', () => {
    const content = `
defmodule MyApp.User do
  use Ecto.Schema

  schema "users" do
    field :name, :string
    field :email, :string
    field :bio, :string
  end

  def changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email, :bio])
    |> validate_required([:name, :email])
  end
end`;
    const modules = parseElixirFile('lib/my_app/user.ex', content);
    expect(modules).toHaveLength(1);
    expect(modules[0]!.requiredFields).toEqual(expect.arrayContaining(['name', 'email']));
    expect(modules[0]!.requiredFields).toHaveLength(2);
  });
});

describe('Proto optional fields', () => {
  it('marks optional keyword fields as optional: true', () => {
    const result = parseProtoFile('test.proto', `
syntax = "proto3";
message User {
  optional string name = 1;
}
`);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.fields).toHaveLength(1);
    expect(result.messages[0]!.fields[0]!.optional).toBe(true);
    expect(result.messages[0]!.fields[0]!.name).toBe('name');
    expect(result.messages[0]!.fields[0]!.type).toBe('string');
  });

  it('marks plain fields (no qualifier) as optional: false', () => {
    const result = parseProtoFile('test.proto', `
message User {
  string name = 1;
}
`);
    expect(result.messages[0]!.fields[0]!.optional).toBe(false);
  });

  it('marks repeated fields as optional: false', () => {
    const result = parseProtoFile('test.proto', `
message User {
  repeated string names = 1;
}
`);
    expect(result.messages[0]!.fields[0]!.optional).toBe(false);
  });

  it('marks required keyword fields as optional: false', () => {
    const result = parseProtoFile('test.proto', `
message User {
  required string name = 1;
}
`);
    expect(result.messages[0]!.fields[0]!.optional).toBe(false);
  });

  it('handles mix of optional and plain fields', () => {
    const result = parseProtoFile('test.proto', `
message User {
  string id = 1;
  optional string nickname = 2;
  string email = 3;
  optional int32 age = 4;
  repeated string tags = 5;
}
`);
    const fields = result.messages[0]!.fields;
    expect(fields).toHaveLength(5);
    expect(fields[0]).toEqual({ type: 'string', name: 'id', optional: false });
    expect(fields[1]).toEqual({ type: 'string', name: 'nickname', optional: true });
    expect(fields[2]).toEqual({ type: 'string', name: 'email', optional: false });
    expect(fields[3]).toEqual({ type: 'int32', name: 'age', optional: true });
    expect(fields[4]).toEqual({ type: 'string', name: 'tags', optional: false });
  });
});
