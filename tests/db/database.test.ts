import { describe, it, expect, afterEach } from 'vitest';
import { openDatabase, closeDatabase } from '../../src/db/database.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

function tmpDbPath(name: string): string {
  return path.join(os.tmpdir(), `rkb-test-${name}-${Date.now()}.db`);
}

function cleanup(dbPath: string): void {
  try {
    fs.unlinkSync(dbPath);
    // Also clean WAL and SHM files
    fs.unlinkSync(dbPath + '-wal').catch?.(() => {});
    fs.unlinkSync(dbPath + '-shm').catch?.(() => {});
  } catch {
    // Ignore cleanup errors
  }
}

describe('openDatabase', () => {
  const dbPaths: string[] = [];

  afterEach(() => {
    for (const p of dbPaths) {
      cleanup(p);
    }
    dbPaths.length = 0;
  });

  it('creates database file at specified path', () => {
    const dbPath = tmpDbPath('create');
    dbPaths.push(dbPath);

    const db = openDatabase(dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);
    closeDatabase(db);
  });

  it('enables WAL mode', () => {
    const dbPath = tmpDbPath('wal');
    dbPaths.push(dbPath);

    const db = openDatabase(dbPath);
    const mode = db.pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');
    closeDatabase(db);
  });

  it('enables foreign keys', () => {
    const dbPath = tmpDbPath('fk');
    dbPaths.push(dbPath);

    const db = openDatabase(dbPath);
    const fk = db.pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
    closeDatabase(db);
  });

  it('database persists across open/close', () => {
    const dbPath = tmpDbPath('persist');
    dbPaths.push(dbPath);

    // Open, insert data, close
    const db1 = openDatabase(dbPath);
    db1.prepare(
      "INSERT INTO repos (name, path, description) VALUES ('test-repo', '/tmp/test', 'A test')",
    ).run();
    closeDatabase(db1);

    // Reopen, verify data persists
    const db2 = openDatabase(dbPath);
    const row = db2.prepare('SELECT name, path FROM repos WHERE name = ?').get('test-repo') as {
      name: string;
      path: string;
    };
    expect(row).toBeDefined();
    expect(row.name).toBe('test-repo');
    expect(row.path).toBe('/tmp/test');
    closeDatabase(db2);
  });

  it('creates parent directories', () => {
    const dbPath = path.join(
      os.tmpdir(),
      `rkb-test-nested-${Date.now()}`,
      'deep',
      'dir',
      'test.db',
    );
    dbPaths.push(dbPath);

    const db = openDatabase(dbPath);
    expect(fs.existsSync(dbPath)).toBe(true);
    closeDatabase(db);

    // Clean up nested dirs
    fs.rmSync(path.join(os.tmpdir(), `rkb-test-nested-${Date.now()}`), {
      recursive: true,
      force: true,
    });
  });
});
