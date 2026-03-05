import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { extractProtoDefinitions, parseProtoFile } from '../../src/indexer/proto.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-proto-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseProtoFile', () => {
  it('extracts message name', () => {
    const content = `
syntax = "proto3";

message BookingCreated {
  string id = 1;
}
`;
    const result = parseProtoFile('booking.proto', content);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].name).toBe('BookingCreated');
  });

  it('extracts message fields', () => {
    const content = `
message BookingCreated {
  string booking_id = 1;
  int32 amount = 2;
  bool confirmed = 3;
}
`;
    const result = parseProtoFile('booking.proto', content);
    expect(result.messages[0].fields).toHaveLength(3);
    expect(result.messages[0].fields[0]).toEqual({ type: 'string', name: 'booking_id' });
    expect(result.messages[0].fields[1]).toEqual({ type: 'int32', name: 'amount' });
  });

  it('extracts package name', () => {
    const content = `
syntax = "proto3";
package booking.events;

message BookingCreated {
  string id = 1;
}
`;
    const result = parseProtoFile('booking.proto', content);
    expect(result.packageName).toBe('booking.events');
  });

  it('extracts service and rpc definitions', () => {
    const content = `
service BookingService {
  rpc CreateBooking(CreateBookingRequest) returns (CreateBookingResponse);
  rpc CancelBooking(CancelBookingRequest) returns (CancelBookingResponse);
}
`;
    const result = parseProtoFile('service.proto', content);
    expect(result.services).toHaveLength(1);
    expect(result.services[0].name).toBe('BookingService');
    expect(result.services[0].rpcs).toHaveLength(2);
    expect(result.services[0].rpcs[0]).toEqual({
      name: 'CreateBooking',
      inputType: 'CreateBookingRequest',
      outputType: 'CreateBookingResponse',
    });
  });

  it('handles repeated fields', () => {
    const content = `
message BookingList {
  repeated string tags = 1;
  repeated Booking items = 2;
}
`;
    const result = parseProtoFile('list.proto', content);
    expect(result.messages[0].fields).toHaveLength(2);
    expect(result.messages[0].fields[0]).toEqual({ type: 'string', name: 'tags' });
    expect(result.messages[0].fields[1]).toEqual({ type: 'Booking', name: 'items' });
  });

  it('handles multiple messages', () => {
    const content = `
message Request {
  string id = 1;
}

message Response {
  bool success = 1;
}
`;
    const result = parseProtoFile('multi.proto', content);
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].name).toBe('Request');
    expect(result.messages[1].name).toBe('Response');
  });

  it('handles empty proto file', () => {
    const content = `
syntax = "proto3";
package empty;
`;
    const result = parseProtoFile('empty.proto', content);
    expect(result.messages).toHaveLength(0);
    expect(result.services).toHaveLength(0);
    expect(result.packageName).toBe('empty');
  });

  it('handles null package', () => {
    const content = `message Msg { string f = 1; }`;
    const result = parseProtoFile('no-pkg.proto', content);
    expect(result.packageName).toBeNull();
  });
});

describe('extractProtoDefinitions', () => {
  it('finds proto files recursively', () => {
    const repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoDir, 'proto'), { recursive: true });
    fs.writeFileSync(
      path.join(repoDir, 'proto', 'booking.proto'),
      'message BookingCreated { string id = 1; }',
    );
    fs.writeFileSync(
      path.join(repoDir, 'proto', 'payment.proto'),
      'message PaymentProcessed { string id = 1; }',
    );

    const defs = extractProtoDefinitions(repoDir);
    expect(defs).toHaveLength(2);
  });

  it('returns empty when no proto files', () => {
    const repoDir = path.join(tmpDir, 'empty-repo');
    fs.mkdirSync(repoDir, { recursive: true });
    fs.writeFileSync(path.join(repoDir, 'README.md'), '# Hello');

    const defs = extractProtoDefinitions(repoDir);
    expect(defs).toHaveLength(0);
  });

  it('skips node_modules', () => {
    const repoDir = path.join(tmpDir, 'repo');
    fs.mkdirSync(path.join(repoDir, 'proto'), { recursive: true });
    fs.mkdirSync(path.join(repoDir, 'node_modules', 'pkg'), { recursive: true });

    fs.writeFileSync(
      path.join(repoDir, 'proto', 'real.proto'),
      'message Real { string id = 1; }',
    );
    fs.writeFileSync(
      path.join(repoDir, 'node_modules', 'pkg', 'vendored.proto'),
      'message Vendored { string id = 1; }',
    );

    const defs = extractProtoDefinitions(repoDir);
    expect(defs).toHaveLength(1);
    expect(defs[0].messages[0].name).toBe('Real');
  });
});
