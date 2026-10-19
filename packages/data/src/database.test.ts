import {
  chmodSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type Database } from './database';

let dir: string;
const opened: Database[] = [];

function open(path: string) {
  const database = openDatabase(path);
  opened.push(database);
  return database;
}

function mode(path: string) {
  return statSync(path).mode & 0o777;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-data-'));
});

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('openDatabase in memory', () => {
  it('opens a database the drizzle handle queries', () => {
    const { db } = open(':memory:');
    expect(db.get(sql`select 1 as one`)).toEqual({ one: 1 });
  });

  it('answers ping while open', () => {
    expect(open(':memory:').ping()).toBe(true);
  });

  it('answers ping with false once closed, without throwing', () => {
    const database = open(':memory:');
    database.close();
    expect(database.ping()).toBe(false);
  });

  it('closes twice without throwing', () => {
    const database = open(':memory:');
    database.close();
    expect(() => database.close()).not.toThrow();
  });

  it('applies the migrations, whose table is the only one so far', () => {
    const { db } = open(':memory:');
    expect(
      db.all(sql`select name from sqlite_schema where type = 'table'`),
    ).toEqual([{ name: 'migration' }]);
  });
});

// File modes mean nothing on Windows, where the profile's permissions apply.
describe.skipIf(process.platform === 'win32')('openDatabase on a file', () => {
  it('creates a missing folder for its owner only, and the file too', () => {
    const path = join(dir, 'missing', 'sextou.db');
    open(path);
    expect(mode(join(dir, 'missing'))).toBe(0o700);
    expect(mode(path)).toBe(0o600);
  });

  it('runs in WAL mode, with sidecars for the owner only', () => {
    const path = join(dir, 'sextou.db');
    const { db } = open(path);
    db.run(sql`create table t (x)`);
    expect(db.get(sql`pragma journal_mode`)).toEqual({ journal_mode: 'wal' });
    expect(mode(`${path}-wal`)).toBe(0o600);
    expect(mode(`${path}-shm`)).toBe(0o600);
  });

  // A crash leaves the sidecars behind, with whatever mode they had.
  it('makes an existing file and its sidecars owner-only', () => {
    const path = join(dir, 'sextou.db');
    const other = new DatabaseSync(path);
    other.exec('PRAGMA journal_mode = WAL; create table t (x)');
    for (const file of [path, `${path}-wal`, `${path}-shm`]) {
      chmodSync(file, 0o644);
    }
    try {
      open(path);
      expect(mode(path)).toBe(0o600);
      expect(mode(`${path}-wal`)).toBe(0o600);
      expect(mode(`${path}-shm`)).toBe(0o600);
    } finally {
      other.close();
    }
  });

  it('throws when the folder is a regular file', () => {
    writeFileSync(join(dir, 'file'), '');
    expect(() => open(join(dir, 'file', 'sextou.db'))).toThrow();
  });

  // SQLite opens such a file without complaint and fails on the first
  // statement: openDatabase runs one, so the caller sees the failure.
  it('throws on a file that is not a database', () => {
    const path = join(dir, 'notes.db');
    writeFileSync(path, 'not a database, just some text that is long enough');
    expect(() => open(path)).toThrow('file is not a database');
  });

  // SQLite deletes the WAL file when the last connection closes.
  it('throws and closes on a database a newer sextou migrated', () => {
    const path = join(dir, 'sextou.db');
    const other = new DatabaseSync(path);
    other.exec(
      "create table migration (id text primary key, time_completed integer not null); insert into migration values ('99_newer', 0)",
    );
    other.close();
    expect(() => open(path)).toThrow(
      'This database was written by a newer sextou (unknown migration 99_newer)',
    );
    expect(existsSync(`${path}-wal`)).toBe(false);
  });
});
