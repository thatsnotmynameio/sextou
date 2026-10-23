import { Database } from '@tursodatabase/database';
import { pino } from 'pino';
import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from 'vitest';
import { Reason } from '../../src/graph';
import { openTasks, type Tasks } from '../../src/open-tasks';
import { type FinalStatus, finalStatuses, Status } from '../../src/status';

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
  if (!result.ok) {
    throw new Error(`create ${title}: ${result.reason}`);
  }
  return result.task.id;
}

// The task's state changes, oldest first.
function history(id: string) {
  return connection().all(
    'SELECT from_status, to_status, changed_by, reason, time_changed FROM task_status_changes WHERE task_id = ? ORDER BY id',
    id,
  );
}

// The task's attempts, first to last.
function execution(id: string) {
  return connection().all(
    'SELECT actor, log_path, result_path FROM task_executions WHERE task_id = ? ORDER BY attempt',
    id,
  );
}

// The id of the task's latest attempt, or one no attempt has.
async function latest(id: string) {
  const row = await connection().get(
    'SELECT id FROM task_executions WHERE task_id = ? ORDER BY attempt DESC LIMIT 1',
    id,
  );
  return row === undefined ? 'exe_none' : String(row.id);
}

async function expiry(executionId: string) {
  return (
    await connection().get(
      'SELECT expires_at FROM task_executions WHERE id = ?',
      executionId,
    )
  )?.expires_at;
}

function cancelRequest(id: string) {
  return connection().get(
    'SELECT cancel_requested_by, cancel_reason FROM task_executions WHERE task_id = ? AND expires_at IS NOT NULL',
    id,
  );
}

// The lease every start and claim asks for, in milliseconds.
const lease = 30_000;

function link(taskId: string, blockerId: string) {
  return tasks.link({ taskId, blockerId });
}

function unlink(taskId: string, blockerId: string) {
  return tasks.unlink({ taskId, blockerId });
}

// Starts this task, if it is ready, through a claim only it answers: it is
// handed to an assignee of its own first, and back to its own when the claim
// finds it not ready. Returns the claim's result, or the refusal of the
// hand-over.
async function start(id: string) {
  const own = (
    await connection().get('SELECT assignee FROM tasks WHERE id = ?', id)
  )?.assignee;
  const only = `only-${id}`;
  const handed = await tasks.assignTask({
    id,
    assignee: only,
    changedBy: 'orchestrator',
  });
  if (!handed.ok) {
    return handed;
  }
  const result = await claim([only]);
  if (result.ok && result.task === null) {
    await tasks.assignTask({
      id,
      assignee: String(own),
      changedBy: 'orchestrator',
    });
  }
  return result;
}

// Starts the task and returns its attempt's id.
async function startedAttempt(id: string) {
  const result = await start(id);
  if (!result.ok || result.task === null) {
    throw new Error(`start ${id}`);
  }
  return result.execution.id;
}

// Finishes the task's latest attempt.
async function finish(id: string, status: FinalStatus) {
  return tasks.finishTask({
    executionId: await latest(id),
    changedBy: 'bot-dev-1',
    status,
  });
}

function claim(assignees = ['dev']) {
  return tasks.claimTask({ assignees, actor: 'bot-dev-1', leaseMs: lease });
}

function renew(executionId: string, leaseMs = lease) {
  return tasks.renewExecution({ executionId, leaseMs });
}

function expire(maxAttempts: number) {
  return tasks.expireExecutions({ maxAttempts, changedBy: 'server' });
}

// Starts a ready open task and, for a final state, finishes it.
async function moveTo(id: string, to: Status) {
  if (to === Status.open) {
    return;
  }
  await startedAttempt(id);
  if (to !== Status.running && !(await finish(id, to)).ok) {
    throw new Error(`finish ${id}`);
  }
}

async function ready(limit = 100, assignees = ['dev']) {
  const result = await tasks.listReady({ assignees, limit });
  if (!result.ok) {
    throw new Error(`ready: ${result.reason}`);
  }
  return result.tasks.map((task) => task.title);
}

beforeEach(async () => {
  exec = vi.spyOn(Database.prototype, 'exec');
  tasks = await openTasks(':memory:', { logger: pino({ level: 'silent' }) });
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
  for (let n = 0; n < 1000; n++) {
    ids.push(await create(`T${n}`));
  }
  expect(new Set(ids).size).toBe(1000);
  for (const id of ids) {
    expect(id).toMatch(/^tsk_/);
  }
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
  Status.cancelled,
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
test.each<Status>([
  Status.open,
  Status.running,
  Status.failed,
  Status.cancelled,
])('link links to a %s blocker, which holds the task', async (to) => {
  const a = await create('A');
  const b = await create('B');
  await moveTo(b, to);
  expect(await link(a, b)).toEqual({ ok: true });
  expect(await counter(a)).toBe(1);
  expect(await ready()).not.toContain('A');
});

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

test.each<Status>([Status.running, Status.failed, Status.cancelled])(
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
  Status.cancelled,
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

// Covers AE3.
test.each<Status>([
  Status.open,
  Status.running,
  Status.failed,
  Status.cancelled,
])(
  'claimTask skips a task that a %s blocker holds, which stays open',
  async (to) => {
    const a = await create('A');
    const b = await create('B');
    await link(b, a);
    await moveTo(a, to);
    expect(await start(b)).toEqual({ ok: true, task: null });
    expect(await status(b)).toBe(Status.open);
    expect(await history(b)).toHaveLength(1);
    expect(await execution(b)).toEqual([]);
  },
);

// Covers AE4.
test('claimTask hands out a task once', async () => {
  const a = await create('A');
  expect(await claim()).toMatchObject({ task: { id: a } });
  expect(await claim()).toEqual({ ok: true, task: null });
  expect(await status(a)).toBe(Status.running);
  expect(await history(a)).toHaveLength(2);
  expect(await execution(a)).toHaveLength(1);
});

test.each(finalStatuses)('claimTask never hands out a %s task', async (to) => {
  const a = await create('A');
  await moveTo(a, to);
  expect(await claim([`only-${a}`])).toEqual({ ok: true, task: null });
  expect(await status(a)).toBe(to);
});

test('claimTask accepts the longest lease', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  await create('A');
  expect(
    await tasks.claimTask({
      assignees: ['dev'],
      actor: 'bot',
      leaseMs: 2_147_483_647,
    }),
  ).toMatchObject({
    ok: true,
    execution: { expiresAt: 1_700_000_000_000 + 2_147_483_647 },
  });
});

test('claimTask starts the most urgent ready task of the assignees, then the oldest, until none is ready', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A', 2);
  await create('B', 1);
  await create('C', 0, undefined, 'qa');
  const d = await create('D', 1);
  await link(d, a);
  const first = await claim();
  expect(first).toEqual({
    ok: true,
    task: expect.objectContaining({ title: 'B', status: Status.running }),
    execution: {
      id: expect.stringMatching(/^exe_[0-9a-f]{32}$/),
      attempt: 1,
      expiresAt: 1_700_000_000_000 + lease,
    },
  });
  expect(await claim()).toMatchObject({ task: { id: a, title: 'A' } });
  // D waits for A, and C is qa's.
  expect(await claim()).toEqual({ ok: true, task: null });
  expect(await ready(100, ['qa'])).toEqual(['C']);
});

test('claimTask returns the whole task, now running', async () => {
  const created = await tasks.createTask({
    title: 'A',
    kind: 'task',
    priority: 2,
    assignee: 'dev',
    createdBy: 'planner',
    description: 'Parse the input.',
    sourcePath: './notes/task.md',
  });
  if (!created.ok) {
    throw new Error(`create: ${created.reason}`);
  }
  expect(await claim()).toMatchObject({
    task: { ...created.task, status: Status.running },
  });
});

test('claimTask records the actor as who started the task and who runs it', async () => {
  const a = await create('A');
  await tasks.claimTask({
    assignees: ['dev'],
    actor: ' runner-1 ',
    leaseMs: lease,
  });
  expect((await history(a))[1]).toMatchObject({
    from_status: Status.open,
    to_status: Status.running,
    changed_by: 'runner-1',
  });
  expect(await execution(a)).toEqual([
    { actor: 'runner-1', log_path: null, result_path: null },
  ]);
});

test('claimTask writes nothing when no task is ready', async () => {
  const a = await create('A', 2, undefined, 'qa');
  expect(await claim()).toEqual({ ok: true, task: null });
  expect(await status(a)).toBe(Status.open);
  expect(await history(a)).toHaveLength(1);
});

test('claimTask hands a task to one of two claims that run at once', async () => {
  const a = await create('A');
  const results = await Promise.all([claim(), claim()]);
  expect(results).toContainEqual({ ok: true, task: null });
  expect(results).toContainEqual(
    expect.objectContaining({ task: expect.objectContaining({ id: a }) }),
  );
  expect(await execution(a)).toHaveLength(1);
});

test('claimTask hands two tasks to two claims that run at once, one each', async () => {
  const a = await create('A');
  const b = await create('B');
  const results = await Promise.all([claim(), claim()]);
  expect(
    results.map((result) => (result.ok ? result.task?.id : undefined)).sort(),
  ).toEqual([a, b].sort());
});

test.each([
  { assignees: [] },
  { assignees: [''] },
  { assignees: 'dev' },
  { actor: '' },
  { actor: 7 },
  { leaseMs: 0 },
  { leaseMs: 2_147_483_648 },
])(
  `claimTask refuses %j as ${Reason.invalid}, writing nothing`,
  async (input) => {
    const a = await create('A');
    expect(
      await tasks.claimTask({
        assignees: ['dev'],
        actor: 'runner-1',
        leaseMs: lease,
        ...input,
      } as never),
    ).toEqual({ ok: false, reason: Reason.invalid });
    expect(await status(a)).toBe(Status.open);
  },
);

test('renewExecution pushes the lease to leaseMs from now', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  const executionId = await startedAttempt(a);
  now.mockReturnValue(1_700_000_010_000);
  expect(await renew(executionId, 5_000)).toEqual({
    ok: true,
    expiresAt: 1_700_000_015_000,
    cancelRequested: false,
  });
  expect(await expiry(executionId)).toBe(1_700_000_015_000);
});

test('renewExecution still renews a lease past its expiry that was not swept', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  const executionId = await startedAttempt(a);
  now.mockReturnValue(1_700_000_000_000 + lease * 2);
  expect(await renew(executionId)).toMatchObject({
    ok: true,
    expiresAt: 1_700_000_000_000 + lease * 3,
  });
});

test('renewExecution reports a cancel asked for while the task runs', async () => {
  const a = await create('A');
  const executionId = await startedAttempt(a);
  await tasks.cancelTask({ id: a, changedBy: 'planner' });
  expect(await renew(executionId)).toMatchObject({
    ok: true,
    cancelRequested: true,
  });
});

test(`renewExecution refuses an attempt that ended as ${Reason.leaseLost}`, async () => {
  const a = await create('A');
  const executionId = await startedAttempt(a);
  await finish(a, Status.succeeded);
  expect(await renew(executionId)).toEqual({
    ok: false,
    reason: Reason.leaseLost,
  });
  expect(await expiry(executionId)).toBeNull();
});

test(`renewExecution refuses an unknown attempt as ${Reason.leaseLost} and invalid input as ${Reason.invalid}`, async () => {
  expect(await renew('exe_missing')).toEqual({
    ok: false,
    reason: Reason.leaseLost,
  });
  expect(await renew(7 as never)).toEqual({
    ok: false,
    reason: Reason.invalid,
  });
  expect(await renew('exe_missing', 0)).toEqual({
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
test.each<FinalStatus>([Status.failed, Status.cancelled])(
  'finishTask keeps the tasks it blocks waiting when it finishes as %s, until unlinked',
  async (to) => {
    const a = await create('A');
    const b = await create('B');
    await link(b, a);
    await start(a);
    expect(await finish(a, to)).toEqual({ ok: true });
    expect(await status(a)).toBe(to);
    expect(await status(b)).toBe(Status.open);
    expect(await counter(b)).toBe(1);
    expect(await ready()).toEqual([]);
    await unlink(b, a);
    expect(await ready()).toEqual(['B']);
  },
);

test('finishTask ends the lease of the attempt it finishes', async () => {
  const a = await create('A');
  const executionId = await startedAttempt(a);
  await finish(a, Status.succeeded);
  expect(await expiry(executionId)).toBeNull();
});

// Covers AE5.
test(`finishTask refuses an attempt it doesn't know as ${Reason.leaseLost}`, async () => {
  const a = await create('A');
  await start(a);
  expect(
    await tasks.finishTask({
      executionId: 'exe_missing',
      changedBy: 'bot-dev-1',
      status: Status.succeeded,
    }),
  ).toEqual({ ok: false, reason: Reason.leaseLost });
  expect(await status(a)).toBe(Status.running);
});

// Covers AE6.
test(`finishTask refuses an attempt that already ended, in any state, as ${Reason.leaseLost}`, async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await moveTo(a, Status.succeeded);
  for (const to of finalStatuses) {
    expect(await finish(a, to)).toEqual({
      ok: false,
      reason: Reason.leaseLost,
    });
  }
  expect(await status(a)).toBe(Status.succeeded);
  expect(await counter(b)).toBe(0);
});

// The POC's case: a runner that lost its lease comes back after another
// took the task.
test(`finishTask refuses the attempt that lost its lease after another started, as ${Reason.leaseLost}`, async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  await claim();
  const lost = await latest(a);
  now.mockReturnValue(1_700_000_000_000 + lease);
  await expire(2);
  const current = await claim();
  expect(current).toMatchObject({ execution: { attempt: 2 } });
  expect(
    await tasks.finishTask({
      executionId: lost,
      changedBy: 'bot-dev-1',
      status: Status.failed,
    }),
  ).toEqual({ ok: false, reason: Reason.leaseLost });
  expect(await status(a)).toBe(Status.running);
  expect(await finish(a, Status.succeeded)).toEqual({ ok: true });
  expect(await status(a)).toBe(Status.succeeded);
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
    const executionId = await startedAttempt(a);
    expect(
      await tasks.finishTask({
        executionId,
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

test(`finishTask refuses a non-string attempt as ${Reason.invalid}`, async () => {
  expect(
    await tasks.finishTask({
      executionId: 7 as never,
      changedBy: 'bot-dev-1',
      status: Status.succeeded,
    }),
  ).toEqual({ ok: false, reason: Reason.invalid });
});

test('finishTask accepts any final state for a task someone asked to cancel', async () => {
  const a = await create('A');
  await start(a);
  await tasks.cancelTask({ id: a, changedBy: 'planner' });
  expect(await finish(a, Status.succeeded)).toEqual({ ok: true });
  expect(await status(a)).toBe(Status.succeeded);
});

test('cancelTask cancels an open task at once, out of the ready list, recording who and why', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  expect(
    await tasks.cancelTask({ id: a, changedBy: ' planner ', reason: ' dup ' }),
  ).toEqual({ ok: true, status: Status.cancelled });
  expect(await status(a)).toBe(Status.cancelled);
  expect(await ready()).toEqual([]);
  expect((await history(a))[1]).toEqual({
    from_status: Status.open,
    to_status: Status.cancelled,
    changed_by: 'planner',
    reason: 'dup',
    time_changed: 1_700_000_000_000,
  });
});

test('cancelTask keeps the tasks a cancelled task blocks waiting', async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await tasks.cancelTask({ id: a, changedBy: 'planner' });
  expect(await counter(b)).toBe(1);
  expect(await ready()).toEqual([]);
});

test('cancelTask cancels an open task that a blocker still holds', async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  expect(await tasks.cancelTask({ id: b, changedBy: 'planner' })).toEqual({
    ok: true,
    status: Status.cancelled,
  });
  await moveTo(a, Status.succeeded);
  expect(await counter(b)).toBe(0);
  expect(await ready()).toEqual([]);
});

test('cancelTask asks the one who runs a task to cancel it, which stays running', async () => {
  const a = await create('A');
  await start(a);
  expect(
    await tasks.cancelTask({ id: a, changedBy: 'planner', reason: 'dup' }),
  ).toEqual({ ok: true, status: Status.running });
  expect(await status(a)).toBe(Status.running);
  expect(await history(a)).toHaveLength(2);
  expect(await cancelRequest(a)).toEqual({
    cancel_requested_by: 'planner',
    cancel_reason: 'dup',
  });
});

test('cancelTask keeps the first request for a running task', async () => {
  const a = await create('A');
  await start(a);
  await tasks.cancelTask({ id: a, changedBy: 'planner', reason: 'dup' });
  expect(
    await tasks.cancelTask({ id: a, changedBy: 'ops', reason: 'other' }),
  ).toEqual({ ok: true, status: Status.running });
  expect(await cancelRequest(a)).toEqual({
    cancel_requested_by: 'planner',
    cancel_reason: 'dup',
  });
});

test.each(finalStatuses)(
  `cancelTask refuses a %s task as ${Reason.alreadyFinished}`,
  async (to) => {
    const a = await create('A');
    await moveTo(a, to);
    expect(await tasks.cancelTask({ id: a, changedBy: 'planner' })).toEqual({
      ok: false,
      reason: Reason.alreadyFinished,
    });
    expect(await status(a)).toBe(to);
  },
);

test.each([
  { changedBy: '' },
  { changedBy: 7 },
  {},
  { changedBy: 'planner', reason: 7 },
])(
  `cancelTask refuses %j as ${Reason.invalid}, writing nothing`,
  async (input) => {
    const a = await create('A');
    expect(await tasks.cancelTask({ id: a, ...input } as never)).toEqual({
      ok: false,
      reason: Reason.invalid,
    });
    expect(await status(a)).toBe(Status.open);
  },
);

test(`cancelTask refuses a missing task as ${Reason.notFound}`, async () => {
  expect(
    await tasks.cancelTask({ id: 'tsk_missing', changedBy: 'planner' }),
  ).toEqual({ ok: false, reason: Reason.notFound });
});

test('assignTask hands an open task to another assignee', async () => {
  const a = await create('A');
  expect(
    await tasks.assignTask({ id: a, assignee: ' qa ', changedBy: 'planner' }),
  ).toEqual({ ok: true });
  expect(await ready(100, ['dev'])).toEqual([]);
  expect(await ready(100, ['qa'])).toEqual(['A']);
});

test.each<Status>([
  Status.running,
  Status.succeeded,
  Status.failed,
  Status.skipped,
  Status.cancelled,
])(`assignTask refuses a %s task as ${Reason.notOpen}`, async (to) => {
  const a = await create('A');
  await moveTo(a, to);
  const assignee = () =>
    connection().get('SELECT assignee FROM tasks WHERE id = ?', a);
  const before = await assignee();
  expect(
    await tasks.assignTask({ id: a, assignee: 'qa', changedBy: 'planner' }),
  ).toEqual({ ok: false, reason: Reason.notOpen });
  expect(await assignee()).toEqual(before);
});

test.each([
  { assignee: '', changedBy: 'planner' },
  { assignee: 7, changedBy: 'planner' },
  { changedBy: 'planner' },
  { assignee: 'qa', changedBy: '' },
  { assignee: 'qa' },
])(`assignTask refuses %j as ${Reason.invalid}`, async (input) => {
  const a = await create('A');
  expect(await tasks.assignTask({ id: a, ...input } as never)).toEqual({
    ok: false,
    reason: Reason.invalid,
  });
  expect(await ready()).toEqual(['A']);
});

test(`assignTask refuses a missing task as ${Reason.notFound}`, async () => {
  expect(
    await tasks.assignTask({
      id: 'tsk_missing',
      assignee: 'qa',
      changedBy: 'planner',
    }),
  ).toEqual({ ok: false, reason: Reason.notFound });
});

test('expireExecutions fails a task whose lease expired on its last attempt, keeping the tasks it blocks waiting', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  const executionId = await startedAttempt(a);
  now.mockReturnValue(1_700_000_000_000 + lease);
  expect(await expire(1)).toEqual({ ok: true, expired: 1 });
  expect(await status(a)).toBe(Status.failed);
  expect((await history(a))[2]).toEqual({
    from_status: Status.running,
    to_status: Status.failed,
    changed_by: 'server',
    reason: 'lease expired',
    time_changed: 1_700_000_000_000 + lease,
  });
  expect(await expiry(executionId)).toBeNull();
  expect(await counter(b)).toBe(1);
  expect(await renew(executionId)).toEqual({
    ok: false,
    reason: Reason.leaseLost,
  });
});

test('expireExecutions opens a task again while attempts are left, then fails it', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await claim();
  now.mockReturnValue(1_700_000_000_000 + lease);
  expect(await expire(2)).toEqual({ ok: true, expired: 1 });
  expect(await status(a)).toBe(Status.open);
  expect(await ready()).toEqual(['A']);
  expect(await counter(b)).toBe(1);
  expect((await history(a))[2]).toMatchObject({
    from_status: Status.running,
    to_status: Status.open,
    changed_by: 'server',
    reason: 'lease expired',
  });
  expect(await claim()).toMatchObject({ execution: { attempt: 2 } });
  now.mockReturnValue(1_700_000_000_000 + lease * 2);
  expect(await expire(2)).toEqual({ ok: true, expired: 1 });
  expect(await status(a)).toBe(Status.failed);
  expect(await execution(a)).toHaveLength(2);
});

test('expireExecutions cancels a task someone asked to cancel, recording it as theirs', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  await start(a);
  await tasks.cancelTask({ id: a, changedBy: 'planner', reason: 'dup' });
  now.mockReturnValue(1_700_000_000_000 + lease);
  expect(await expire(3)).toEqual({ ok: true, expired: 1 });
  expect(await status(a)).toBe(Status.cancelled);
  expect((await history(a))[2]).toMatchObject({
    to_status: Status.cancelled,
    changed_by: 'planner',
    reason: 'dup',
  });
});

test('expireExecutions leaves a lease that has not expired, and expires one that ends now', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  await start(a);
  now.mockReturnValue(1_700_000_000_000 + lease - 1);
  expect(await expire(1)).toEqual({ ok: true, expired: 0 });
  expect(await status(a)).toBe(Status.running);
  now.mockReturnValue(1_700_000_000_000 + lease);
  expect(await expire(1)).toEqual({ ok: true, expired: 1 });
});

test('expireExecutions ends several expired leases in one call, and none of the finished', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  const b = await create('B');
  const c = await create('C');
  await start(a);
  await start(b);
  await moveTo(c, Status.succeeded);
  now.mockReturnValue(1_700_000_000_000 + lease);
  expect(await expire(1)).toEqual({ ok: true, expired: 2 });
  expect([await status(a), await status(b), await status(c)]).toEqual([
    Status.failed,
    Status.failed,
    Status.succeeded,
  ]);
});

test.each([
  { maxAttempts: 0, changedBy: 'server' },
  { maxAttempts: 1.5, changedBy: 'server' },
  { changedBy: 'server' },
  { maxAttempts: 1, changedBy: '' },
  { maxAttempts: 1 },
])(`expireExecutions refuses %j as ${Reason.invalid}`, async (input) => {
  expect(await tasks.expireExecutions(input as never)).toEqual({
    ok: false,
    reason: Reason.invalid,
  });
});

test('listReady lists the most urgent first, then the oldest, up to the limit', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  // Twenty tasks in one millisecond, with random ids: only the creation
  // order sorts them.
  const titles = Array.from({ length: 20 }, (_, n) => `P2-${n}`);
  for (const title of titles) {
    await create(title, 2);
  }
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
  if (!created.ok) {
    throw new Error(`create: ${created.reason}`);
  }
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
  'claimTask',
  'renewExecution',
  'finishTask',
  'cancelTask',
  'assignTask',
  'expireExecutions',
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
    prepare.mock.calls.find(([text]) => text.includes('holding_blockers'))?.[0],
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
  await claim();
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
      changed_by: 'bot-dev-1',
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
test('the execution keeps who ran the task apart from who finished it, with its result path and the reason', async () => {
  const now = vi.spyOn(Date, 'now');
  const a = await create('A');
  now.mockReturnValue(1_700_000_001_000);
  await claim();
  now.mockReturnValue(1_700_000_009_000);
  await tasks.finishTask({
    executionId: await latest(a),
    changedBy: 'bot-dev-2',
    status: Status.failed,
    reason: 'tests failed',
    resultPath: 'out/run-1',
  });
  expect(await execution(a)).toEqual([
    { actor: 'bot-dev-1', log_path: null, result_path: 'out/run-1' },
  ]);
  // The execution started and ended with these two changes.
  expect((await history(a)).slice(1)).toEqual([
    {
      from_status: Status.open,
      to_status: Status.running,
      changed_by: 'bot-dev-1',
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

test('the execution stores no result path when none is given', async () => {
  const a = await create('A');
  await moveTo(a, Status.skipped);
  expect(await execution(a)).toEqual([
    { actor: 'bot-dev-1', log_path: null, result_path: null },
  ]);
});

test('the history and the execution trim the names, the result path and the reason, and store a blank one as null', async () => {
  const a = await create('A');
  const b = await create('B');
  await tasks.claimTask({
    assignees: ['dev'],
    actor: ' bot-dev-1 ',
    leaseMs: lease,
  });
  await tasks.finishTask({
    executionId: await latest(a),
    changedBy: ' bot-dev-2 ',
    status: Status.skipped,
    reason: ' not needed ',
    resultPath: ' out/run-1 ',
  });
  await claim();
  await tasks.finishTask({
    executionId: await latest(b),
    changedBy: 'bot-dev-1',
    status: Status.succeeded,
    reason: ' ',
    resultPath: ' ',
  });
  expect(await execution(a)).toEqual([
    { actor: 'bot-dev-1', log_path: null, result_path: 'out/run-1' },
  ]);
  expect(
    (await history(a)).map(({ changed_by, reason }) => ({
      changed_by,
      reason,
    })),
  ).toEqual([
    { changed_by: 'planner', reason: null },
    { changed_by: 'bot-dev-1', reason: null },
    { changed_by: 'bot-dev-2', reason: 'not needed' },
  ]);
  expect(await execution(b)).toEqual([
    { actor: 'bot-dev-1', log_path: null, result_path: null },
  ]);
  expect((await history(b))[2]).toMatchObject({ reason: null });
});

// The error a failing trigger raises, as drizzle rejects with it: its own
// error, with Turso's on cause.
const diskError = {
  cause: { message: expect.stringContaining('disk I/O error') },
};

test('an error from SQLite is thrown, and the write it interrupted leaves nothing behind', async () => {
  const a = await create('A');
  const b = await create('B');
  // Fails the link's insert, after the counter has moved.
  await connection().exec(
    "CREATE TRIGGER fail BEFORE INSERT ON task_links BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END",
  );
  await expect(link(b, a)).rejects.toMatchObject(diskError);
  expect(await counter(b)).toBe(0);
  expect(await links()).toEqual([]);
  expect(connection().inTransaction).toBe(false);
  expect(await ready()).toEqual(['A', 'B']);
  await create('C');
  expect(await ready()).toEqual(['A', 'B', 'C']);
});

test('an error from SQLite is thrown from a claim, which leaves the task open and ready with no new change', async () => {
  const a = await create('A');
  // Fails the execution's insert, after the status and the change.
  await connection().exec(
    "CREATE TRIGGER fail BEFORE INSERT ON task_executions BEGIN SELECT RAISE(ABORT, 'disk I/O error'); END",
  );
  await expect(claim()).rejects.toMatchObject(diskError);
  expect(await status(a)).toBe(Status.open);
  expect(await ready()).toEqual(['A']);
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
      executionId: await latest(a),
      changedBy: 'bot-dev-1',
      status: Status.succeeded,
      resultPath: 'out/run-1',
    }),
  ).rejects.toMatchObject(diskError);
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

test('the graph after random operations keeps every counter equal to the holding blockers, no started task held by one, one lease per running task, and every change recorded', async () => {
  const next = random(42);
  const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)];
  let clock = 1_700_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  const running = `SELECT id FROM tasks WHERE status = '${Status.running}'`;
  const runningIds = async () =>
    (await connection().all(running)).map((row) => String(row.id));
  const ids = [await create('T0')];
  for (let step = 0; step < 600; step++) {
    const roll = next();
    if (roll < 0.2) {
      const assignee = pick(['dev', 'qa', 'ops']);
      ids.push(await create(`T${ids.length}`, 2, pick(ids), assignee));
    } else if (roll < 0.42) {
      await link(pick(ids), pick(ids));
    } else if (roll < 0.52) {
      await unlink(pick(ids), pick(ids));
    } else if (roll < 0.6) {
      await start(pick(ids));
    } else if (roll < 0.66) {
      await claim([pick(['dev', 'qa', 'ops'])]);
    } else if (roll < 0.8) {
      // Mostly a running task, so finishes happen; any task otherwise.
      const candidates = await runningIds();
      await finish(
        next() < 0.8 && candidates.length > 0 ? pick(candidates) : pick(ids),
        pick([...finalStatuses]),
      );
    } else if (roll < 0.86) {
      await tasks.cancelTask({ id: pick(ids), changedBy: 'planner' });
    } else if (roll < 0.92) {
      const candidates = await runningIds();
      if (candidates.length > 0) {
        await renew(await latest(pick(candidates)));
      }
    } else {
      clock += lease / 2;
      await expire(2);
    }
  }

  const holding = `blocker.status IN ('${Status.open}', '${Status.running}', '${Status.failed}', '${Status.cancelled}')`;
  const drift = await connection().all(
    `SELECT tasks.id FROM tasks WHERE tasks.holding_blockers <> (
        SELECT count(*) FROM task_links JOIN tasks AS blocker ON blocker.id = task_links.blocker_id
        WHERE task_links.task_id = tasks.id AND ${holding})`,
  );
  // A task opened again after its lease expired may be linked again, and a
  // cancelled one may have been held when it was cancelled; one that runs or
  // ran to its end was ready when it last started and gained no link since.
  const heldAfterStart = await connection().all(
    `SELECT task_links.task_id FROM task_links
      JOIN tasks ON tasks.id = task_links.task_id
      JOIN tasks AS blocker ON blocker.id = task_links.blocker_id
      WHERE ${holding} AND tasks.status IN ('${Status.running}', '${Status.succeeded}', '${Status.failed}', '${Status.skipped}')`,
  );
  const counts = Object.fromEntries(
    (
      await connection().all(
        'SELECT status, count(*) AS n FROM tasks GROUP BY status',
      )
    ).map((row) => [row.status, row.n]),
  );
  // A task whose last change doesn't end in its state, or whose leases don't
  // match it: one while running, none otherwise.
  const unrecorded = await connection().all(
    `SELECT tasks.id FROM tasks WHERE tasks.status IS NOT (
        SELECT to_status FROM task_status_changes WHERE task_id = tasks.id
        ORDER BY id DESC LIMIT 1)
      OR (SELECT count(*) FROM task_executions WHERE task_id = tasks.id AND expires_at IS NOT NULL)
        <> (tasks.status = '${Status.running}')`,
  );
  const retried = await connection().get(
    'SELECT count(*) AS n FROM task_executions WHERE attempt > 1',
  );
  expect(drift).toEqual([]);
  expect(heldAfterStart).toEqual([]);
  expect(unrecorded).toEqual([]);
  // The run exercised links, retries and every final state, not only
  // refusals.
  expect((await links()).length).toBeGreaterThan(20);
  expect(retried?.n).toBeGreaterThan(2);
  for (const to of finalStatuses) {
    expect(counts[to]).toBeGreaterThan(2);
  }
});
