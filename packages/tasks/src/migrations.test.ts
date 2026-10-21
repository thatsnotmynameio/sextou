import { connect, type Database } from '@tursodatabase/database';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { migrate, steps } from './migrations';
import { Status } from './status';

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

test('migrate applies every step to a new database and records their count', async () => {
  await migrate(client, [first, second]);
  expect(await tables()).toEqual(['a', 'b']);
  expect(await version()).toBe(2);
});

test('migrate applies nothing to a current database', async () => {
  await migrate(client, [first, second]);
  await client.exec('INSERT INTO a VALUES (1)');
  await migrate(client, [first, second]);
  expect(await version()).toBe(2);
  expect(await client.all('SELECT x FROM a')).toEqual([{ x: 1 }]);
});

test('migrate applies only the steps the database lacks', async () => {
  await migrate(client, [first]);
  await migrate(client, [first, second]);
  expect(await tables()).toEqual(['a', 'b']);
  expect(await version()).toBe(2);
});

test('migrate applies none when one fails, and names it', async () => {
  await migrate(client, [first]);
  await expect(migrate(client, [first, second, broken])).rejects.toThrow(
    /^Tasks migration 3 failed: /,
  );
  expect(await tables()).toEqual(['a']);
  expect(await version()).toBe(1);
});

test('migrate refuses a database a newer version migrated, and leaves it as it was', async () => {
  await migrate(client, [first, second]);
  await expect(migrate(client, [first])).rejects.toThrow(
    'This tasks database was written by a newer version (schema 2, this one knows 1)',
  );
  expect(await tables()).toEqual(['a', 'b']);
  expect(await version()).toBe(2);
});

test('the shipped steps create the tasks, task links, task status changes and task executions tables', async () => {
  await migrate(client, steps);
  expect(await tables()).toEqual([
    'task_executions',
    'task_links',
    'task_status_changes',
    'tasks',
  ]);
  expect(await version()).toBe(steps.length);
});

test('the shipped steps require an assignee on a task and leave its description and source path optional', async () => {
  await migrate(client, steps);
  expect(
    await client.all(
      "SELECT name, \"notnull\" FROM pragma_table_info('tasks') WHERE name IN ('assignee', 'description', 'source_path') ORDER BY name",
    ),
  ).toEqual([
    { name: 'assignee', notnull: 1 },
    { name: 'description', notnull: 0 },
    { name: 'source_path', notnull: 0 },
  ]);
});

test('the shipped steps let a link be refused twice, deleted, and refused for a missing blocker', async () => {
  await migrate(client, steps);
  await client.exec('PRAGMA foreign_keys = ON');
  await client.exec(
    "INSERT INTO tasks (id, title, kind, priority, assignee, status) VALUES ('a', 'A', 'task', 2, 'dev', 'open'), ('b', 'B', 'task', 2, 'dev', 'open')",
  );
  await client.run("INSERT INTO task_links VALUES ('a', 'b')");
  await expect(
    client.run("INSERT INTO task_links VALUES ('a', 'b')"),
  ).rejects.toThrow('UNIQUE constraint failed');
  await expect(
    client.run("INSERT INTO task_links VALUES ('a', 'missing')"),
  ).rejects.toThrow('FOREIGN KEY constraint failed');
  expect(
    await client.run(
      "DELETE FROM task_links WHERE task_id = 'a' AND blocker_id = 'b'",
    ),
  ).toMatchObject({ changes: 1 });
});

test("the shipped steps let an execution's result path be updated", async () => {
  await migrate(client, steps);
  await client.exec(
    "INSERT INTO tasks (id, title, kind, priority, assignee, status) VALUES ('a', 'A', 'task', 2, 'dev', 'running'); INSERT INTO task_executions (task_id, actor) VALUES ('a', 'bot')",
  );
  await client.run(
    "UPDATE task_executions SET result_path = 'out' WHERE task_id = 'a'",
  );
  expect(await client.all('SELECT * FROM task_executions')).toEqual([
    { task_id: 'a', actor: 'bot', log_path: null, result_path: 'out' },
  ]);
});

// A name that is not one of the states.
const unknown = 'closed';

function insertTask(id: string, status: string) {
  return client.run(
    "INSERT INTO tasks (id, title, kind, priority, assignee, status) VALUES (?, 'T', 'step', 0, 'bot', ?)",
    id,
    status,
  );
}

function insertChange(from: string | null, to: string) {
  return client.run(
    "INSERT INTO task_status_changes (task_id, from_status, to_status, changed_by, time_changed) VALUES ('tsk_a', ?, ?, 'bot', 0)",
    from,
    to,
  );
}

test.each(Object.values(Status))(
  'the status checks accept %s on a task and on both sides of a change',
  async (status) => {
    await migrate(client, steps);
    await insertTask('tsk_a', status);
    await insertChange(status, status);
    expect(
      await client.get(
        'SELECT tasks.status, from_status, to_status FROM tasks JOIN task_status_changes ON task_id = tasks.id',
      ),
    ).toEqual({ status, from_status: status, to_status: status });
  },
);

test('the status checks accept no status before a change, as at creation', async () => {
  await migrate(client, steps);
  await insertTask('tsk_a', Status.open);
  await insertChange(null, Status.open);
  expect(
    await client.get('SELECT from_status FROM task_status_changes'),
  ).toEqual({ from_status: null });
});

test('the status checks refuse a status that is not a state, on a task and on either side of a change', async () => {
  await migrate(client, steps);
  await expect(insertTask('tsk_a', unknown)).rejects.toThrow(
    /CHECK constraint failed/,
  );
  await insertTask('tsk_a', Status.open);
  await expect(insertChange(unknown, Status.open)).rejects.toThrow(
    /CHECK constraint failed/,
  );
  await expect(insertChange(Status.open, unknown)).rejects.toThrow(
    /CHECK constraint failed/,
  );
  expect(
    await client.get('SELECT count(*) AS n FROM task_status_changes'),
  ).toEqual({ n: 0 });
});
