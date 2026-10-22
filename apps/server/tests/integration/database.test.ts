// database.ts takes ':memory:' or a path, and neither kind of case alone
// reaches the floor, so its in-memory cases sit here beside the cases on a
// file, and no unit test answers for it.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createDatabase, type Database } from '../../src/database';

let dir: string;
const opened: Database[] = [];

function create(path: string) {
  const database = createDatabase(path, 1000);
  opened.push(database);
  return database;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-database-'));
});

afterEach(async () => {
  await Promise.all(opened.splice(0).map((database) => database.close()));
  rmSync(dir, { recursive: true, force: true });
});

test('ping answers true for an in-memory database', async () => {
  expect(await create(':memory:').ping()).toBe(true);
});

test('ping answers true for a file, which it creates', async () => {
  const path = join(dir, 'sextou.db');

  const answer = await create(path).ping();

  expect(answer).toBe(true);
  expect(existsSync(path)).toBe(true);
});

test('createDatabase opens nothing until the first query', () => {
  const path = join(dir, 'sextou.db');

  create(path);

  expect(existsSync(path)).toBe(false);
});

test('ping answers false, without rejecting, for a path in a missing folder', async () => {
  expect(await create(join(dir, 'missing', 'sextou.db')).ping()).toBe(false);
});

test('ping answers false once the database is closed', async () => {
  const database = createDatabase(':memory:', 1000);
  await database.ping();

  await database.close();

  expect(await database.ping()).toBe(false);
});
