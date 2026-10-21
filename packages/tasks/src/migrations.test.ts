import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrate, steps } from './migrations';
import { Status } from './status';

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
  it('create the tasks, task links, task status changes and task executions tables', () => {
    migrate(client, steps);
    expect(tables()).toEqual([
      'task_executions',
      'task_links',
      'task_status_changes',
      'tasks',
    ]);
    expect(version()).toBe(steps.length);
  });

  it('require an assignee on a task and leave its description and source path optional', () => {
    migrate(client, steps);
    expect(
      client
        .prepare(
          "SELECT name, \"notnull\" FROM pragma_table_info('tasks') WHERE name IN ('assignee', 'description', 'source_path') ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: 'assignee', notnull: 1 },
      { name: 'description', notnull: 0 },
      { name: 'source_path', notnull: 0 },
    ]);
  });

  describe('status checks', () => {
    // A name that is not one of the states.
    const unknown = 'closed';

    function insertTask(id: string, status: string) {
      client
        .prepare(
          "INSERT INTO tasks (id, title, kind, priority, assignee, status) VALUES (?, 'T', 'step', 0, 'bot', ?)",
        )
        .run(id, status);
    }

    function insertChange(from: string | null, to: string) {
      client
        .prepare(
          "INSERT INTO task_status_changes (task_id, from_status, to_status, changed_by, time_changed) VALUES ('tsk_a', ?, ?, 'bot', 0)",
        )
        .run(from, to);
    }

    beforeEach(() => {
      migrate(client, steps);
    });

    it.each(Object.values(Status))(
      'accept %s on a task and on both sides of a change',
      (status) => {
        insertTask('tsk_a', status);
        insertChange(status, status);
        expect(
          client
            .prepare(
              'SELECT tasks.status, from_status, to_status FROM tasks JOIN task_status_changes ON task_id = tasks.id',
            )
            .get(),
        ).toEqual({ status, from_status: status, to_status: status });
      },
    );

    it('accept no status before a change, as at creation', () => {
      insertTask('tsk_a', Status.open);
      insertChange(null, Status.open);
      expect(
        client.prepare('SELECT from_status FROM task_status_changes').get(),
      ).toEqual({ from_status: null });
    });

    it('refuse a status that is not a state, on a task and on either side of a change', () => {
      expect(() => insertTask('tsk_a', unknown)).toThrow(
        /CHECK constraint failed/,
      );
      insertTask('tsk_a', Status.open);
      expect(() => insertChange(unknown, Status.open)).toThrow(
        /CHECK constraint failed/,
      );
      expect(() => insertChange(Status.open, unknown)).toThrow(
        /CHECK constraint failed/,
      );
      expect(
        client.prepare('SELECT count(*) AS n FROM task_status_changes').get(),
      ).toEqual({ n: 0 });
    });
  });
});
