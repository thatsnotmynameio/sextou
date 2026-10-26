import { join } from 'node:path';
import { Database } from '@tursodatabase/database';
import { generate } from 'drizzle-kit/cli';
import { pino } from 'pino';
import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from 'vitest';
import { openTasks, type Tasks } from '../../src/open-tasks';
import { Status } from '../../src/status';

// The schema's constraints, as the committed migrations create them. Opening
// the graph reads those migrations from disk, hence the integration suite.

let tasks: Tasks;
let exec: MockInstance<Database['exec']>;

// The connection openTasks opened, to write past the graph's checks.
function connection() {
  return exec.mock.contexts[0] as Database;
}

beforeEach(async () => {
  exec = vi.spyOn(Database.prototype, 'exec');
  tasks = await openTasks(':memory:', { logger: pino({ level: 'silent' }) });
});

afterEach(async () => {
  await tasks.close();
  vi.restoreAllMocks();
});

// A change to schema.ts needs its migration, as schema.ts says. explain
// writes nothing and answers what generate would do.
test('schema.ts has no change without a migration', async () => {
  const result = await generate({
    config: join(import.meta.dirname, '..', '..', 'drizzle.config.ts'),
    explain: true,
  });
  expect(result).toMatchObject({ status: 'no_changes' });
});

test('the schema requires an assignee on a task and leaves its description, source path and context optional', async () => {
  expect(
    await connection().all(
      "SELECT name, \"notnull\" FROM pragma_table_info('tasks') WHERE name IN ('assignee', 'context', 'description', 'source_path') ORDER BY name",
    ),
  ).toEqual([
    { name: 'assignee', notnull: 1 },
    { name: 'context', notnull: 0 },
    { name: 'description', notnull: 0 },
    { name: 'source_path', notnull: 0 },
  ]);
});

test('the schema lets a link be refused twice, deleted, and refused for a missing blocker', async () => {
  const client = connection();
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

test("the schema lets an execution's result path and lease be updated", async () => {
  const client = connection();
  await client.exec(
    "INSERT INTO tasks (id, title, kind, priority, assignee, status) VALUES ('a', 'A', 'task', 2, 'dev', 'running'); INSERT INTO task_executions (id, task_id, attempt, actor, claim_id, expires_at) VALUES ('e', 'a', 1, 'bot', 'c', 5)",
  );
  await client.run(
    "UPDATE task_executions SET result_path = 'out', expires_at = NULL WHERE id = 'e'",
  );
  expect(await client.all('SELECT * FROM task_executions')).toEqual([
    {
      id: 'e',
      task_id: 'a',
      attempt: 1,
      actor: 'bot',
      log_path: null,
      result_path: 'out',
      expires_at: null,
      cancel_requested_by: null,
      cancel_reason: null,
      claim_id: 'c',
    },
  ]);
});

// Each attempt under a claim of its own unless one is given.
function insertExecution(id: string, attempt: number, claimId = id) {
  return connection().run(
    "INSERT INTO task_executions (id, task_id, attempt, actor, claim_id) VALUES (?, 'a', ?, 'bot', ?)",
    id,
    attempt,
    claimId,
  );
}

test("the schema numbers a task's attempts from 1, once each", async () => {
  await connection().exec(
    "INSERT INTO tasks (id, title, kind, priority, assignee, status) VALUES ('a', 'A', 'task', 2, 'dev', 'running')",
  );
  await expect(insertExecution('e0', 0)).rejects.toThrow(
    /CHECK constraint failed/,
  );
  await insertExecution('e1', 1);
  await expect(insertExecution('e2', 1)).rejects.toThrow(
    'UNIQUE constraint failed',
  );
  await insertExecution('e2', 2);
  expect(
    await connection().all('SELECT id FROM task_executions ORDER BY attempt'),
  ).toEqual([{ id: 'e1' }, { id: 'e2' }]);
});

test("the schema takes an actor's claim id once", async () => {
  await connection().exec(
    "INSERT INTO tasks (id, title, kind, priority, assignee, status) VALUES ('a', 'A', 'task', 2, 'dev', 'open')",
  );
  await insertExecution('e1', 1, 'c');
  await expect(insertExecution('e2', 2, 'c')).rejects.toThrow(
    'UNIQUE constraint failed',
  );
});

test('the schema refuses an execution of a missing task', async () => {
  await expect(insertExecution('e1', 1)).rejects.toThrow(
    'FOREIGN KEY constraint failed',
  );
});

// A name that is not one of the states.
const unknown = 'closed';

function insertTask(id: string, status: string) {
  return connection().run(
    "INSERT INTO tasks (id, title, kind, priority, assignee, status) VALUES (?, 'T', 'step', 0, 'bot', ?)",
    id,
    status,
  );
}

function insertChange(from: string | null, to: string) {
  return connection().run(
    "INSERT INTO task_status_changes (task_id, from_status, to_status, changed_by, time_changed) VALUES ('tsk_a', ?, ?, 'bot', 0)",
    from,
    to,
  );
}

test.each(Object.values(Status))(
  'the status checks accept %s on a task and on both sides of a change',
  async (status) => {
    await insertTask('tsk_a', status);
    await insertChange(status, status);
    expect(
      await connection().get(
        'SELECT tasks.status, from_status, to_status FROM tasks JOIN task_status_changes ON task_id = tasks.id',
      ),
    ).toEqual({ status, from_status: status, to_status: status });
  },
);

test('the status checks accept no status before a change, as at creation', async () => {
  await insertTask('tsk_a', Status.open);
  await insertChange(null, Status.open);
  expect(
    await connection().get('SELECT from_status FROM task_status_changes'),
  ).toEqual({ from_status: null });
});

test('the status checks refuse a status that is not a state, on a task and on either side of a change', async () => {
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
    await connection().get('SELECT count(*) AS n FROM task_status_changes'),
  ).toEqual({ n: 0 });
});

function insertContext(context: string | null) {
  return connection().run(
    "INSERT INTO tasks (id, title, kind, priority, assignee, status, context) VALUES ('tsk_a', 'T', 'step', 0, 'bot', 'open', ?)",
    context,
  );
}

test('the context check accepts JSON', async () => {
  await insertContext('{"repo":"org/app"}');
  expect(await connection().get('SELECT context FROM tasks')).toEqual({
    context: '{"repo":"org/app"}',
  });
});

test('the context check accepts no context', async () => {
  await insertContext(null);
  expect(await connection().get('SELECT context FROM tasks')).toEqual({
    context: null,
  });
});

test.each(['[1]', '"org/app"', '7', 'null'])(
  'the context check refuses JSON that is not an object, %s',
  async (context) => {
    await expect(insertContext(context)).rejects.toThrow(
      /CHECK constraint failed/,
    );
  },
);

test('the context check refuses text that is not JSON', async () => {
  await expect(insertContext('{repo')).rejects.toThrow(
    /CHECK constraint failed/,
  );
  expect(await connection().get('SELECT count(*) AS n FROM tasks')).toEqual({
    n: 0,
  });
});
