import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { parseGraphqlFile, extractGraphqlDefinitions } from '../../src/indexer/graphql.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-graphql-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseGraphqlFile', () => {
  it('extracts a type definition', () => {
    const content = `type Booking {
  id: ID!
  date: String
}`;
    const result = parseGraphqlFile('schema.graphql', content);
    expect(result.types).toHaveLength(1);
    expect(result.types[0].kind).toBe('type');
    expect(result.types[0].name).toBe('Booking');
    expect(result.types[0].body).toContain('id: ID!');
    expect(result.types[0].body).toContain('date: String');
    expect(result.types[0].extended).toBe(false);
  });

  it('extracts input definitions', () => {
    const content = `input CreateBookingInput {
  date: String!
  guestName: String!
}`;
    const result = parseGraphqlFile('schema.graphql', content);
    expect(result.types).toHaveLength(1);
    expect(result.types[0].kind).toBe('input');
    expect(result.types[0].name).toBe('CreateBookingInput');
    expect(result.types[0].body).toContain('date: String!');
  });

  it('extracts enum definitions', () => {
    const content = `enum BookingStatus {
  PENDING
  CONFIRMED
  CANCELLED
}`;
    const result = parseGraphqlFile('schema.graphql', content);
    expect(result.types).toHaveLength(1);
    expect(result.types[0].kind).toBe('enum');
    expect(result.types[0].name).toBe('BookingStatus');
    expect(result.types[0].body).toContain('PENDING');
  });

  it('extracts interface definitions', () => {
    const content = `interface Node {
  id: ID!
}`;
    const result = parseGraphqlFile('schema.graphql', content);
    expect(result.types).toHaveLength(1);
    expect(result.types[0].kind).toBe('interface');
    expect(result.types[0].name).toBe('Node');
  });

  it('extracts union definitions', () => {
    const content = `union SearchResult = Booking | Hotel | Guest`;
    const result = parseGraphqlFile('schema.graphql', content);
    expect(result.types).toHaveLength(1);
    expect(result.types[0].kind).toBe('union');
    expect(result.types[0].name).toBe('SearchResult');
    expect(result.types[0].body).toContain('Booking | Hotel | Guest');
  });

  it('extracts scalar definitions', () => {
    const content = `scalar DateTime`;
    const result = parseGraphqlFile('schema.graphql', content);
    expect(result.types).toHaveLength(1);
    expect(result.types[0].kind).toBe('scalar');
    expect(result.types[0].name).toBe('DateTime');
    expect(result.types[0].body).toBe('');
  });

  it('handles extend type Query', () => {
    const content = `extend type Query {
  bookings: [Booking!]!
  booking(id: ID!): Booking
}`;
    const result = parseGraphqlFile('schema.graphql', content);
    expect(result.types).toHaveLength(1);
    expect(result.types[0].kind).toBe('type');
    expect(result.types[0].name).toBe('Query');
    expect(result.types[0].extended).toBe(true);
    expect(result.types[0].body).toContain('bookings');
  });

  it('extracts Query and Mutation as regular types', () => {
    const content = `type Query {
  bookings: [Booking!]!
}

type Mutation {
  createBooking(input: CreateBookingInput!): Booking!
}`;
    const result = parseGraphqlFile('schema.graphql', content);
    expect(result.types).toHaveLength(2);
    expect(result.types[0].name).toBe('Query');
    expect(result.types[0].kind).toBe('type');
    expect(result.types[1].name).toBe('Mutation');
    expect(result.types[1].kind).toBe('type');
  });

  it('returns empty array for non-GraphQL content', () => {
    const content = `This is just some text, not GraphQL at all.
Nothing to see here.`;
    const result = parseGraphqlFile('readme.graphql', content);
    expect(result.types).toHaveLength(0);
    expect(result.filePath).toBe('readme.graphql');
  });

  it('handles multi-line type bodies with nested field definitions', () => {
    const content = `type Booking {
  id: ID!
  guest: Guest!
  room: Room!
  checkIn: DateTime!
  checkOut: DateTime!
  status: BookingStatus!
  notes: String
  tags: [String!]!
}`;
    const result = parseGraphqlFile('schema.graphql', content);
    expect(result.types).toHaveLength(1);
    expect(result.types[0].body).toContain('id: ID!');
    expect(result.types[0].body).toContain('tags: [String!]!');
  });

  it('handles type with implements', () => {
    const content = `type Booking implements Node & Timestamped {
  id: ID!
  createdAt: DateTime!
}`;
    const result = parseGraphqlFile('schema.graphql', content);
    expect(result.types).toHaveLength(1);
    expect(result.types[0].name).toBe('Booking');
    expect(result.types[0].kind).toBe('type');
  });

  it('extracts multiple different definition kinds from one file', () => {
    const content = `scalar DateTime

type Query {
  booking(id: ID!): Booking
}

type Booking {
  id: ID!
  status: BookingStatus!
}

enum BookingStatus {
  PENDING
  CONFIRMED
}

input CreateBookingInput {
  date: String!
}`;
    const result = parseGraphqlFile('schema.graphql', content);
    // scalar=1, Query=1, Booking=1, enum=1, input=1 = 5
    expect(result.types).toHaveLength(5);
    const kinds = result.types.map(t => t.kind);
    expect(kinds).toContain('scalar');
    expect(kinds).toContain('type');
    expect(kinds).toContain('enum');
    expect(kinds).toContain('input');
  });

  it('preserves filePath in result', () => {
    const content = `type Foo { id: ID! }`;
    const result = parseGraphqlFile('schemas/booking/types.graphql', content);
    expect(result.filePath).toBe('schemas/booking/types.graphql');
  });
});

describe('extractGraphqlDefinitions (branch-aware)', () => {
  function setupGitGraphqlRepo(files: Record<string, string>): string {
    const repoDir = path.join(tmpDir, 'git-graphql-repo');
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

  it('filters for .graphql files from branch file list', () => {
    const repoDir = setupGitGraphqlRepo({
      'schemas/booking.graphql': 'type Booking { id: ID! }',
      'schemas/payment.graphql': 'type Payment { id: ID! }',
      'README.md': '# Hello',
      'src/app.ts': 'console.log("hi")',
    });

    const defs = extractGraphqlDefinitions(repoDir, 'main');
    expect(defs).toHaveLength(2);
  });

  it('returns empty when branch has no graphql files', () => {
    const repoDir = setupGitGraphqlRepo({
      'README.md': '# Hello',
    });

    const defs = extractGraphqlDefinitions(repoDir, 'main');
    expect(defs).toHaveLength(0);
  });

  it('skips graphql files with no type definitions', () => {
    const repoDir = setupGitGraphqlRepo({
      'schemas/empty.graphql': '# just a comment',
      'schemas/booking.graphql': 'type Booking { id: ID! }',
    });

    const defs = extractGraphqlDefinitions(repoDir, 'main');
    expect(defs).toHaveLength(1);
    expect(defs[0].types[0].name).toBe('Booking');
  });

  it('finds graphql files at any depth', () => {
    const repoDir = setupGitGraphqlRepo({
      'schema.graphql': 'type Root { id: ID! }',
      'deep/nested/path/types.graphql': 'type Nested { id: ID! }',
    });

    const defs = extractGraphqlDefinitions(repoDir, 'main');
    expect(defs).toHaveLength(2);
  });
});
