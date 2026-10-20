import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, steps } from './migrations';

const first = 'CREATE TABLE a (x)';
const second = 'CREATE TABLE b (x); CREATE INDEX b_x ON b (x)';
const broken = 'CREATE TABLE c (x); nope';

let client: DatabaseSync;

function tables() {
  return client
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

function version() {
  return client.prepare('PRAGMA user_version').get()?.user_version;
}

beforeEach(() => {
  client = new DatabaseSync(':memory:');
});

afterEach(() => {
  client.close();
});

describe('migrate', () => {
  it('applies every step to a new database and records their count', () => {
    migrate(client, [first, second]);
    expect(tables()).toEqual(['a', 'b']);
    expect(version()).toBe(2);
  });

  it('applies nothing to a current database', () => {
    migrate(client, [first, second]);
    client.exec('INSERT INTO a VALUES (1)');
    migrate(client, [first, second]);
    expect(version()).toBe(2);
    expect(client.prepare('SELECT x FROM a').all()).toEqual([{ x: 1 }]);
  });

  it('applies only the steps the database lacks', () => {
    migrate(client, [first]);
    migrate(client, [first, second]);
    expect(tables()).toEqual(['a', 'b']);
    expect(version()).toBe(2);
  });

  it('applies none when one fails, and names it', () => {
    migrate(client, [first]);
    expect(() => migrate(client, [first, second, broken])).toThrow(
      /^Tasks migration 3 failed: /,
    );
    expect(tables()).toEqual(['a']);
    expect(version()).toBe(1);
  });

  it('refuses a database a newer version migrated, and leaves it as it was', () => {
    migrate(client, [first, second]);
    expect(() => migrate(client, [first])).toThrow(
      'This tasks database was written by a newer version (schema 2, this one knows 1)',
    );
    expect(tables()).toEqual(['a', 'b']);
    expect(version()).toBe(2);
  });
});

describe('the shipped steps', () => {
  it('create the task and link tables', () => {
    migrate(client, steps);
    expect(tables()).toEqual(['link', 'task']);
    expect(version()).toBe(steps.length);
  });
});
