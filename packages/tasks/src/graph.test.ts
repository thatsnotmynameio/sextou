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
import type { FinalStatus, Task } from './graph';
import { openTasks, type Tasks } from './open-tasks';

type Status = Task['status'];

let tasks: Tasks;
let prepare: MockInstance<DatabaseSync['prepare']>;

// The connection openTasks opened, to read what the graph stored.
function connection() {
  return prepare.mock.contexts[0] as DatabaseSync;
}

function counter(id: string) {
  return connection()
    .prepare('SELECT holding_blockers FROM task WHERE id = ?')
    .get(id)?.holding_blockers;
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

function rows() {
  return connection().prepare('SELECT count(*) AS n FROM task').get()?.n;
}

function create(
  title: string,
  priority = 2,
  parentId?: string,
  assignee = 'dev',
) {
  const result = tasks.createTask({
    title,
    kind: 'task',
    priority,
    parentId,
    assignee,
  });
  if (!result.ok) throw new Error(`create ${title}: ${result.reason}`);
  return result.task.id;
}

function link(taskId: string, blockerId: string) {
  return tasks.link({ taskId, blockerId });
}

function unlink(taskId: string, blockerId: string) {
  return tasks.unlink({ taskId, blockerId });
}

function start(id: string) {
  return tasks.startTask({ id });
}

function finish(id: string, status: FinalStatus) {
  return tasks.finishTask({ id, status });
}

// Starts a ready open task and, for a final state, finishes it.
function moveTo(id: string, to: Status) {
  if (to === 'open') return;
  if (!start(id).ok) throw new Error(`start ${id}`);
  if (to !== 'running' && !finish(id, to).ok) throw new Error(`finish ${id}`);
}

function ready(limit = 100, assignees = ['dev']) {
  const result = tasks.listReady({ assignees, limit });
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
      assignee: '  dev ',
    });
    expect(result).toEqual({
      ok: true,
      task: {
        id: expect.stringMatching(/^tsk_[0-9a-f]{32}$/),
        title: 'Write the parser',
        kind: 'task',
        priority: 2,
        parentId: null,
        assignee: 'dev',
        description: null,
        sourcePath: null,
        status: 'open',
        timeCreated: 1_700_000_000_000,
      },
    });
    expect(ready()).toEqual(['Write the parser']);
  });

  it('keeps the description and source path, trimmed at the ends only', () => {
    const result = tasks.createTask({
      title: 'A',
      kind: 'task',
      priority: 2,
      assignee: 'dev',
      description: '\n  Parse the input.\n\nThen print it.  ',
      sourcePath: ' https://github.com/o/r/issues/1 ',
    });
    expect(result).toMatchObject({
      ok: true,
      task: {
        description: 'Parse the input.\n\nThen print it.',
        sourcePath: 'https://github.com/o/r/issues/1',
      },
    });
    expect(
      connection()
        .prepare('SELECT assignee, description, source_path FROM task')
        .get(),
    ).toEqual({
      assignee: 'dev',
      description: 'Parse the input.\n\nThen print it.',
      source_path: 'https://github.com/o/r/issues/1',
    });
  });

  it('stores a file path as the source path, as given', () => {
    const result = tasks.createTask({
      title: 'A',
      kind: 'task',
      priority: 2,
      assignee: 'dev',
      sourcePath: './notes/task.md',
    });
    expect(result).toMatchObject({
      ok: true,
      task: { sourcePath: './notes/task.md' },
    });
  });

  it('stores a blank description or source path as null', () => {
    const blankDescription = tasks.createTask({
      title: 'A',
      kind: 'task',
      priority: 2,
      assignee: 'dev',
      description: '   ',
    });
    const blankSource = tasks.createTask({
      title: 'B',
      kind: 'task',
      priority: 2,
      assignee: 'dev',
      sourcePath: ' ',
    });
    expect(blankDescription).toMatchObject({
      ok: true,
      task: { description: null, sourcePath: null },
    });
    expect(blankSource).toMatchObject({ ok: true, task: { sourcePath: null } });
  });

  it.each([
    { title: '', kind: 'task', priority: 2, assignee: 'dev' },
    { title: '   ', kind: 'task', priority: 2, assignee: 'dev' },
    { title: 'A', kind: '', priority: 2, assignee: 'dev' },
    { title: 'A', kind: ' ', priority: 2, assignee: 'dev' },
    { title: 'A', kind: 'task', priority: 5, assignee: 'dev' },
    { title: 'A', kind: 'task', priority: -1, assignee: 'dev' },
    { title: 'A', kind: 'task', priority: 1.5, assignee: 'dev' },
    { title: 'A', kind: 'task', priority: 2, assignee: 'dev', parentId: 7 },
    { title: 7, kind: 'task', priority: 2, assignee: 'dev' },
    { title: 'A', kind: 'task', priority: 2 },
    { title: 'A', kind: 'task', priority: 2, assignee: '' },
    { title: 'A', kind: 'task', priority: 2, assignee: '   ' },
    { title: 'A', kind: 'task', priority: 2, assignee: 7 },
    { title: 'A', kind: 'task', priority: 2, assignee: 'dev', description: 42 },
    { title: 'A', kind: 'task', priority: 2, assignee: 'dev', sourcePath: 42 },
  ])('refuses %j as invalid, writing nothing', (input) => {
    expect(tasks.createTask(input as never)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(rows()).toBe(0);
  });

  it('refuses a missing parent as not_found, writing nothing', () => {
    expect(
      tasks.createTask({
        title: 'A',
        kind: 'task',
        priority: 2,
        parentId: 'tsk_missing',
        assignee: 'dev',
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(ready()).toEqual([]);
  });

  it('accepts a child of a finished parent', () => {
    const parent = create('Parent');
    moveTo(parent, 'failed');
    const result = tasks.createTask({
      title: 'Child',
      kind: 'task',
      priority: 2,
      parentId: parent,
      assignee: 'dev',
    });
    expect(result).toMatchObject({ ok: true, task: { parentId: parent } });
  });

  it('accepts any label as the kind', () => {
    const result = tasks.createTask({
      title: 'A',
      kind: 'initiative',
      priority: 0,
      assignee: 'dev',
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

  it('changes nothing for a pair already linked, even once both finished', () => {
    const a = create('A');
    const b = create('B');
    link(b, a);
    expect(link(b, a)).toEqual({ ok: true });
    expect(counter(b)).toBe(1);
    moveTo(a, 'succeeded');
    moveTo(b, 'succeeded');
    expect(link(b, a)).toEqual({ ok: true });
    expect(counter(b)).toBe(0);
    expect(links()).toEqual([{ task_id: b, blocker_id: a }]);
  });

  it.each<Status>(['running', 'succeeded', 'failed', 'skipped'])(
    'refuses a %s task as not_open',
    (to) => {
      const a = create('A');
      const b = create('B');
      moveTo(b, to);
      expect(link(b, a)).toEqual({ ok: false, reason: 'not_open' });
      expect(links()).toEqual([]);
    },
  );

  // Covers AE7.
  it.each<Status>(['succeeded', 'skipped'])(
    'links to a %s blocker without holding the task',
    (to) => {
      const a = create('A');
      const b = create('B');
      moveTo(b, to);
      expect(link(a, b)).toEqual({ ok: true });
      expect(counter(a)).toBe(0);
      expect(ready()).toEqual(['A']);
    },
  );

  // Covers AE7.
  it.each<Status>(['open', 'running', 'failed'])(
    'links to a %s blocker, which holds the task',
    (to) => {
      const a = create('A');
      const b = create('B');
      moveTo(b, to);
      expect(link(a, b)).toEqual({ ok: true });
      expect(counter(a)).toBe(1);
      expect(ready()).not.toContain('A');
    },
  );
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

  it.each<Status>(['succeeded', 'skipped'])(
    'unlinks a %s blocker without moving the counter',
    (to) => {
      const a = create('A');
      const b = create('B');
      const c = create('C');
      link(c, a);
      link(c, b);
      moveTo(a, to);
      expect(unlink(c, a)).toEqual({ ok: true });
      expect(counter(c)).toBe(1);
    },
  );

  it.each<Status>(['running', 'failed'])(
    'makes a task ready once its %s blocker is unlinked',
    (to) => {
      const a = create('A');
      const b = create('B');
      link(b, a);
      moveTo(a, to);
      expect(unlink(b, a)).toEqual({ ok: true });
      expect(counter(b)).toBe(0);
      expect(ready()).toEqual(['B']);
    },
  );

  it.each<Status>(['running', 'succeeded', 'failed', 'skipped'])(
    'refuses a %s task as not_open, keeping the link',
    (to) => {
      const a = create('A');
      const b = create('B');
      link(b, a);
      moveTo(a, 'succeeded');
      moveTo(b, to);
      expect(unlink(b, a)).toEqual({ ok: false, reason: 'not_open' });
      expect(links()).toEqual([{ task_id: b, blocker_id: a }]);
    },
  );

  it('refuses a missing task as not_found and a non-string id as invalid', () => {
    const a = create('A');
    expect(unlink(a, 'tsk_missing')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(unlink(a, null as never)).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('startTask', () => {
  it('moves a ready task to running, out of the ready list', () => {
    const a = create('A');
    expect(start(a)).toEqual({ ok: true });
    expect(status(a)).toBe('running');
    expect(ready()).toEqual([]);
  });

  // Covers AE3.
  it.each<Status>(['open', 'running', 'failed'])(
    'refuses a task with a %s blocker as blocked, which stays open',
    (to) => {
      const a = create('A');
      const b = create('B');
      link(b, a);
      moveTo(a, to);
      expect(start(b)).toEqual({ ok: false, reason: 'blocked' });
      expect(status(b)).toBe('open');
    },
  );

  // Covers AE4.
  it('refuses a task already started as not_open', () => {
    const a = create('A');
    expect(start(a)).toEqual({ ok: true });
    expect(start(a)).toEqual({ ok: false, reason: 'not_open' });
    expect(status(a)).toBe('running');
  });

  it.each<Status>(['succeeded', 'failed', 'skipped'])(
    'refuses a %s task as not_open',
    (to) => {
      const a = create('A');
      moveTo(a, to);
      expect(start(a)).toEqual({ ok: false, reason: 'not_open' });
      expect(status(a)).toBe(to);
    },
  );

  it('refuses a missing task as not_found and a non-string id as invalid', () => {
    expect(start('tsk_missing')).toEqual({ ok: false, reason: 'not_found' });
    expect(start(undefined as never)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('finishTask', () => {
  // Covers AE1.
  it.each<FinalStatus>(['succeeded', 'skipped'])(
    'frees the tasks it blocks when it finishes as %s',
    (to) => {
      const a = create('A');
      const b = create('B');
      const c = create('C');
      link(c, a);
      link(c, b);
      start(a);
      expect(finish(a, to)).toEqual({ ok: true });
      expect(status(a)).toBe(to);
      expect(ready()).toEqual(['B']);
      moveTo(b, to);
      expect(ready()).toEqual(['C']);
    },
  );

  // Covers AE2.
  it('keeps the tasks it blocks waiting when it fails, until unlinked', () => {
    const a = create('A');
    const b = create('B');
    link(b, a);
    start(a);
    expect(finish(a, 'failed')).toEqual({ ok: true });
    expect(status(a)).toBe('failed');
    expect(status(b)).toBe('open');
    expect(counter(b)).toBe(1);
    expect(ready()).toEqual([]);
    unlink(b, a);
    expect(ready()).toEqual(['B']);
  });

  // Covers AE5.
  it.each<FinalStatus>(['succeeded', 'failed', 'skipped'])(
    'refuses to finish an open task as %s, as not_running',
    (to) => {
      const a = create('A');
      expect(finish(a, to)).toEqual({ ok: false, reason: 'not_running' });
      expect(status(a)).toBe('open');
    },
  );

  // Covers AE6.
  it('refuses to finish a finished task again, in any state', () => {
    const a = create('A');
    const b = create('B');
    link(b, a);
    moveTo(a, 'succeeded');
    for (const to of ['succeeded', 'failed', 'skipped'] as const) {
      expect(finish(a, to)).toEqual({ ok: false, reason: 'not_running' });
    }
    expect(status(a)).toBe('succeeded');
    expect(counter(b)).toBe(0);
  });

  it.each(['open', 'running', 'closed', undefined, 7])(
    'refuses %j as the final state as invalid',
    (to) => {
      const a = create('A');
      start(a);
      expect(finish(a, to as never)).toEqual({ ok: false, reason: 'invalid' });
      expect(status(a)).toBe('running');
    },
  );

  it('refuses a missing task as not_found and a non-string id as invalid', () => {
    expect(finish('tsk_missing', 'succeeded')).toEqual({
      ok: false,
      reason: 'not_found',
    });
    expect(finish(7 as never, 'succeeded')).toEqual({
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
    const created = tasks.createTask({
      title: 'A',
      kind: 'task',
      priority: 2,
      assignee: 'dev',
      description: 'Parse the input.',
      sourcePath: './notes/task.md',
    });
    if (!created.ok) throw new Error(`create: ${created.reason}`);
    expect(tasks.listReady({ assignees: ['dev'], limit: 1 })).toEqual({
      ok: true,
      tasks: [created.task],
    });
  });

  it("merges the assignees' ready tasks into one list and leaves out the rest", () => {
    create('A', 2, undefined, 'dev');
    create('B', 1, undefined, 'bot-dev-1');
    create('C', 0, undefined, 'qa');
    expect(ready(100, ['bot-dev-1', 'dev'])).toEqual(['B', 'A']);
  });

  it('matches the assignee exactly', () => {
    create('A', 2, undefined, 'dev');
    expect(ready(100, ['Dev'])).toEqual([]);
    expect(ready(100, ['dev-1'])).toEqual([]);
  });

  it('orders two assignees by creation across both, up to the limit', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const titles = Array.from({ length: 6 }, (_, n) => `T${n}`);
    titles.forEach((title, n) =>
      create(title, 2, undefined, ['dev', 'qa'][n % 2]),
    );
    expect(ready(100, ['qa', 'dev'])).toEqual(titles);
    expect(ready(3, ['qa', 'dev'])).toEqual(['T0', 'T1', 'T2']);
  });

  it('trims the assignees asked for and returns a task once', () => {
    create('A');
    expect(ready(100, [' dev '])).toEqual(['A']);
    expect(ready(100, ['dev', 'dev'])).toEqual(['A']);
  });

  it.each([[], undefined, 'dev', [''], ['  '], [7]])(
    'refuses %j as the assignees as invalid',
    (assignees) => {
      expect(tasks.listReady({ assignees, limit: 1 } as never)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    },
  );

  it.each([0, -1, 1.5, Number.NaN])(
    'refuses a limit of %d as invalid',
    (limit) => {
      expect(tasks.listReady({ assignees: ['dev'], limit })).toEqual({
        ok: false,
        reason: 'invalid',
      });
    },
  );

  it('searches the ready index by assignee, with no table scan', () => {
    const statement = prepare.mock.results
      .map((result) => result.value as StatementSync)
      .find((candidate) =>
        candidate.sourceSQL.includes('holding_blockers = 0'),
      );
    const plan = connection()
      .prepare(`EXPLAIN QUERY PLAN ${statement?.sourceSQL}`)
      .all('["dev","qa"]', 10)
      .map((row) => String(row.detail));
    // The sort covers only the rows the search found.
    expect(plan).toEqual([
      'SEARCH task USING INDEX task_ready (assignee=?)',
      'LIST SUBQUERY 1',
      'SCAN json_each VIRTUAL TABLE INDEX 1:',
      'USE TEMP B-TREE FOR ORDER BY',
    ]);
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

  it('keeps every counter equal to the holding blockers, and no task past open held by one', () => {
    const next = random(42);
    const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)];
    const running = connection().prepare(
      "SELECT id FROM task WHERE status = 'running'",
    );
    const ids = [create('T0')];
    for (let step = 0; step < 400; step++) {
      const roll = next();
      if (roll < 0.25) {
        const assignee = pick(['dev', 'qa', 'ops']);
        ids.push(create(`T${ids.length}`, 2, pick(ids), assignee));
      } else if (roll < 0.55) link(pick(ids), pick(ids));
      else if (roll < 0.7) unlink(pick(ids), pick(ids));
      else if (roll < 0.85) start(pick(ids));
      else {
        // Mostly a running task, so finishes happen; any task otherwise.
        const candidates = running.all().map((row) => String(row.id));
        finish(
          next() < 0.8 && candidates.length > 0 ? pick(candidates) : pick(ids),
          pick<FinalStatus>(['succeeded', 'failed', 'skipped']),
        );
      }
    }

    const holding = "blocker.status IN ('open', 'running', 'failed')";
    const drift = connection()
      .prepare(
        `SELECT task.id FROM task WHERE task.status = 'open' AND task.holding_blockers <> (
          SELECT count(*) FROM link JOIN task AS blocker ON blocker.id = link.blocker_id
          WHERE link.task_id = task.id AND ${holding})`,
      )
      .all();
    const heldPastOpen = connection()
      .prepare(
        `SELECT link.task_id FROM link
        JOIN task ON task.id = link.task_id
        JOIN task AS blocker ON blocker.id = link.blocker_id
        WHERE task.status <> 'open' AND ${holding}`,
      )
      .all();
    const counts = Object.fromEntries(
      connection()
        .prepare('SELECT status, count(*) AS n FROM task GROUP BY status')
        .all()
        .map((row) => [row.status, row.n]),
    );
    expect(drift).toEqual([]);
    expect(heldPastOpen).toEqual([]);
    // The run exercised links, starts and every finish, not only refusals.
    expect(links().length).toBeGreaterThan(20);
    for (const to of ['succeeded', 'failed', 'skipped']) {
      expect(counts[to]).toBeGreaterThan(2);
    }
  });
});
