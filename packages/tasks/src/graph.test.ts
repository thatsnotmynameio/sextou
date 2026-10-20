import { DatabaseSync, type StatementSync } from 'node:sqlite';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { openTasks, type Tasks } from './open-tasks';

let tasks: Tasks;
let prepare: MockInstance<DatabaseSync['prepare']>;

// The connection openTasks opened, to read what the graph stored.
function connection() {
  return prepare.mock.contexts[0] as DatabaseSync;
}

function counter(id: string) {
  return connection()
    .prepare('SELECT open_blockers FROM task WHERE id = ?')
    .get(id)?.open_blockers;
}

function status(id: string) {
  return connection().prepare('SELECT status FROM task WHERE id = ?').get(id)
    ?.status;
}

function links() {
  return connection()
    .prepare(
      'SELECT task_id, blocker_id FROM link ORDER BY task_id, blocker_id',
    )
    .all();
}

function create(title: string, priority = 2, parentId?: string) {
  const result = tasks.createTask({ title, kind: 'task', priority, parentId });
  if (!result.ok) throw new Error(`create ${title}: ${result.reason}`);
  return result.task.id;
}

function link(taskId: string, blockerId: string) {
  return tasks.link({ taskId, blockerId });
}

function unlink(taskId: string, blockerId: string) {
  return tasks.unlink({ taskId, blockerId });
}

function ready(limit = 100) {
  const result = tasks.listReady(limit);
  if (!result.ok) throw new Error(`ready: ${result.reason}`);
  return result.tasks.map((task) => task.title);
}

beforeEach(() => {
  prepare = vi.spyOn(DatabaseSync.prototype, 'prepare');
  tasks = openTasks(':memory:');
});

afterEach(() => {
  tasks.close();
  vi.restoreAllMocks();
});

describe('createTask', () => {
  it('creates an open task that is ready', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const result = tasks.createTask({
      title: '  Write the parser ',
      kind: ' task ',
      priority: 2,
    });
    expect(result).toEqual({
      ok: true,
      task: {
        id: expect.stringMatching(/^tsk_[0-9a-f]{32}$/),
        title: 'Write the parser',
        kind: 'task',
        priority: 2,
        parentId: null,
        status: 'open',
        timeCreated: 1_700_000_000_000,
      },
    });
    expect(ready()).toEqual(['Write the parser']);
  });

  it.each([
    { title: '', kind: 'task', priority: 2 },
    { title: '   ', kind: 'task', priority: 2 },
    { title: 'A', kind: '', priority: 2 },
    { title: 'A', kind: ' ', priority: 2 },
    { title: 'A', kind: 'task', priority: 5 },
    { title: 'A', kind: 'task', priority: -1 },
    { title: 'A', kind: 'task', priority: 1.5 },
    { title: 'A', kind: 'task', priority: 2, parentId: 7 },
    { title: 7, kind: 'task', priority: 2 },
  ])('refuses %j as invalid, writing nothing', (input) => {
    expect(tasks.createTask(input as never)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(ready()).toEqual([]);
  });

  it('refuses a missing parent as not_found, writing nothing', () => {
    expect(
      tasks.createTask({
        title: 'A',
        kind: 'task',
        priority: 2,
        parentId: 'tsk_missing',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(ready()).toEqual([]);
  });

  it('accepts a child of a closed parent', () => {
    const parent = create('Parent');
    tasks.closeTask(parent);
    const result = tasks.createTask({
      title: 'Child',
      kind: 'task',
      priority: 2,
      parentId: parent,
    });
    expect(result).toMatchObject({ ok: true, task: { parentId: parent } });
  });

  it('accepts any label as the kind', () => {
    const result = tasks.createTask({
      title: 'A',
      kind: 'initiative',
      priority: 0,
    });
    expect(result).toMatchObject({ ok: true, task: { kind: 'initiative' } });
  });

  // Covers AE6: a parent only organizes.
  it('keeps a parent and its open children ready when nothing links them', () => {
    const issue = create('Issue');
    create('Child 1', 2, issue);
    create('Child 2', 2, issue);
    expect(ready()).toEqual(['Issue', 'Child 1', 'Child 2']);
  });

  it('gives a thousand tasks a thousand distinct ids', () => {
    const ids = Array.from({ length: 1000 }, (_, n) => create(`T${n}`));
    expect(new Set(ids).size).toBe(1000);
    for (const id of ids) expect(id).toMatch(/^tsk_/);
  });
});

describe('link', () => {
  it('takes a task blocked by an open task out of the ready list', () => {
    const a = create('A');
    const b = create('B');
    expect(link(b, a)).toEqual({ ok: true });
    expect(ready()).toEqual(['A']);
    expect(counter(b)).toBe(1);
  });

  // Covers AE1.
  it('refuses a link that closes a cycle, leaving links and counters', () => {
    const a = create('A');
    const b = create('B');
    const c = create('C');
    link(b, a);
    link(c, b);
    expect(link(a, c)).toEqual({ ok: false, reason: 'cycle' });
    expect(links()).toHaveLength(2);
    expect(links()).toEqual(
      expect.arrayContaining([
        { task_id: b, blocker_id: a },
        { task_id: c, blocker_id: b },
      ]),
    );
    expect([counter(a), counter(b), counter(c)]).toEqual([0, 1, 1]);
  });

  it('refuses a task blocked by itself as same_task', () => {
    const a = create('A');
    expect(link(a, a)).toEqual({ ok: false, reason: 'same_task' });
    expect(links()).toEqual([]);
  });

  it('refuses a missing task on either side as not_found', () => {
    const a = create('A');
    expect(link(a, 'tsk_missing')).toEqual({ ok: false, reason: 'not_found' });
    expect(link('tsk_missing', a)).toEqual({ ok: false, reason: 'not_found' });
    expect(links()).toEqual([]);
  });

  it('refuses an id that is not a string as invalid', () => {
    const a = create('A');
    expect(link(a, 7 as never)).toEqual({ ok: false, reason: 'invalid' });
    expect(link(7 as never, a)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('changes nothing for a pair already linked, even once both closed', () => {
    const a = create('A');
    const b = create('B');
    link(b, a);
    expect(link(b, a)).toEqual({ ok: true });
    expect(counter(b)).toBe(1);
    tasks.closeTask(a);
    tasks.closeTask(b);
    expect(link(b, a)).toEqual({ ok: true });
    expect(counter(b)).toBe(0);
    expect(links()).toEqual([{ task_id: b, blocker_id: a }]);
  });

  it('refuses a closed task as not_open', () => {
    const a = create('A');
    const b = create('B');
    tasks.closeTask(b);
    expect(link(b, a)).toEqual({ ok: false, reason: 'not_open' });
    expect(links()).toEqual([]);
  });

  it('links to a closed blocker without moving the counter', () => {
    const a = create('A');
    const b = create('B');
    tasks.closeTask(b);
    expect(link(a, b)).toEqual({ ok: true });
    expect(counter(a)).toBe(0);
    expect(ready()).toEqual(['A']);
  });
});

describe('unlink', () => {
  it('makes a task ready once its only open blocker is unlinked', () => {
    const a = create('A');
    const b = create('B');
    link(b, a);
    expect(unlink(b, a)).toEqual({ ok: true });
    expect(counter(b)).toBe(0);
    expect(ready()).toEqual(['A', 'B']);
  });

  it('changes nothing for a pair that is not linked', () => {
    const a = create('A');
    const b = create('B');
    const c = create('C');
    link(b, a);
    expect(unlink(b, c)).toEqual({ ok: true });
    expect(counter(b)).toBe(1);
  });

  it('unlinks a closed blocker without moving the counter', () => {
    const a = create('A');
    const b = create('B');
    const c = create('C');
    link(c, a);
    link(c, b);
    tasks.closeTask(a);
    expect(unlink(c, a)).toEqual({ ok: true });
    expect(counter(c)).toBe(1);
  });

  it('refuses a closed task as not_open, keeping the link', () => {
    const a = create('A');
    const b = create('B');
    link(b, a);
    tasks.closeTask(a);
    tasks.closeTask(b);
    expect(unlink(b, a)).toEqual({ ok: false, reason: 'not_open' });
    expect(links()).toEqual([{ task_id: b, blocker_id: a }]);
  });

  it('refuses a missing task as not_found and a non-string id as invalid', () => {
    const a = create('A');
    expect(unlink(a, 'tsk_missing')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(unlink(a, null as never)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('closeTask', () => {
  // Covers AE2.
  it('refuses a task whose blocker is open, which stays open', () => {
    const a = create('A');
    const b = create('B');
    link(b, a);
    expect(tasks.closeTask(b)).toEqual({ ok: false, reason: 'open_blockers' });
    expect(status(b)).toBe('open');
  });

  // Covers AE3.
  it('makes a task ready in the same call that closes its last open blocker', () => {
    const a = create('A');
    const b = create('B');
    const c = create('C');
    link(c, a);
    link(c, b);
    tasks.closeTask(a);
    expect(ready()).toEqual(['B']);
    expect(tasks.closeTask(b)).toEqual({ ok: true });
    expect(ready()).toEqual(['C']);
  });

  // Covers AE4.
  it('changes nothing when the task is already closed', () => {
    const a = create('A');
    const b = create('B');
    const c = create('C');
    link(b, a);
    link(b, c);
    tasks.closeTask(a);
    expect(tasks.closeTask(a)).toEqual({ ok: true });
    expect(status(a)).toBe('closed');
    expect(counter(b)).toBe(1);
    expect(ready()).toEqual(['C']);
  });

  it('refuses a missing task as not_found and a non-string id as invalid', () => {
    expect(tasks.closeTask('tsk_missing')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(tasks.closeTask(undefined as never)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('listReady', () => {
  it('lists the most urgent first, then the oldest, up to the limit', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    // Twenty tasks in one millisecond, with random ids: only the creation
    // order sorts them.
    const titles = Array.from({ length: 20 }, (_, n) => `P2-${n}`);
    for (const title of titles) create(title, 2);
    create('P0', 0);
    create('P1', 1);
    expect(ready(100)).toEqual(['P0', 'P1', ...titles]);
    expect(ready(3)).toEqual(['P0', 'P1', 'P2-0']);
  });

  it('returns whole tasks', () => {
    const a = create('A');
    const result = tasks.listReady(1);
    expect(result).toMatchObject({ ok: true, tasks: [{ id: a, title: 'A' }] });
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'refuses a limit of %d as invalid',
    (limit) => {
      expect(tasks.listReady(limit)).toEqual({ ok: false, reason: 'invalid' });
    },
  );

  it('reads through the ready index, with no table scan or sort', () => {
    const statement = prepare.mock.results
      .map((result) => result.value as StatementSync)
      .find((candidate) => candidate.sourceSQL.includes('open_blockers = 0'));
    const plan = connection()
      .prepare(`EXPLAIN QUERY PLAN ${statement?.sourceSQL}`)
      .all(10)
      .map((row) => String(row.detail));
    expect(plan).toEqual(['SCAN task USING INDEX task_ready']);
  });
});

describe('an error from SQLite', () => {
  it('is thrown, and the write it interrupted leaves nothing behind', () => {
    const a = create('A');
    const b = create('B');
    // Fails the link's insert, after the counter has moved.
    connection().exec(
      "CREATE TRIGGER fail BEFORE INSERT ON link BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END",
    );
    expect(() => link(b, a)).toThrow('disk I/O error');
    expect(counter(b)).toBe(0);
    expect(links()).toEqual([]);
    expect(connection().isTransaction).toBe(false);
    expect(ready()).toEqual(['A', 'B']);
  });
});

describe('the graph after random operations', () => {
  // A fixed seed, so a failure replays.
  function random(seed: number) {
    return () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
  }

  it('keeps every counter equal to the open blockers, and no closed task blocked by an open one', () => {
    const next = random(42);
    const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)];
    const ids = [create('T0')];
    for (let step = 0; step < 400; step++) {
      const roll = next();
      if (roll < 0.25) ids.push(create(`T${ids.length}`, 2, pick(ids)));
      else if (roll < 0.6) link(pick(ids), pick(ids));
      else if (roll < 0.8) unlink(pick(ids), pick(ids));
      else tasks.closeTask(pick(ids));
    }

    const drift = connection()
      .prepare(
        `SELECT task.id FROM task WHERE task.status = 'open' AND task.open_blockers <> (
          SELECT count(*) FROM link JOIN task AS blocker ON blocker.id = link.blocker_id
          WHERE link.task_id = task.id AND blocker.status = 'open')`,
      )
      .all();
    const closedBlocked = connection()
      .prepare(
        `SELECT link.task_id FROM link
        JOIN task ON task.id = link.task_id
        JOIN task AS blocker ON blocker.id = link.blocker_id
        WHERE task.status = 'closed' AND blocker.status = 'open'`,
      )
      .all();
    const counts = connection()
      .prepare(
        "SELECT (SELECT count(*) FROM link) AS links, (SELECT count(*) FROM task WHERE status = 'closed') AS closed",
      )
      .get();
    expect(drift).toEqual([]);
    expect(closedBlocked).toEqual([]);
    // The run exercised links and closes, not only refusals.
    expect(counts?.links).toBeGreaterThan(20);
    expect(counts?.closed).toBeGreaterThan(10);
  });
});
