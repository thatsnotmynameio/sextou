import { Database } from '@tursodatabase/database';
import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from 'vitest';
import { Reason } from './graph';
import { openTasks, type Tasks } from './open-tasks';
import { type FinalStatus, finalStatuses, Status } from './status';

let tasks: Tasks;
let exec: MockInstance<Database['exec']>;

// The connection openTasks opened, to read what the graph stored.
function connection() {
  return exec.mock.contexts[0] as Database;
}

async function counter(id: string) {
  return (
    await connection().get(
      'SELECT holding_blockers FROM tasks WHERE id = ?',
      id,
    )
  )?.holding_blockers;
}

async function status(id: string) {
  return (await connection().get('SELECT status FROM tasks WHERE id = ?', id))
    ?.status;
}

function links() {
  return connection().all(
    'SELECT task_id, blocker_id FROM task_links ORDER BY task_id, blocker_id',
  );
}

async function rows() {
  return (await connection().get('SELECT count(*) AS n FROM tasks'))?.n;
}

async function create(
  title: string,
  priority = 2,
  parentId?: string,
  assignee = 'dev',
) {
  const result = await tasks.createTask({
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
  return connection().all(
    'SELECT from_status, to_status, changed_by, reason, time_changed FROM task_status_changes WHERE task_id = ? ORDER BY id',
    id,
  );
}

// The task's execution, as a list of at most one row.
function execution(id: string) {
  return connection().all(
    'SELECT actor, log_path, result_path FROM task_executions WHERE task_id = ?',
    id,
  );
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
async function moveTo(id: string, to: Status) {
  if (to === Status.open) return;
  if (!(await start(id)).ok) throw new Error(`start ${id}`);
  if (to !== Status.running && !(await finish(id, to)).ok)
    throw new Error(`finish ${id}`);
}

async function ready(limit = 100, assignees = ['dev']) {
  const result = await tasks.listReady({ assignees, limit });
  if (!result.ok) throw new Error(`ready: ${result.reason}`);
  return result.tasks.map((task) => task.title);
}

beforeEach(async () => {
  exec = vi.spyOn(Database.prototype, 'exec');
  tasks = await openTasks(':memory:');
});

afterEach(async () => {
  await tasks.close();
  vi.restoreAllMocks();
});

test('Reason gives each reason its own value', () => {
  const values = Object.values(Reason);
  expect(new Set(values).size).toBe(values.length);
});

test('createTask creates an open task that is ready, recording who created it and when', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const result = await tasks.createTask({
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
      status: Status.open,
    },
  });
  expect(await ready()).toEqual(['Write the parser']);
  expect(await history(result.ok ? result.task.id : '')).toEqual([
    {
      from_status: null,
      to_status: Status.open,
      changed_by: 'planner',
      reason: null,
      time_changed: 1_700_000_000_000,
    },
  ]);
});

test('createTask keeps the description and source path, trimmed at the ends only', async () => {
  const result = await tasks.createTask({
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
    await connection().get(
      'SELECT assignee, description, source_path FROM tasks',
    ),
  ).toEqual({
    assignee: 'dev',
    description: 'Parse the input.\n\nThen print it.',
    source_path: 'https://github.com/o/r/issues/1',
  });
});

test('createTask stores a file path as the source path, as given', async () => {
  const result = await tasks.createTask({
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

test('createTask stores a blank description or source path as null', async () => {
  const blankDescription = await tasks.createTask({
    title: 'A',
    kind: 'task',
    priority: 2,
    assignee: 'dev',
    createdBy: 'planner',
    description: '   ',
  });
  const blankSource = await tasks.createTask({
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

test('createTask stores an empty description as null', async () => {
  const result = await tasks.createTask({
    title: 'A',
    kind: 'task',
    priority: 2,
    assignee: 'dev',
    createdBy: 'planner',
    description: '',
  });
  expect(result).toMatchObject({ ok: true, task: { description: null } });
  expect(await connection().get('SELECT description FROM tasks')).toEqual({
    description: null,
  });
});

test('createTask stores the title, the kind and the assignee trimmed', async () => {
  await tasks.createTask({
    title: '  Write the parser ',
    kind: ' task ',
    priority: 2,
    assignee: '  dev ',
    createdBy: 'planner',
  });
  expect(
    await connection().get('SELECT title, kind, assignee FROM tasks'),
  ).toEqual({ title: 'Write the parser', kind: 'task', assignee: 'dev' });
});

test.each([
  { title: '', kind: 'task', priority: 2, assignee: 'dev' },
  { title: '   ', kind: 'task', priority: 2, assignee: 'dev' },
  { title: 'A', kind: '', priority: 2, assignee: 'dev' },
  { title: 'A', kind: ' ', priority: 2, assignee: 'dev' },
  { title: 'A', kind: 'task', priority: 5, assignee: 'dev' },
  { title: 'A', kind: 'task', priority: -1, assignee: 'dev' },
  { title: 'A', kind: 'task', priority: 1.5, assignee: 'dev' },
  { title: 'A', kind: 'task', priority: 7, assignee: 'dev' },
  { title: 'A', kind: 'task', priority: 2, assignee: 'dev', parentId: 7 },
  { title: 'A', kind: 'task', priority: 2, assignee: 'dev', parentId: null },
  { title: 'A', kind: 'task', priority: 2, assignee: 'dev', description: null },
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
])(
  `createTask refuses %j as ${Reason.invalid}, writing nothing`,
  async (input) => {
    expect(
      await tasks.createTask({ createdBy: 'planner', ...input } as never),
    ).toEqual({ ok: false, reason: Reason.invalid });
    expect(await rows()).toBe(0);
    expect(await connection().all('SELECT * FROM task_status_changes')).toEqual(
      [],
    );
  },
);

test(`createTask refuses a missing parent as ${Reason.notFound}, writing nothing`, async () => {
  expect(
    await tasks.createTask({
      title: 'A',
      kind: 'task',
      priority: 2,
      parentId: 'tsk_missing',
      assignee: 'dev',
      createdBy: 'planner',
    }),
  ).toEqual({ ok: false, reason: Reason.notFound });
  expect(await ready()).toEqual([]);
});

test('createTask accepts a child of a finished parent', async () => {
  const parent = await create('Parent');
  await moveTo(parent, Status.failed);
  const result = await tasks.createTask({
    title: 'Child',
    kind: 'task',
    priority: 2,
    parentId: parent,
    assignee: 'dev',
    createdBy: 'planner',
  });
  expect(result).toMatchObject({ ok: true, task: { parentId: parent } });
});

test('createTask accepts any label as the kind', async () => {
  const result = await tasks.createTask({
    title: 'A',
    kind: 'initiative',
    priority: 0,
    assignee: 'dev',
    createdBy: 'planner',
  });
  expect(result).toMatchObject({ ok: true, task: { kind: 'initiative' } });
});

// Covers AE6: a parent only organizes.
test('createTask keeps a parent and its open children ready when nothing links them', async () => {
  const issue = await create('Issue');
  await create('Child 1', 2, issue);
  await create('Child 2', 2, issue);
  expect(await ready()).toEqual(['Issue', 'Child 1', 'Child 2']);
});

// A thousand writes, one transaction each: about a second alone, and up to
// eight when every package's suite runs at once (`pnpm -r test:unit`, as
// the pre-push hook does), past Vitest's five-second default.
test('createTask gives a thousand tasks a thousand distinct ids', async () => {
  const ids: string[] = [];
  for (let n = 0; n < 1000; n++) ids.push(await create(`T${n}`));
  expect(new Set(ids).size).toBe(1000);
  for (const id of ids) expect(id).toMatch(/^tsk_/);
}, 30_000);

test('link takes a task blocked by an open task out of the ready list', async () => {
  const a = await create('A');
  const b = await create('B');
  expect(await link(b, a)).toEqual({ ok: true });
  expect(await ready()).toEqual(['A']);
  expect(await counter(b)).toBe(1);
});

// Covers AE1.
test('link refuses a link that closes a cycle, leaving links and counters', async () => {
  const a = await create('A');
  const b = await create('B');
  const c = await create('C');
  await link(b, a);
  await link(c, b);
  expect(await link(a, c)).toEqual({ ok: false, reason: Reason.cycle });
  expect(connection().inTransaction).toBe(false);
  expect(await links()).toHaveLength(2);
  expect(await links()).toEqual(
    expect.arrayContaining([
      { task_id: b, blocker_id: a },
      { task_id: c, blocker_id: b },
    ]),
  );
  expect([await counter(a), await counter(b), await counter(c)]).toEqual([
    0, 1, 1,
  ]);
});

test(`link refuses a task blocked by itself as ${Reason.sameTask}`, async () => {
  const a = await create('A');
  expect(await link(a, a)).toEqual({ ok: false, reason: Reason.sameTask });
  expect(await links()).toEqual([]);
});

test(`link refuses a missing task on either side as ${Reason.notFound}`, async () => {
  const a = await create('A');
  expect(await link(a, 'tsk_missing')).toEqual({
    ok: false,
    reason: Reason.notFound,
  });
  expect(await link('tsk_missing', a)).toEqual({
    ok: false,
    reason: Reason.notFound,
  });
  expect(await links()).toEqual([]);
});

test(`link refuses an empty id as ${Reason.notFound}`, async () => {
  const a = await create('A');
  expect(await link(a, '')).toEqual({ ok: false, reason: Reason.notFound });
  expect(await links()).toEqual([]);
});

test(`link refuses an id that is not a string as ${Reason.invalid}`, async () => {
  const a = await create('A');
  expect(await link(a, 7 as never)).toEqual({
    ok: false,
    reason: Reason.invalid,
  });
  expect(await link(7 as never, a)).toEqual({
    ok: false,
    reason: Reason.invalid,
  });
});

test('link changes nothing for a pair already linked, even once both finished', async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  expect(await link(b, a)).toEqual({ ok: true });
  expect(await counter(b)).toBe(1);
  await moveTo(a, Status.succeeded);
  await moveTo(b, Status.succeeded);
  expect(await link(b, a)).toEqual({ ok: true });
  expect(await counter(b)).toBe(0);
  expect(await links()).toEqual([{ task_id: b, blocker_id: a }]);
});

test.each<Status>([
  Status.running,
  Status.succeeded,
  Status.failed,
  Status.skipped,
])(`link refuses a %s task as ${Reason.notOpen}`, async (to) => {
  const a = await create('A');
  const b = await create('B');
  await moveTo(b, to);
  expect(await link(b, a)).toEqual({ ok: false, reason: Reason.notOpen });
  expect(await links()).toEqual([]);
});

// Covers AE7.
test.each<Status>([Status.succeeded, Status.skipped])(
  'link links to a %s blocker without holding the task',
  async (to) => {
    const a = await create('A');
    const b = await create('B');
    await moveTo(b, to);
    expect(await link(a, b)).toEqual({ ok: true });
    expect(await counter(a)).toBe(0);
    expect(await ready()).toEqual(['A']);
  },
);

// Covers AE7.
test.each<Status>([Status.open, Status.running, Status.failed])(
  'link links to a %s blocker, which holds the task',
  async (to) => {
    const a = await create('A');
    const b = await create('B');
    await moveTo(b, to);
    expect(await link(a, b)).toEqual({ ok: true });
    expect(await counter(a)).toBe(1);
    expect(await ready()).not.toContain('A');
  },
);

test('unlink makes a task ready once its only open blocker is unlinked', async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  expect(await unlink(b, a)).toEqual({ ok: true });
  expect(await counter(b)).toBe(0);
  expect(await ready()).toEqual(['A', 'B']);
});

test('unlink changes nothing for a pair that is not linked', async () => {
  const a = await create('A');
  const b = await create('B');
  const c = await create('C');
  await link(b, a);
  expect(await unlink(b, c)).toEqual({ ok: true });
  expect(await counter(b)).toBe(1);
});

test.each<Status>([Status.succeeded, Status.skipped])(
  'unlink unlinks a %s blocker without moving the counter',
  async (to) => {
    const a = await create('A');
    const b = await create('B');
    const c = await create('C');
    await link(c, a);
    await link(c, b);
    await moveTo(a, to);
    expect(await unlink(c, a)).toEqual({ ok: true });
    expect(await counter(c)).toBe(1);
  },
);

test.each<Status>([Status.running, Status.failed])(
  'unlink makes a task ready once its %s blocker is unlinked',
  async (to) => {
    const a = await create('A');
    const b = await create('B');
    await link(b, a);
    await moveTo(a, to);
    expect(await unlink(b, a)).toEqual({ ok: true });
    expect(await counter(b)).toBe(0);
    expect(await ready()).toEqual(['B']);
  },
);

test.each<Status>([
  Status.running,
  Status.succeeded,
  Status.failed,
  Status.skipped,
])(
  `unlink refuses a %s task as ${Reason.notOpen}, keeping the link`,
  async (to) => {
    const a = await create('A');
    const b = await create('B');
    await link(b, a);
    await moveTo(a, Status.succeeded);
    await moveTo(b, to);
    expect(await unlink(b, a)).toEqual({ ok: false, reason: Reason.notOpen });
    expect(await links()).toEqual([{ task_id: b, blocker_id: a }]);
  },
);

test(`unlink refuses a missing task as ${Reason.notFound} and a non-string id as ${Reason.invalid}`, async () => {
  const a = await create('A');
  expect(await unlink(a, 'tsk_missing')).toEqual({
    ok: false,
    reason: Reason.notFound,
  });
  expect(await unlink(a, null as never)).toEqual({
    ok: false,
    reason: Reason.invalid,
  });
});

test('startTask moves a ready task to running, out of the ready list', async () => {
  const a = await create('A');
  expect(await start(a)).toEqual({ ok: true });
  expect(await status(a)).toBe(Status.running);
  expect(await ready()).toEqual([]);
});

// Covers AE3.
test.each<Status>([Status.open, Status.running, Status.failed])(
  `startTask refuses a task with a %s blocker as ${Reason.blocked}, which stays open`,
  async (to) => {
    const a = await create('A');
    const b = await create('B');
    await link(b, a);
    await moveTo(a, to);
    expect(await start(b)).toEqual({ ok: false, reason: Reason.blocked });
    expect(await status(b)).toBe(Status.open);
    expect(await history(b)).toHaveLength(1);
    expect(await execution(b)).toEqual([]);
  },
);

// Covers AE4.
test(`startTask refuses a task already started as ${Reason.notOpen}`, async () => {
  const a = await create('A');
  expect(await start(a)).toEqual({ ok: true });
  expect(await start(a)).toEqual({ ok: false, reason: Reason.notOpen });
  expect(await status(a)).toBe(Status.running);
  expect(await history(a)).toHaveLength(2);
  expect(await execution(a)).toHaveLength(1);
});

test('startTask starts a task once when two starts run at once', async () => {
  const a = await create('A');
  const results = await Promise.all([start(a), start(a)]);
  expect(results).toEqual(
    expect.arrayContaining([
      { ok: true },
      { ok: false, reason: Reason.notOpen },
    ]),
  );
  expect(await execution(a)).toHaveLength(1);
  expect(await history(a)).toHaveLength(2);
});

test.each<Status>([Status.succeeded, Status.failed, Status.skipped])(
  `startTask refuses a %s task as ${Reason.notOpen}`,
  async (to) => {
    const a = await create('A');
    await moveTo(a, to);
    expect(await start(a)).toEqual({ ok: false, reason: Reason.notOpen });
    expect(await status(a)).toBe(to);
  },
);

test.each([
  { changedBy: '', actor: 'bot' },
  { changedBy: ' ', actor: 'bot' },
  { changedBy: 7, actor: 'bot' },
  { actor: 'bot' },
  { changedBy: 'orchestrator', actor: '' },
  { changedBy: 'orchestrator', actor: ' ' },
  { changedBy: 'orchestrator', actor: 7 },
  { changedBy: 'orchestrator' },
  { changedBy: 'orchestrator', actor: 'bot', logPath: 7 },
])(
  `startTask refuses %j as ${Reason.invalid}, writing nothing`,
  async (input) => {
    const a = await create('A');
    expect(await tasks.startTask({ id: a, ...input } as never)).toEqual({
      ok: false,
      reason: Reason.invalid,
    });
    expect(await status(a)).toBe(Status.open);
    expect(await history(a)).toHaveLength(1);
    expect(await execution(a)).toEqual([]);
  },
);

test(`startTask refuses a missing task as ${Reason.notFound} and a non-string id as ${Reason.invalid}`, async () => {
  expect(await start('tsk_missing')).toEqual({
    ok: false,
    reason: Reason.notFound,
  });
  expect(await start(undefined as never)).toEqual({
    ok: false,
    reason: Reason.invalid,
  });
});

// Covers AE1.
test.each<FinalStatus>([Status.succeeded, Status.skipped])(
  'finishTask frees the tasks it blocks when it finishes as %s',
  async (to) => {
    const a = await create('A');
    const b = await create('B');
    const c = await create('C');
    await link(c, a);
    await link(c, b);
    await start(a);
    expect(await finish(a, to)).toEqual({ ok: true });
    expect(await status(a)).toBe(to);
    expect(await ready()).toEqual(['B']);
    await moveTo(b, to);
    expect(await ready()).toEqual(['C']);
  },
);

// Covers AE2.
test('finishTask keeps the tasks it blocks waiting when it fails, until unlinked', async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await start(a);
  expect(await finish(a, Status.failed)).toEqual({ ok: true });
  expect(await status(a)).toBe(Status.failed);
  expect(await status(b)).toBe(Status.open);
  expect(await counter(b)).toBe(1);
  expect(await ready()).toEqual([]);
  await unlink(b, a);
  expect(await ready()).toEqual(['B']);
});

// Covers AE5.
test.each(finalStatuses)(
  `finishTask refuses to finish an open task as %s, as ${Reason.notRunning}`,
  async (to) => {
    const a = await create('A');
    expect(await finish(a, to)).toEqual({
      ok: false,
      reason: Reason.notRunning,
    });
    expect(await status(a)).toBe(Status.open);
  },
);

// Covers AE6.
test('finishTask refuses to finish a finished task again, in any state', async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await moveTo(a, Status.succeeded);
  for (const to of finalStatuses) {
    expect(await finish(a, to)).toEqual({
      ok: false,
      reason: Reason.notRunning,
    });
  }
  expect(await status(a)).toBe(Status.succeeded);
  expect(await counter(b)).toBe(0);
});

test.each([Status.open, Status.running, 'closed', undefined, 7])(
  `finishTask refuses %j as the final state as ${Reason.invalid}`,
  async (to) => {
    const a = await create('A');
    await start(a);
    expect(await finish(a, to as never)).toEqual({
      ok: false,
      reason: Reason.invalid,
    });
    expect(await status(a)).toBe(Status.running);
  },
);

test.each([
  { changedBy: '' },
  { changedBy: ' ' },
  { changedBy: 7 },
  {},
  { changedBy: 'bot-dev-1', reason: 7 },
  { changedBy: 'bot-dev-1', resultPath: 7 },
])(
  `finishTask refuses %j as ${Reason.invalid}, writing nothing`,
  async (input) => {
    const a = await create('A');
    await start(a);
    expect(
      await tasks.finishTask({
        id: a,
        status: Status.succeeded,
        ...input,
      } as never),
    ).toEqual({ ok: false, reason: Reason.invalid });
    expect(await status(a)).toBe(Status.running);
    expect(await history(a)).toHaveLength(2);
    expect(await execution(a)).toEqual([
      { actor: 'bot-dev-1', log_path: null, result_path: null },
    ]);
  },
);

test(`finishTask refuses a missing task as ${Reason.notFound} and a non-string id as ${Reason.invalid}`, async () => {
  expect(await finish('tsk_missing', Status.succeeded)).toEqual({
    ok: false,
    reason: Reason.notFound,
  });
  expect(await finish(7 as never, Status.succeeded)).toEqual({
    ok: false,
    reason: Reason.invalid,
  });
});

test('listReady lists the most urgent first, then the oldest, up to the limit', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  // Twenty tasks in one millisecond, with random ids: only the creation
  // order sorts them.
  const titles = Array.from({ length: 20 }, (_, n) => `P2-${n}`);
  for (const title of titles) await create(title, 2);
  await create('P0', 0);
  await create('P1', 1);
  expect(await ready(100)).toEqual(['P0', 'P1', ...titles]);
  expect(await ready(3)).toEqual(['P0', 'P1', 'P2-0']);
});

test('listReady returns whole tasks', async () => {
  const created = await tasks.createTask({
    title: 'A',
    kind: 'task',
    priority: 2,
    assignee: 'dev',
    createdBy: 'planner',
    description: 'Parse the input.',
    sourcePath: './notes/task.md',
  });
  if (!created.ok) throw new Error(`create: ${created.reason}`);
  expect(await tasks.listReady({ assignees: ['dev'], limit: 1 })).toEqual({
    ok: true,
    tasks: [created.task],
  });
});

test("listReady merges the assignees' ready tasks into one list and leaves out the rest", async () => {
  await create('A', 2, undefined, 'dev');
  await create('B', 1, undefined, 'bot-dev-1');
  await create('C', 0, undefined, 'qa');
  expect(await ready(100, ['bot-dev-1', 'dev'])).toEqual(['B', 'A']);
});

test('listReady matches the assignee exactly', async () => {
  await create('A', 2, undefined, 'dev');
  expect(await ready(100, ['Dev'])).toEqual([]);
  expect(await ready(100, ['dev-1'])).toEqual([]);
});

test('listReady orders two assignees by creation across both, up to the limit', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const titles = Array.from({ length: 6 }, (_, n) => `T${n}`);
  for (const [n, title] of titles.entries()) {
    await create(title, 2, undefined, ['dev', 'qa'][n % 2]);
  }
  expect(await ready(100, ['qa', 'dev'])).toEqual(titles);
  expect(await ready(3, ['qa', 'dev'])).toEqual(['T0', 'T1', 'T2']);
});

test('listReady trims the assignees asked for and returns a task once', async () => {
  await create('A');
  expect(await ready(100, [' dev '])).toEqual(['A']);
  expect(await ready(100, ['dev', 'dev'])).toEqual(['A']);
});

// Each case sits in an array of its own: test.each spreads an array case
// into the arguments, which would hand listReady its first item.
test.each([[[]], [undefined], ['dev'], [['']], [['  ']], [[7]]])(
  `listReady refuses %j as the assignees as ${Reason.invalid}`,
  async (assignees) => {
    expect(await tasks.listReady({ assignees, limit: 1 } as never)).toEqual({
      ok: false,
      reason: Reason.invalid,
    });
  },
);

test.each([0, -1, 1.5, Number.NaN])(
  `listReady refuses a limit of %d as ${Reason.invalid}`,
  async (limit) => {
    expect(await tasks.listReady({ assignees: ['dev'], limit })).toEqual({
      ok: false,
      reason: Reason.invalid,
    });
  },
);

test.each([
  'createTask',
  'link',
  'unlink',
  'startTask',
  'finishTask',
  'listReady',
] as const)(`%s refuses null as ${Reason.invalid}`, async (operation) => {
  expect(await tasks[operation](null as never)).toEqual({
    ok: false,
    reason: Reason.invalid,
  });
});

test('listReady merges three assignees into one list, in the same order', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const titles = Array.from({ length: 9 }, (_, n) => `T${n}`);
  for (const [n, title] of titles.entries()) {
    await create(title, n % 2, undefined, ['dev', 'qa', 'ops'][n % 3]);
  }
  expect(await ready(100, ['ops', 'qa', 'dev'])).toEqual([
    'T0',
    'T2',
    'T4',
    'T6',
    'T8',
    'T1',
    'T3',
    'T5',
    'T7',
  ]);
  expect(await ready(4, ['qa', 'dev', 'ops'])).toEqual([
    'T0',
    'T2',
    'T4',
    'T6',
  ]);
});

test('listReady searches the ready index by assignee, with no table scan', async () => {
  const prepare = vi.spyOn(Database.prototype, 'prepare');
  await tasks.listReady({ assignees: ['dev', 'qa'], limit: 10 });
  const sql = String(
    prepare.mock.calls.find(([text]) =>
      text.includes('holding_blockers = 0'),
    )?.[0],
  );
  const plan = await connection().all(
    `EXPLAIN QUERY PLAN ${sql}`,
    'dev',
    'qa',
    10,
  );
  // The sort covers only the rows the search found.
  expect(plan.map((row) => String(row.detail))).toEqual([
    'SEARCH tasks USING INDEX task_ready (assignee=?)',
    'USE SORTER FOR ORDER BY',
  ]);
});

// Covers AE6.
test('the history records every change from creation, in order', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  now.mockReturnValue(1_700_000_001_000);
  await start(a);
  now.mockReturnValue(1_700_000_002_000);
  await finish(a, Status.succeeded);
  expect(await history(a)).toEqual([
    {
      from_status: null,
      to_status: Status.open,
      changed_by: 'planner',
      reason: null,
      time_changed: 1_700_000_000_000,
    },
    {
      from_status: Status.open,
      to_status: Status.running,
      changed_by: 'orchestrator',
      reason: null,
      time_changed: 1_700_000_001_000,
    },
    {
      from_status: Status.running,
      to_status: Status.succeeded,
      changed_by: 'bot-dev-1',
      reason: null,
      time_changed: 1_700_000_002_000,
    },
  ]);
});

// Covers AE8.
test('the execution keeps who ran the task apart from who moved it, with its paths and the reason', async () => {
  const now = vi.spyOn(Date, 'now');
  const a = await create('A');
  now.mockReturnValue(1_700_000_001_000);
  await tasks.startTask({
    id: a,
    changedBy: 'orchestrator',
    actor: 'bot-dev-1',
    logPath: 'logs/run-1.txt',
  });
  now.mockReturnValue(1_700_000_009_000);
  await tasks.finishTask({
    id: a,
    changedBy: 'bot-dev-2',
    status: Status.failed,
    reason: 'tests failed',
    resultPath: 'out/run-1',
  });
  expect(await execution(a)).toEqual([
    {
      actor: 'bot-dev-1',
      log_path: 'logs/run-1.txt',
      result_path: 'out/run-1',
    },
  ]);
  // The execution started and ended with these two changes.
  expect((await history(a)).slice(1)).toEqual([
    {
      from_status: Status.open,
      to_status: Status.running,
      changed_by: 'orchestrator',
      reason: null,
      time_changed: 1_700_000_001_000,
    },
    {
      from_status: Status.running,
      to_status: Status.failed,
      changed_by: 'bot-dev-2',
      reason: 'tests failed',
      time_changed: 1_700_000_009_000,
    },
  ]);
});

test('the execution stores no log or result path when none is given', async () => {
  const a = await create('A');
  await moveTo(a, Status.skipped);
  expect(await execution(a)).toEqual([
    { actor: 'bot-dev-1', log_path: null, result_path: null },
  ]);
});

test('the history and the execution trim the names, the paths and the reason, and store a blank one as null', async () => {
  const a = await create('A');
  const b = await create('B');
  await tasks.startTask({
    id: a,
    changedBy: ' orchestrator ',
    actor: ' bot-dev-1 ',
    logPath: ' logs/run-1.txt ',
  });
  await tasks.finishTask({
    id: a,
    changedBy: ' bot-dev-2 ',
    status: Status.skipped,
    reason: ' not needed ',
    resultPath: ' out/run-1 ',
  });
  await tasks.startTask({
    id: b,
    changedBy: 'orchestrator',
    actor: 'bot-dev-1',
    logPath: '  ',
  });
  await tasks.finishTask({
    id: b,
    changedBy: 'bot-dev-1',
    status: Status.succeeded,
    reason: ' ',
    resultPath: ' ',
  });
  expect(await execution(a)).toEqual([
    {
      actor: 'bot-dev-1',
      log_path: 'logs/run-1.txt',
      result_path: 'out/run-1',
    },
  ]);
  expect(
    (await history(a)).map(({ changed_by, reason }) => ({
      changed_by,
      reason,
    })),
  ).toEqual([
    { changed_by: 'planner', reason: null },
    { changed_by: 'orchestrator', reason: null },
    { changed_by: 'bot-dev-2', reason: 'not needed' },
  ]);
  expect(await execution(b)).toEqual([
    { actor: 'bot-dev-1', log_path: null, result_path: null },
  ]);
  expect((await history(b))[2]).toMatchObject({ reason: null });
});

test('an error from SQLite is thrown, and the write it interrupted leaves nothing behind', async () => {
  const a = await create('A');
  const b = await create('B');
  // Fails the link's insert, after the counter has moved.
  await connection().exec(
    "CREATE TRIGGER fail BEFORE INSERT ON task_links BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END",
  );
  await expect(link(b, a)).rejects.toThrow('disk I/O error');
  expect(await counter(b)).toBe(0);
  expect(await links()).toEqual([]);
  expect(connection().inTransaction).toBe(false);
  expect(await ready()).toEqual(['A', 'B']);
  await create('C');
  expect(await ready()).toEqual(['A', 'B', 'C']);
});

test('an error from SQLite is thrown from a start, which leaves the task open with no new change', async () => {
  const a = await create('A');
  // Fails the execution's insert, after the status and the change.
  await connection().exec(
    "CREATE TRIGGER fail BEFORE INSERT ON task_executions BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END",
  );
  await expect(start(a)).rejects.toThrow('disk I/O error');
  expect(await status(a)).toBe(Status.open);
  expect(await history(a)).toHaveLength(1);
  expect(connection().inTransaction).toBe(false);
});

test('an error from SQLite is thrown from a finish, which leaves the task running and its dependents held', async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await start(a);
  // Fails the result's update, after the status and the change.
  await connection().exec(
    "CREATE TRIGGER fail BEFORE UPDATE ON task_executions BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END",
  );
  await expect(
    tasks.finishTask({
      id: a,
      changedBy: 'bot-dev-1',
      status: Status.succeeded,
      resultPath: 'out/run-1',
    }),
  ).rejects.toThrow('disk I/O error');
  expect(await status(a)).toBe(Status.running);
  expect(await history(a)).toHaveLength(2);
  expect(await execution(a)).toEqual([
    { actor: 'bot-dev-1', log_path: null, result_path: null },
  ]);
  expect(await counter(b)).toBe(1);
  expect(connection().inTransaction).toBe(false);
});

// A fixed seed, so a failure replays.
function random(seed: number) {
  return () => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
}

test('the graph after random operations keeps every counter equal to the holding blockers, no task past open held by one, and every change recorded', async () => {
  const next = random(42);
  const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)];
  const running = `SELECT id FROM tasks WHERE status = '${Status.running}'`;
  const ids = [await create('T0')];
  for (let step = 0; step < 400; step++) {
    const roll = next();
    if (roll < 0.25) {
      const assignee = pick(['dev', 'qa', 'ops']);
      ids.push(await create(`T${ids.length}`, 2, pick(ids), assignee));
    } else if (roll < 0.55) await link(pick(ids), pick(ids));
    else if (roll < 0.7) await unlink(pick(ids), pick(ids));
    else if (roll < 0.85) await start(pick(ids));
    else {
      // Mostly a running task, so finishes happen; any task otherwise.
      const candidates = (await connection().all(running)).map((row) =>
        String(row.id),
      );
      await finish(
        next() < 0.8 && candidates.length > 0 ? pick(candidates) : pick(ids),
        pick([...finalStatuses]),
      );
    }
  }

  const holding = `blocker.status IN ('${Status.open}', '${Status.running}', '${Status.failed}')`;
  const drift = await connection().all(
    `SELECT tasks.id FROM tasks WHERE tasks.status = '${Status.open}' AND tasks.holding_blockers <> (
        SELECT count(*) FROM task_links JOIN tasks AS blocker ON blocker.id = task_links.blocker_id
        WHERE task_links.task_id = tasks.id AND ${holding})`,
  );
  const heldPastOpen = await connection().all(
    `SELECT task_links.task_id FROM task_links
      JOIN tasks ON tasks.id = task_links.task_id
      JOIN tasks AS blocker ON blocker.id = task_links.blocker_id
      WHERE tasks.status <> '${Status.open}' AND ${holding}`,
  );
  const counts = Object.fromEntries(
    (
      await connection().all(
        'SELECT status, count(*) AS n FROM tasks GROUP BY status',
      )
    ).map((row) => [row.status, row.n]),
  );
  // A task whose last change doesn't end in its state, or whose executions
  // don't match it: one once started, none before.
  const unrecorded = await connection().all(
    `SELECT tasks.id FROM tasks WHERE tasks.status IS NOT (
        SELECT to_status FROM task_status_changes WHERE task_id = tasks.id
        ORDER BY id DESC LIMIT 1)
      OR (SELECT count(*) FROM task_executions WHERE task_id = tasks.id)
        <> (tasks.status <> '${Status.open}')`,
  );
  expect(drift).toEqual([]);
  expect(heldPastOpen).toEqual([]);
  expect(unrecorded).toEqual([]);
  // The run exercised links, starts and every finish, not only refusals.
  expect((await links()).length).toBeGreaterThan(20);
  for (const to of finalStatuses) {
    expect(counts[to]).toBeGreaterThan(2);
  }
});
