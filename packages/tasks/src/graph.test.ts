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
    createdBy: 'planner',
  });
  if (!result.ok) throw new Error(`create ${title}: ${result.reason}`);
  return result.task.id;
}

// The task's state changes, oldest first.
function history(id: string) {
  return connection()
    .prepare(
      'SELECT from_status, to_status, changed_by, reason, time_changed FROM status_change WHERE task_id = ? ORDER BY id',
    )
    .all(id);
}

// The task's execution, as a list of at most one row.
function execution(id: string) {
  return connection()
    .prepare(
      'SELECT actor, log_path, result_path FROM execution WHERE task_id = ?',
    )
    .all(id);
}

function link(taskId: string, blockerId: string) {
  return tasks.link({ taskId, blockerId });
}

function unlink(taskId: string, blockerId: string) {
  return tasks.unlink({ taskId, blockerId });
}

function start(id: string) {
  return tasks.startTask({ id, changedBy: 'orchestrator', actor: 'bot-dev-1' });
}

function finish(id: string, status: FinalStatus) {
  return tasks.finishTask({ id, changedBy: 'bot-dev-1', status });
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
  it('creates an open task that is ready, recording who created it and when', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const result = tasks.createTask({
      title: '  Write the parser ',
      kind: ' task ',
      priority: 2,
      assignee: '  dev ',
      createdBy: ' planner ',
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
      },
    });
    expect(ready()).toEqual(['Write the parser']);
    expect(history(result.ok ? result.task.id : '')).toEqual([
      {
        from_status: null,
        to_status: 'open',
        changed_by: 'planner',
        reason: null,
        time_changed: 1_700_000_000_000,
      },
    ]);
  });

  it('keeps the description and source path, trimmed at the ends only', () => {
    const result = tasks.createTask({
      title: 'A',
      kind: 'task',
      priority: 2,
      assignee: 'dev',
      createdBy: 'planner',
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
      createdBy: 'planner',
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
      createdBy: 'planner',
      description: '   ',
    });
    const blankSource = tasks.createTask({
      title: 'B',
      kind: 'task',
      priority: 2,
      assignee: 'dev',
      createdBy: 'planner',
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
    { title: 'A', kind: 'task', priority: 2, assignee: 'dev', createdBy: '' },
    { title: 'A', kind: 'task', priority: 2, assignee: 'dev', createdBy: ' ' },
    { title: 'A', kind: 'task', priority: 2, assignee: 'dev', createdBy: 7 },
    {
      title: 'A',
      kind: 'task',
      priority: 2,
      assignee: 'dev',
      createdBy: undefined,
    },
  ])('refuses %j as invalid, writing nothing', (input) => {
    expect(
      tasks.createTask({ createdBy: 'planner', ...input } as never),
    ).toEqual({ ok: false, reason: 'invalid' });
    expect(rows()).toBe(0);
    expect(connection().prepare('SELECT * FROM status_change').all()).toEqual(
      [],
    );
  });

  it('refuses a missing parent as not_found, writing nothing', () => {
    expect(
      tasks.createTask({
        title: 'A',
        kind: 'task',
        priority: 2,
        parentId: 'tsk_missing',
        assignee: 'dev',
        createdBy: 'planner',
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
      createdBy: 'planner',
    });
    expect(result).toMatchObject({ ok: true, task: { parentId: parent } });
  });

  it('accepts any label as the kind', () => {
    const result = tasks.createTask({
      title: 'A',
      kind: 'initiative',
      priority: 0,
      assignee: 'dev',
      createdBy: 'planner',
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
      expect(history(b)).toHaveLength(1);
      expect(execution(b)).toEqual([]);
    },
  );

  // Covers AE4.
  it('refuses a task already started as not_open', () => {
    const a = create('A');
    expect(start(a)).toEqual({ ok: true });
    expect(start(a)).toEqual({ ok: false, reason: 'not_open' });
    expect(status(a)).toBe('running');
    expect(history(a)).toHaveLength(2);
    expect(execution(a)).toHaveLength(1);
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

  it.each([
    { changedBy: '', actor: 'bot' },
    { changedBy: ' ', actor: 'bot' },
    { changedBy: 7, actor: 'bot' },
    { actor: 'bot' },
    { changedBy: 'orchestrator', actor: '' },
    { changedBy: 'orchestrator', actor: ' ' },
    { changedBy: 'orchestrator', actor: 7 },
    { changedBy: 'orchestrator' },
    { changedBy: 'orchestrator', actor: 'bot', logPath: 7 },
  ])('refuses %j as invalid, writing nothing', (input) => {
    const a = create('A');
    expect(tasks.startTask({ id: a, ...input } as never)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    expect(status(a)).toBe('open');
    expect(history(a)).toHaveLength(1);
    expect(execution(a)).toEqual([]);
  });

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

  it.each([
    { changedBy: '' },
    { changedBy: ' ' },
    { changedBy: 7 },
    {},
    { changedBy: 'bot-dev-1', reason: 7 },
    { changedBy: 'bot-dev-1', resultPath: 7 },
  ])('refuses %j as invalid, writing nothing', (input) => {
    const a = create('A');
    start(a);
    expect(
      tasks.finishTask({ id: a, status: 'succeeded', ...input } as never),
    ).toEqual({ ok: false, reason: 'invalid' });
    expect(status(a)).toBe('running');
    expect(history(a)).toHaveLength(2);
    expect(execution(a)).toEqual([
      { actor: 'bot-dev-1', log_path: null, result_path: null },
    ]);
  });

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
      createdBy: 'planner',
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

describe('the history and the execution', () => {
  // Covers AE6.
  it('records every change from creation, in order', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const a = create('A');
    now.mockReturnValue(1_700_000_001_000);
    start(a);
    now.mockReturnValue(1_700_000_002_000);
    finish(a, 'succeeded');
    expect(history(a)).toEqual([
      {
        from_status: null,
        to_status: 'open',
        changed_by: 'planner',
        reason: null,
        time_changed: 1_700_000_000_000,
      },
      {
        from_status: 'open',
        to_status: 'running',
        changed_by: 'orchestrator',
        reason: null,
        time_changed: 1_700_000_001_000,
      },
      {
        from_status: 'running',
        to_status: 'succeeded',
        changed_by: 'bot-dev-1',
        reason: null,
        time_changed: 1_700_000_002_000,
      },
    ]);
  });

  // Covers AE8.
  it('keeps who ran the task apart from who moved it, with its paths and the reason', () => {
    const now = vi.spyOn(Date, 'now');
    const a = create('A');
    now.mockReturnValue(1_700_000_001_000);
    tasks.startTask({
      id: a,
      changedBy: 'orchestrator',
      actor: 'bot-dev-1',
      logPath: 'logs/run-1.txt',
    });
    now.mockReturnValue(1_700_000_009_000);
    tasks.finishTask({
      id: a,
      changedBy: 'bot-dev-2',
      status: 'failed',
      reason: 'tests failed',
      resultPath: 'out/run-1',
    });
    expect(execution(a)).toEqual([
      {
        actor: 'bot-dev-1',
        log_path: 'logs/run-1.txt',
        result_path: 'out/run-1',
      },
    ]);
    // The execution started and ended with these two changes.
    expect(history(a).slice(1)).toEqual([
      {
        from_status: 'open',
        to_status: 'running',
        changed_by: 'orchestrator',
        reason: null,
        time_changed: 1_700_000_001_000,
      },
      {
        from_status: 'running',
        to_status: 'failed',
        changed_by: 'bot-dev-2',
        reason: 'tests failed',
        time_changed: 1_700_000_009_000,
      },
    ]);
  });

  it('stores no log or result path when none is given', () => {
    const a = create('A');
    moveTo(a, 'skipped');
    expect(execution(a)).toEqual([
      { actor: 'bot-dev-1', log_path: null, result_path: null },
    ]);
  });

  it('trims the names, the paths and the reason, and stores a blank one as null', () => {
    const a = create('A');
    const b = create('B');
    tasks.startTask({
      id: a,
      changedBy: ' orchestrator ',
      actor: ' bot-dev-1 ',
      logPath: ' logs/run-1.txt ',
    });
    tasks.finishTask({
      id: a,
      changedBy: ' bot-dev-2 ',
      status: 'skipped',
      reason: ' not needed ',
      resultPath: ' out/run-1 ',
    });
    tasks.startTask({
      id: b,
      changedBy: 'orchestrator',
      actor: 'bot-dev-1',
      logPath: '  ',
    });
    tasks.finishTask({
      id: b,
      changedBy: 'bot-dev-1',
      status: 'succeeded',
      reason: ' ',
      resultPath: ' ',
    });
    expect(execution(a)).toEqual([
      {
        actor: 'bot-dev-1',
        log_path: 'logs/run-1.txt',
        result_path: 'out/run-1',
      },
    ]);
    expect(
      history(a).map(({ changed_by, reason }) => ({ changed_by, reason })),
    ).toEqual([
      { changed_by: 'planner', reason: null },
      { changed_by: 'orchestrator', reason: null },
      { changed_by: 'bot-dev-2', reason: 'not needed' },
    ]);
    expect(execution(b)).toEqual([
      { actor: 'bot-dev-1', log_path: null, result_path: null },
    ]);
    expect(history(b)[2]).toMatchObject({ reason: null });
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

  it('is thrown from a start, which leaves the task open with no new change', () => {
    const a = create('A');
    // Fails the execution's insert, after the status and the change.
    connection().exec(
      "CREATE TRIGGER fail BEFORE INSERT ON execution BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END",
    );
    expect(() => start(a)).toThrow('disk I/O error');
    expect(status(a)).toBe('open');
    expect(history(a)).toHaveLength(1);
    expect(connection().isTransaction).toBe(false);
  });

  it('is thrown from a finish, which leaves the task running and its dependents held', () => {
    const a = create('A');
    const b = create('B');
    link(b, a);
    start(a);
    // Fails the result's update, after the status and the change.
    connection().exec(
      "CREATE TRIGGER fail BEFORE UPDATE ON execution BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END",
    );
    expect(() =>
      tasks.finishTask({
        id: a,
        changedBy: 'bot-dev-1',
        status: 'succeeded',
        resultPath: 'out/run-1',
      }),
    ).toThrow('disk I/O error');
    expect(status(a)).toBe('running');
    expect(history(a)).toHaveLength(2);
    expect(execution(a)).toEqual([
      { actor: 'bot-dev-1', log_path: null, result_path: null },
    ]);
    expect(counter(b)).toBe(1);
    expect(connection().isTransaction).toBe(false);
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

  it('keeps every counter equal to the holding blockers, no task past open held by one, and every change recorded', () => {
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
    // A task whose last change doesn't end in its state, or whose executions
    // don't match it: one once started, none before.
    const unrecorded = connection()
      .prepare(
        `SELECT task.id FROM task WHERE task.status IS NOT (
          SELECT to_status FROM status_change WHERE task_id = task.id
          ORDER BY id DESC LIMIT 1)
        OR (SELECT count(*) FROM execution WHERE task_id = task.id)
          <> (task.status <> 'open')`,
      )
      .all();
    expect(drift).toEqual([]);
    expect(heldPastOpen).toEqual([]);
    expect(unrecorded).toEqual([]);
    // The run exercised links, starts and every finish, not only refusals.
    expect(links().length).toBeGreaterThan(20);
    for (const to of ['succeeded', 'failed', 'skipped']) {
      expect(counts[to]).toBeGreaterThan(2);
    }
  });
});
