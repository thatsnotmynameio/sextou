import { connect, type Database } from '@tursodatabase/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, steps } from './migrations';

const first = 'CREATE TABLE a (x)';
const second = 'CREATE TABLE b (x); CREATE INDEX b_x ON b (x)';
const broken = 'CREATE TABLE c (x); nope';

let client: Database;

async function tables() {
  const rows = await client.all(
    "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
  );
  return rows.map((row) => row.name);
}

async function version() {
  return (await client.get('PRAGMA user_version'))?.user_version;
}

beforeEach(async () => {
  client = await connect(':memory:');
});

afterEach(async () => {
  await client.close();
});

describe('migrate', () => {
  it('applies every step to a new database and records their count', async () => {
    await migrate(client, [first, second]);
    expect(await tables()).toEqual(['a', 'b']);
    expect(await version()).toBe(2);
  });

  it('applies nothing to a current database', async () => {
    await migrate(client, [first, second]);
    await client.exec('INSERT INTO a VALUES (1)');
    await migrate(client, [first, second]);
    expect(await version()).toBe(2);
    expect(await client.all('SELECT x FROM a')).toEqual([{ x: 1 }]);
  });

  it('applies only the steps the database lacks', async () => {
    await migrate(client, [first]);
    await migrate(client, [first, second]);
    expect(await tables()).toEqual(['a', 'b']);
    expect(await version()).toBe(2);
  });

  it('applies none when one fails, and names it', async () => {
    await migrate(client, [first]);
    await expect(migrate(client, [first, second, broken])).rejects.toThrow(
      /^Tasks migration 3 failed: /,
    );
    expect(await tables()).toEqual(['a']);
    expect(await version()).toBe(1);
  });

  it('refuses a database a newer version migrated, and leaves it as it was', async () => {
    await migrate(client, [first, second]);
    await expect(migrate(client, [first])).rejects.toThrow(
      'This tasks database was written by a newer version (schema 2, this one knows 1)',
    );
    expect(await tables()).toEqual(['a', 'b']);
    expect(await version()).toBe(2);
  });
});

describe('the shipped steps', () => {
  it('create the task, link, status change and execution tables', async () => {
    await migrate(client, steps);
    expect(await tables()).toEqual([
      'execution',
      'link',
      'status_change',
      'task',
    ]);
    expect(await version()).toBe(steps.length);
  });

  it('require an assignee on a task and leave its description and source path optional', async () => {
    await migrate(client, steps);
    expect(
      await client.all(
        "SELECT name, \"notnull\" FROM pragma_table_info('task') WHERE name IN ('assignee', 'description', 'source_path') ORDER BY name",
      ),
    ).toEqual([
      { name: 'assignee', notnull: 1 },
      { name: 'description', notnull: 0 },
      { name: 'source_path', notnull: 0 },
    ]);
  });

  it('let a link be refused twice, deleted, and refused for a missing blocker', async () => {
    await migrate(client, steps);
    await client.exec('PRAGMA foreign_keys = ON');
    await client.exec(
      "INSERT INTO task (id, title, kind, priority, assignee, status) VALUES ('a', 'A', 'task', 2, 'dev', 'open'), ('b', 'B', 'task', 2, 'dev', 'open')",
    );
    await client.run("INSERT INTO link VALUES ('a', 'b')");
    await expect(
      client.run("INSERT INTO link VALUES ('a', 'b')"),
    ).rejects.toThrow('UNIQUE constraint failed');
    await expect(
      client.run("INSERT INTO link VALUES ('a', 'missing')"),
    ).rejects.toThrow('FOREIGN KEY constraint failed');
    expect(
      await client.run(
        "DELETE FROM link WHERE task_id = 'a' AND blocker_id = 'b'",
      ),
    ).toMatchObject({ changes: 1 });
  });

  it("let an execution's result path be updated", async () => {
    await migrate(client, steps);
    await client.exec(
      "INSERT INTO task (id, title, kind, priority, assignee, status) VALUES ('a', 'A', 'task', 2, 'dev', 'running'); INSERT INTO execution (task_id, actor) VALUES ('a', 'bot')",
    );
    await client.run(
      "UPDATE execution SET result_path = 'out' WHERE task_id = 'a'",
    );
    expect(await client.all('SELECT * FROM execution')).toEqual([
      { task_id: 'a', actor: 'bot', log_path: null, result_path: 'out' },
    ]);
  });
});
