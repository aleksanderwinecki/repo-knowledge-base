import { describe, it, expect } from 'vitest';
import { extractRequiredFields, resolveModuleAttributes, extractCastFields, parseElixirFile } from '../../src/indexer/elixir.js';
import { parseProtoFile } from '../../src/indexer/proto.js';
import { parseGraphqlFields } from '../../src/indexer/graphql.js';
import type { GraphqlField } from '../../src/indexer/graphql.js';

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

  it('resolves @required_fields attribute reference in validate_required', () => {
    const content = `
defmodule MyApp.User do
  @required_fields ~w(name email)a

  def changeset(user, attrs) do
    user
    |> validate_required(@required_fields)
  end
end`;
    const attrs = resolveModuleAttributes(content);
    const result = extractRequiredFields(content, attrs);
    expect(result).toEqual(new Set(['name', 'email']));
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

describe('Module attribute resolution', () => {
  it('extracts ~w(...)a sigil form into field name list', () => {
    const content = `
defmodule MyApp.User do
  @required_fields ~w(name email)a
  @optional_fields ~w(bio phone)a
end`;
    const attrs = resolveModuleAttributes(content);
    expect(attrs['required_fields']).toEqual(['name', 'email']);
    expect(attrs['optional_fields']).toEqual(['bio', 'phone']);
  });

  it('extracts [:atom, :atom] list form into field name list', () => {
    const content = `
defmodule MyApp.User do
  @required_fields [:name, :email]
  @optional_fields [:bio, :phone]
end`;
    const attrs = resolveModuleAttributes(content);
    expect(attrs['required_fields']).toEqual(['name', 'email']);
    expect(attrs['optional_fields']).toEqual(['bio', 'phone']);
  });

  it('handles mixed forms in the same module', () => {
    const content = `
defmodule MyApp.User do
  @required ~w(name email)a
  @optional [:bio, :phone]
end`;
    const attrs = resolveModuleAttributes(content);
    expect(attrs['required']).toEqual(['name', 'email']);
    expect(attrs['optional']).toEqual(['bio', 'phone']);
  });

  it('ignores well-known non-field attributes like @moduledoc, @doc, @derive', () => {
    const content = `
defmodule MyApp.User do
  @moduledoc "A user module"
  @doc "Creates a user"
  @derive [Jason.Encoder]
  @behaviour MyBehaviour
  @required_fields ~w(name email)a
end`;
    const attrs = resolveModuleAttributes(content);
    expect(attrs['moduledoc']).toBeUndefined();
    expect(attrs['doc']).toBeUndefined();
    expect(attrs['derive']).toBeUndefined();
    expect(attrs['behaviour']).toBeUndefined();
    expect(attrs['required_fields']).toEqual(['name', 'email']);
  });

  it('handles multi-line ~w sigil content', () => {
    const content = `
defmodule MyApp.User do
  @required_fields ~w(
    name
    email
    status
  )a
end`;
    const attrs = resolveModuleAttributes(content);
    expect(attrs['required_fields']).toEqual(['name', 'email', 'status']);
  });

  it('handles multi-line atom list content', () => {
    const content = `
defmodule MyApp.User do
  @required_fields [
    :name,
    :email,
    :status
  ]
end`;
    const attrs = resolveModuleAttributes(content);
    expect(attrs['required_fields']).toEqual(['name', 'email', 'status']);
  });
});

describe('Cast field extraction', () => {
  it('extracts inline atom list from cast(x, y, [:field1, :field2])', () => {
    const content = `
defmodule MyApp.User do
  def changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email, :bio])
  end
end`;
    const result = extractCastFields(content, {});
    expect(result).toEqual(new Set(['name', 'email', 'bio']));
  });

  it('extracts pipe form |> cast(params, [:field1, :field2])', () => {
    const content = `
defmodule MyApp.User do
  def changeset(user, attrs) do
    user
    |> cast(attrs, [:name, :email])
  end
end`;
    const result = extractCastFields(content, {});
    expect(result).toEqual(new Set(['name', 'email']));
  });

  it('resolves cast(x, y, @fields) via attribute map', () => {
    const content = `
defmodule MyApp.User do
  @fields ~w(name email bio)a

  def changeset(user, attrs) do
    user
    |> cast(attrs, @fields)
  end
end`;
    const attrs = resolveModuleAttributes(content);
    const result = extractCastFields(content, attrs);
    expect(result).toEqual(new Set(['name', 'email', 'bio']));
  });

  it('resolves concatenation cast(x, y, @required ++ @optional)', () => {
    const content = `
defmodule MyApp.User do
  @required ~w(name email)a
  @optional ~w(bio phone)a

  def changeset(user, attrs) do
    user
    |> cast(attrs, @required ++ @optional)
  end
end`;
    const attrs = resolveModuleAttributes(content);
    const result = extractCastFields(content, attrs);
    expect(result).toEqual(new Set(['name', 'email', 'bio', 'phone']));
  });

  it('handles pipe form with attribute reference |> cast(params, @fields)', () => {
    const content = `
defmodule MyApp.User do
  @permitted ~w(name email)a

  def changeset(user, attrs) do
    user
    |> cast(attrs, @permitted)
  end
end`;
    const attrs = resolveModuleAttributes(content);
    const result = extractCastFields(content, attrs);
    expect(result).toEqual(new Set(['name', 'email']));
  });

  it('handles pipe form with concatenation |> cast(params, @required ++ @optional)', () => {
    const content = `
defmodule MyApp.User do
  @required ~w(name)a
  @optional ~w(bio)a

  def changeset(user, attrs) do
    user
    |> cast(attrs, @required ++ @optional)
  end
end`;
    const attrs = resolveModuleAttributes(content);
    const result = extractCastFields(content, attrs);
    expect(result).toEqual(new Set(['name', 'bio']));
  });
});

describe('Attribute-aware required fields', () => {
  it('resolves validate_required(@attr) via attribute map', () => {
    const content = `
defmodule MyApp.User do
  @required_fields ~w(name email)a

  def changeset(user, attrs) do
    user
    |> validate_required(@required_fields)
  end
end`;
    const attrs = resolveModuleAttributes(content);
    const result = extractRequiredFields(content, attrs);
    expect(result).toEqual(new Set(['name', 'email']));
  });

  it('still handles inline atom lists validate_required([:name, :email])', () => {
    const content = `
defmodule MyApp.User do
  def changeset(user, attrs) do
    user
    |> validate_required([:name, :email])
  end
end`;
    const result = extractRequiredFields(content, {});
    expect(result).toEqual(new Set(['name', 'email']));
  });

  it('handles pipe form |> validate_required(@attr)', () => {
    const content = `
defmodule MyApp.User do
  @required ~w(name email)a

  def changeset(user, attrs) do
    user
    |> validate_required(@required)
  end
end`;
    const attrs = resolveModuleAttributes(content);
    const result = extractRequiredFields(content, attrs);
    expect(result).toEqual(new Set(['name', 'email']));
  });

  it('unions results across multiple validate_required calls (attribute + inline)', () => {
    const content = `
defmodule MyApp.User do
  @base_required ~w(name email)a

  def create_changeset(user, attrs) do
    user
    |> validate_required(@base_required)
  end

  def update_changeset(user, attrs) do
    user
    |> validate_required([:status, :role])
  end
end`;
    const attrs = resolveModuleAttributes(content);
    const result = extractRequiredFields(content, attrs);
    expect(result).toEqual(new Set(['name', 'email', 'status', 'role']));
  });

  it('handles direct call form with changeset arg validate_required(changeset, @attr)', () => {
    const content = `
defmodule MyApp.User do
  @required_fields ~w(name email)a

  def changeset(user, attrs) do
    validate_required(changeset, @required_fields)
  end
end`;
    const attrs = resolveModuleAttributes(content);
    const result = extractRequiredFields(content, attrs);
    expect(result).toEqual(new Set(['name', 'email']));
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

describe('GraphQL field parsing', () => {
  it('parses basic field declaration', () => {
    const result = parseGraphqlFields('name: String');
    expect(result).toEqual([{ name: 'name', type: 'String' }]);
  });

  it('parses non-null field with !', () => {
    const result = parseGraphqlFields('name: String!');
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('String!');
  });

  it('parses list type', () => {
    const result = parseGraphqlFields('items: [Item]');
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('[Item]');
  });

  it('parses non-null list of non-null items', () => {
    const result = parseGraphqlFields('items: [Item!]!');
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('[Item!]!');
  });

  it('parses field with arguments', () => {
    const result = parseGraphqlFields('users(limit: Int): [User]');
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: 'users', type: '[User]' });
  });

  it('parses multiple fields in body', () => {
    const body = `
  id: ID!
  name: String!
  email: String
  posts: [Post!]!
`;
    const result = parseGraphqlFields(body);
    expect(result).toHaveLength(4);
    expect(result[0]).toEqual({ name: 'id', type: 'ID!' });
    expect(result[1]).toEqual({ name: 'name', type: 'String!' });
    expect(result[2]).toEqual({ name: 'email', type: 'String' });
    expect(result[3]).toEqual({ name: 'posts', type: '[Post!]!' });
  });

  it('returns empty array for enum body (no colon lines)', () => {
    const body = `
  PENDING
  CONFIRMED
  CANCELLED
`;
    const result = parseGraphqlFields(body);
    expect(result).toHaveLength(0);
  });

  it('skips comment lines', () => {
    const body = `
  # This is a comment
  name: String!
  # Another comment
  email: String
`;
    const result = parseGraphqlFields(body);
    expect(result).toHaveLength(2);
    expect(result[0]!.name).toBe('name');
    expect(result[1]!.name).toBe('email');
  });

  it('returns empty array for empty body', () => {
    const result = parseGraphqlFields('');
    expect(result).toHaveLength(0);
  });

  it('GraphqlField interface has name and type properties', () => {
    const field: GraphqlField = { name: 'test', type: 'String!' };
    expect(field.name).toBe('test');
    expect(field.type).toBe('String!');
  });
});

describe('Combined nullability in pipeline', () => {
  // Simulates the pipeline.ts ectoFields mapping logic
  function computeNullable(
    fieldName: string,
    requiredFields: string[],
  ): boolean {
    const requiredSet = new Set(requiredFields);
    return !requiredSet.has(fieldName);
  }

  it('field in requiredFields from validate_required inline -> not nullable', () => {
    expect(computeNullable('name', ['name', 'email'])).toBe(false);
  });

  it('field in requiredFields from @attr resolution -> not nullable', () => {
    // Simulate: @required_fields ~w(name email)a + validate_required(@required_fields)
    // After Task 1, requiredFields already contains resolved attr fields
    expect(computeNullable('email', ['name', 'email'])).toBe(false);
  });

  it('field in @optional_fields -> nullable', () => {
    // bio is only in optional/cast, not in required
    expect(computeNullable('bio', ['name', 'email'])).toBe(true);
  });

  it('field in cast but NOT in requiredFields -> nullable', () => {
    expect(computeNullable('phone', ['name'])).toBe(true);
  });

  it('schema field with no changeset mention -> nullable', () => {
    expect(computeNullable('legacy_flag', [])).toBe(true);
  });

  it('module with @required_fields + @optional_fields: correct nullability split', () => {
    // @required_fields ~w(name email)a
    // @optional_fields ~w(bio)a
    // cast(attrs, @required_fields ++ @optional_fields)
    // validate_required(@required_fields)
    const required = ['name', 'email'];
    expect(computeNullable('name', required)).toBe(false);
    expect(computeNullable('email', required)).toBe(false);
    expect(computeNullable('bio', required)).toBe(true);
  });

  it('module with only validate_required([:name]) + cast(attrs, [:name, :email])', () => {
    const required = ['name'];
    expect(computeNullable('name', required)).toBe(false);
    expect(computeNullable('email', required)).toBe(true);
  });
});
