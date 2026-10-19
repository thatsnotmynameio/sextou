import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateDatabase } from './migration';

const first = { id: '1_first', statements: ['CREATE TABLE a (x)'] };
const second = {
  id: '2_second',
  statements: ['CREATE TABLE b (x)', 'CREATE INDEX b_x ON b (x)'],
};
const broken = { id: '2_broken', statements: ['CREATE TABLE c (x', 'nope'] };

let client: DatabaseSync;

function tables() {
  return client
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

function applied() {
  return client
    .prepare('SELECT id FROM migration ORDER BY id')
    .all()
    .map((row) => row.id);
}

beforeEach(() => {
  client = new DatabaseSync(':memory:');
});

afterEach(() => {
  client.close();
});

describe('migrateDatabase', () => {
  it('applies every migration to a new database', () => {
    expect(migrateDatabase(client, [first, second])).toEqual([
      '1_first',
      '2_second',
    ]);
    expect(tables()).toEqual(['a', 'b', 'migration']);
    expect(applied()).toEqual(['1_first', '2_second']);
  });

  it('applies nothing to a current database', () => {
    migrateDatabase(client, [first, second]);
    expect(migrateDatabase(client, [first, second])).toEqual([]);
    expect(applied()).toEqual(['1_first', '2_second']);
  });

  it('applies only the pending migrations', () => {
    migrateDatabase(client, [first]);
    expect(migrateDatabase(client, [first, second])).toEqual(['2_second']);
    expect(tables()).toEqual(['a', 'b', 'migration']);
  });

  it('applies none when one fails, and names it', () => {
    expect(() => migrateDatabase(client, [first, broken])).toThrow(
      /^Migration 2_broken failed: /,
    );
    expect(tables()).toEqual([]);
  });

  it('keeps what earlier starts applied when a later migration fails', () => {
    migrateDatabase(client, [first]);
    client.exec('INSERT INTO a VALUES (1)');
    expect(() => migrateDatabase(client, [first, second, broken])).toThrow(
      'Migration 2_broken failed',
    );
    expect(tables()).toEqual(['a', 'migration']);
    expect(applied()).toEqual(['1_first']);
    expect(client.prepare('SELECT x FROM a').all()).toEqual([{ x: 1 }]);
  });

  it('refuses a database a newer sextou migrated, and leaves it as it was', () => {
    migrateDatabase(client, [first, second]);
    expect(() => migrateDatabase(client, [first])).toThrow(
      'This database was written by a newer sextou (unknown migration 2_second)',
    );
    expect(tables()).toEqual(['a', 'b', 'migration']);
    expect(applied()).toEqual(['1_first', '2_second']);
  });

  it('creates only its own table when there is no migration', () => {
    expect(migrateDatabase(client, [])).toEqual([]);
    expect(tables()).toEqual(['migration']);
  });
});
