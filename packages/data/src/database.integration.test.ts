// The in-memory cases sit in the integration suite on purpose, beside the
// cases on a file: openDatabase takes ':memory:' or a path, and neither kind
// of case alone reaches the coverage floor in database.ts, so this suite
// answers for that file and the unit suite does not (vitest.config.ts).
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, Database as TursoDatabase } from '@tursodatabase/database';
import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDatabase, type Database } from './database';

let dir: string;
const opened: Database[] = [];

async function open(path: string) {
  const database = await openDatabase(path);
  opened.push(database);
  return database;
}

function mode(path: string) {
  return statSync(path).mode & 0o777;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-data-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of opened.splice(0)) await database.close();
  rmSync(dir, { recursive: true, force: true });
});

test('openDatabase in memory opens a database the drizzle handle queries', async () => {
  const { db } = await open(':memory:');
  expect(await db.get(sql`select 1 as one`)).toEqual({ one: 1 });
});

test('openDatabase in memory answers ping while open', async () => {
  expect(await (await open(':memory:')).ping()).toBe(true);
});

test('openDatabase in memory answers ping with false once closed, without throwing', async () => {
  const database = await open(':memory:');
  await database.close();
  await expect(database.ping()).resolves.toBe(false);
});

test('openDatabase in memory closes twice without throwing', async () => {
  const database = await open(':memory:');
  await database.close();
  await expect(database.close()).resolves.toBeUndefined();
});

test('openDatabase in memory applies the migrations, whose table is the only one so far', async () => {
  const { db } = await open(':memory:');
  expect(
    await db.all(sql`select name from sqlite_schema where type = 'table'`),
  ).toEqual([{ name: 'migration' }]);
});

// File modes mean nothing on Windows, where the profile's permissions apply.
test.skipIf(process.platform === 'win32')(
  'openDatabase on a file creates a missing folder for its owner only, and the file too',
  async () => {
    const path = join(dir, 'missing', 'sextou.db');
    await open(path);
    expect(mode(join(dir, 'missing'))).toBe(0o700);
    expect(mode(path)).toBe(0o600);
  },
);

test.skipIf(process.platform === 'win32')(
  'openDatabase on a file runs in WAL mode, synced in full, with foreign keys and a WAL file for the owner only',
  async () => {
    const path = join(dir, 'sextou.db');
    const { db } = await open(path);
    await db.run(sql`create table t (x)`);
    expect(await db.get(sql`pragma journal_mode`)).toEqual({
      journal_mode: 'wal',
    });
    expect(await db.get(sql`pragma synchronous`)).toEqual({ synchronous: 2 });
    expect(await db.get(sql`pragma foreign_keys`)).toEqual({
      foreign_keys: 1,
    });
    expect(mode(`${path}-wal`)).toBe(0o600);
  },
);

// Turso keeps the WAL file after closing, with whatever mode it had.
test.skipIf(process.platform === 'win32')(
  'openDatabase on a file makes an existing file and its WAL file owner-only',
  async () => {
    const path = join(dir, 'sextou.db');
    const other = await connect(path);
    await other.exec('create table t (x)');
    await other.close();
    for (const file of [path, `${path}-wal`]) chmodSync(file, 0o644);
    await open(path);
    expect(mode(path)).toBe(0o600);
    expect(mode(`${path}-wal`)).toBe(0o600);
  },
);

test.skipIf(process.platform === 'win32')(
  'openDatabase on a file throws when the folder is a regular file',
  async () => {
    writeFileSync(join(dir, 'file'), '');
    await expect(open(join(dir, 'file', 'sextou.db'))).rejects.toThrow();
  },
);

test.skipIf(process.platform === 'win32')(
  'openDatabase on a file throws on a file that is not a database',
  async () => {
    const path = join(dir, 'notes.db');
    writeFileSync(path, 'not a database, just some text that is long enough');
    await expect(open(path)).rejects.toThrow('File is not a database');
  },
);

// The WAL file exists either way, so the content shows the file unchanged.
test.skipIf(process.platform === 'win32')(
  'openDatabase on a file throws and closes on a database a newer sextou migrated, leaving it as it was',
  async () => {
    const path = join(dir, 'sextou.db');
    const other = await connect(path);
    await other.exec(
      "create table migration (id text primary key, time_completed integer not null); insert into migration values ('99_newer', 0)",
    );
    await other.close();
    const bytes = readFileSync(path);
    const close = vi.spyOn(TursoDatabase.prototype, 'close');

    await expect(open(path)).rejects.toThrow(
      'This database was written by a newer sextou (unknown migration 99_newer)',
    );
    expect(close).toHaveBeenCalledOnce();

    expect(readFileSync(path)).toEqual(bytes);
    const reader = await connect(path);
    try {
      expect(await reader.all('select * from migration')).toEqual([
        { id: '99_newer', time_completed: 0 },
      ]);
    } finally {
      await reader.close();
    }
  },
);
