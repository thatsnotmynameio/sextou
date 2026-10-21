import { connect, type Database } from '@tursodatabase/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from './migration';

const first = { id: '1_first', statements: ['CREATE TABLE a (x)'] };
const second = {
  id: '2_second',
  statements: ['CREATE TABLE b (x)', 'CREATE INDEX b_x ON b (x)'],
};
const broken = { id: '2_broken', statements: ['CREATE TABLE c (x', 'nope'] };

let client: Database;

async function tables() {
  const rows = await client.all(
    "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
  );
  return rows.map((row: { name: string }) => row.name);
}

async function applied() {
  const rows = await client.all('SELECT id FROM migration ORDER BY id');
  return rows.map((row: { id: string }) => row.id);
}

beforeEach(async () => {
  client = await connect(':memory:');
});

afterEach(async () => {
  await client.close();
});

describe('migrateDatabase', () => {
  it('applies every migration to a new database', async () => {
    expect(await migrateDatabase(client, [first, second])).toEqual([
      '1_first',
      '2_second',
    ]);
    expect(await tables()).toEqual(['a', 'b', 'migration']);
    expect(await applied()).toEqual(['1_first', '2_second']);
  });

  it('applies nothing to a current database', async () => {
    await migrateDatabase(client, [first, second]);
    expect(await migrateDatabase(client, [first, second])).toEqual([]);
    expect(await applied()).toEqual(['1_first', '2_second']);
  });

  it('applies only the pending migrations', async () => {
    await migrateDatabase(client, [first]);
    expect(await migrateDatabase(client, [first, second])).toEqual([
      '2_second',
    ]);
    expect(await tables()).toEqual(['a', 'b', 'migration']);
  });

  it('applies none when one fails, and names it', async () => {
    await expect(migrateDatabase(client, [first, broken])).rejects.toThrow(
      /^Migration 2_broken failed: /,
    );
    expect(await tables()).toEqual([]);
  });

  it('keeps what earlier starts applied when a later migration fails', async () => {
    await migrateDatabase(client, [first]);
    await client.exec('INSERT INTO a VALUES (1)');
    await expect(
      migrateDatabase(client, [first, second, broken]),
    ).rejects.toThrow('Migration 2_broken failed');
    expect(await tables()).toEqual(['a', 'migration']);
    expect(await applied()).toEqual(['1_first']);
    expect(await client.all('SELECT x FROM a')).toEqual([{ x: 1 }]);
  });

  it('refuses a database a newer sextou migrated, and leaves it as it was', async () => {
    await migrateDatabase(client, [first, second]);
    await expect(migrateDatabase(client, [first])).rejects.toThrow(
      'This database was written by a newer sextou (unknown migration 2_second)',
    );
    expect(await tables()).toEqual(['a', 'b', 'migration']);
    expect(await applied()).toEqual(['1_first', '2_second']);
  });

  it('creates only its own table when there is no migration', async () => {
    expect(await migrateDatabase(client, [])).toEqual([]);
    expect(await tables()).toEqual(['migration']);
  });
});
