import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import { parseFrontmatter, catalogIdToMatchers, enrichFromEventCatalog } from '../../src/indexer/catalog.js';
import type Database from 'better-sqlite3';

let db: Database.Database;
let dbPath: string;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rkb-catalog-test-'));
  dbPath = path.join(tmpDir, 'test.db');
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseFrontmatter', () => {
  it('extracts scalar key-value pairs', () => {
    const content = `---
id: 'event:payment-failed'
name: Payment Failed
version: 1.0.0
summary: An event for Payment Failed
---
## Overview
`;
    const result = parseFrontmatter(content);
    expect(result.id).toBe('event:payment-failed');
    expect(result.name).toBe('Payment Failed');
    expect(result.version).toBe('1.0.0');
    expect(result.summary).toBe('An event for Payment Failed');
  });

  it('handles quoted and unquoted values', () => {
    const content = `---
id: 'event:test'
name: "Test Event"
version: 1.0.0
---
`;
    const result = parseFrontmatter(content);
    expect(result.id).toBe('event:test');
    expect(result.name).toBe('Test Event');
  });

  it('extracts array items', () => {
    const content = `---
owners:
  - team-xd
  - team-payments
channels:
  - id: 'channel:payments'
---
`;
    const result = parseFrontmatter(content);
    expect(result.owners).toEqual(['team-xd', 'team-payments']);
  });

  it('handles empty content gracefully', () => {
    const result = parseFrontmatter('no frontmatter here');
    expect(result).toEqual({});
  });

  it('handles array items with quoted values', () => {
    const content = `---
owners:
  - 'team-pierogi'
  - "team-orion"
---
`;
    const result = parseFrontmatter(content);
    expect(result.owners).toEqual(['team-pierogi', 'team-orion']);
  });
});

describe('catalogIdToMatchers', () => {
  it('converts event:payment-failed to CamelCase and snake_case', () => {
    const result = catalogIdToMatchers('event:payment-failed');
    expect(result.camelCase).toBe('PaymentFailed');
    expect(result.snakeCase).toBe('payment_failed');
  });

  it('converts event:appointment-customer-changed', () => {
    const result = catalogIdToMatchers('event:appointment-customer-changed');
    expect(result.camelCase).toBe('AppointmentCustomerChanged');
    expect(result.snakeCase).toBe('appointment_customer_changed');
  });

  it('handles single-word event IDs', () => {
    const result = catalogIdToMatchers('event:created');
    expect(result.camelCase).toBe('Created');
    expect(result.snakeCase).toBe('created');
  });

  it('strips event: prefix', () => {
    const result = catalogIdToMatchers('event:test');
    expect(result.camelCase).toBe('Test');
    expect(result.snakeCase).toBe('test');
  });
});

describe('enrichFromEventCatalog', () => {
  /**
   * Helper: create a mock event catalog directory structure
   */
  function createMockCatalog(
    rootDir: string,
    events: { id: string; name: string; owners: string[] }[],
    services: { id: string; sends: string[] }[],
    domains: { id: string; name: string; services: string[] }[],
  ): void {
    const catalogDir = path.join(rootDir, 'fresha-event-catalog', 'src');

    // Create event MDX files
    for (const evt of events) {
      const evtDir = path.join(catalogDir, 'events', evt.id);
      fs.mkdirSync(evtDir, { recursive: true });
      const ownerLines = evt.owners.map(o => `  - ${o}`).join('\n');
      fs.writeFileSync(path.join(evtDir, 'index.mdx'), `---
id: '${evt.id}'
name: ${evt.name}
version: 1.0.0
summary: An event for ${evt.name}
owners:
${ownerLines}
---
## Overview
`);
    }

    // Create service MDX files
    for (const svc of services) {
      const svcDir = path.join(catalogDir, 'services', svc.id);
      fs.mkdirSync(svcDir, { recursive: true });
      const sendsLines = svc.sends.map(s => `  - id: '${s}'`).join('\n');
      fs.writeFileSync(path.join(svcDir, 'index.mdx'), `---
id: '${svc.id}'
name: ${svc.id.replace('s:', '')}
version: 0.0.1
summary: A service
sends:
${sendsLines}
---
`);
    }

    // Create domain MDX files
    for (const dom of domains) {
      const domDir = path.join(catalogDir, 'domains', dom.id);
      fs.mkdirSync(domDir, { recursive: true });
      const svcLines = dom.services.map(s => `  - id: '${s}'`).join('\n');
      fs.writeFileSync(path.join(domDir, 'index.mdx'), `---
id: '${dom.id}'
name: ${dom.name}
version: 0.0.1
services:
${svcLines}
---
`);
    }
  }

  /**
   * Helper: insert test events into the database
   */
  function insertTestEvent(name: string, sourceFile: string): number {
    // Ensure a repo exists
    let repoRow = db.prepare("SELECT id FROM repos WHERE name = 'test-repo'").get() as { id: number } | undefined;
    if (!repoRow) {
      db.prepare("INSERT INTO repos (name, path, description) VALUES ('test-repo', '/tmp/test', 'test')").run();
      repoRow = db.prepare("SELECT id FROM repos WHERE name = 'test-repo'").get() as { id: number };
    }

    const result = db.prepare(
      'INSERT INTO events (repo_id, name, schema_definition, source_file) VALUES (?, ?, ?, ?)',
    ).run(repoRow.id, name, `message ${name} {}`, sourceFile);
    return Number(result.lastInsertRowid);
  }

  it('updates events.owner_team for matching events', () => {
    // Insert a test event that matches by name
    insertTestEvent('PaymentFailed', 'proto/payment_failed/v1/payload.proto');

    createMockCatalog(
      tmpDir,
      [{ id: 'event:payment-failed', name: 'Payment Failed', owners: ['team-xd'] }],
      [{ id: 's:payments', sends: ['event:payment-failed'] }],
      [{ id: 'd:payments', name: 'Payments', services: ['s:payments'] }],
    );

    const result = enrichFromEventCatalog(db, tmpDir);
    expect(result.matched).toBeGreaterThan(0);

    const event = db.prepare("SELECT owner_team FROM events WHERE name = 'PaymentFailed'").get() as { owner_team: string | null };
    expect(event.owner_team).toBe('team-xd');
  });

  it('updates events.domain by traversing domain->service->event chain', () => {
    insertTestEvent('PaymentFailed', 'proto/payment_failed/v1/payload.proto');

    createMockCatalog(
      tmpDir,
      [{ id: 'event:payment-failed', name: 'Payment Failed', owners: ['team-xd'] }],
      [{ id: 's:payments', sends: ['event:payment-failed'] }],
      [{ id: 'd:payments', name: 'Payments', services: ['s:payments'] }],
    );

    enrichFromEventCatalog(db, tmpDir);

    const event = db.prepare("SELECT domain FROM events WHERE name = 'PaymentFailed'").get() as { domain: string | null };
    expect(event.domain).toBe('Payments');
  });

  it('matches Payload events by source_file path containing snake_case event ID', () => {
    // Insert an event named Payload with path containing the snake_case ID
    insertTestEvent('Payload', 'proto/appointment_customer_changed/v1/payload.proto');

    createMockCatalog(
      tmpDir,
      [{ id: 'event:appointment-customer-changed', name: 'Appointment Customer Changed', owners: ['team-kraken'] }],
      [{ id: 's:appointments', sends: ['event:appointment-customer-changed'] }],
      [{ id: 'd:appointments', name: 'Appointments', services: ['s:appointments'] }],
    );

    const result = enrichFromEventCatalog(db, tmpDir);
    expect(result.matched).toBeGreaterThan(0);

    const event = db.prepare("SELECT owner_team, domain FROM events WHERE name = 'Payload' AND source_file LIKE '%appointment_customer_changed%'").get() as { owner_team: string | null; domain: string | null };
    expect(event.owner_team).toBe('team-kraken');
    expect(event.domain).toBe('Appointments');
  });

  it('silently skips non-matching catalog events', () => {
    // No events in the DB -- catalog has events but none match
    createMockCatalog(
      tmpDir,
      [{ id: 'event:nonexistent-event', name: 'Nonexistent Event', owners: ['team-x'] }],
      [],
      [],
    );

    const result = enrichFromEventCatalog(db, tmpDir);
    expect(result.skipped).toBeGreaterThan(0);
    expect(result.matched).toBe(0);
  });

  it('is idempotent (running twice produces same result)', () => {
    insertTestEvent('PaymentFailed', 'proto/payment_failed/v1/payload.proto');

    createMockCatalog(
      tmpDir,
      [{ id: 'event:payment-failed', name: 'Payment Failed', owners: ['team-xd'] }],
      [{ id: 's:payments', sends: ['event:payment-failed'] }],
      [{ id: 'd:payments', name: 'Payments', services: ['s:payments'] }],
    );

    // Run enrichment twice
    const result1 = enrichFromEventCatalog(db, tmpDir);
    const result2 = enrichFromEventCatalog(db, tmpDir);

    expect(result1.matched).toBe(result2.matched);

    // Verify only the correct values are set (not duplicated or corrupted)
    const event = db.prepare("SELECT owner_team, domain FROM events WHERE name = 'PaymentFailed'").get() as { owner_team: string | null; domain: string | null };
    expect(event.owner_team).toBe('team-xd');
    expect(event.domain).toBe('Payments');
  });

  it('returns zeros when no event catalog directory exists', () => {
    const result = enrichFromEventCatalog(db, tmpDir);
    expect(result.matched).toBe(0);
    expect(result.skipped).toBe(0);
  });
});
