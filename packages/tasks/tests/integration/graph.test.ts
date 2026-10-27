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

// Each claim names itself anew, unless the test sends one again.
let claims = 0;

function claim(assignees = ['dev'], claimId = `claim-${(claims += 1)}`) {
  return tasks.claimTask({
    claimId,
    assignees,
    actor: 'bot-dev-1',
    leaseMs: lease,
  });
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
      context: null,
      uses: null,
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

// The context a test stores with a task.
const context = { repo: 'org/app', sha: 'abc', depth: 1, lfs: false };

function createWithContext(title: string, value: unknown = context) {
  return tasks.createTask({
    title,
    kind: 'task',
    priority: 2,
    assignee: 'dev',
    createdBy: 'planner',
    context: value as never,
  });
}

// A context nested this many objects deep, counting itself.
function nested(depth: number) {
  let value: unknown = 1;
  for (let level = 0; level < depth; level += 1) {
    value = { a: value };
  }
  return value;
}

test('createTask stores a context nested as deep as Turso accepts', async () => {
  expect(await createWithContext('A', nested(500))).toMatchObject({
    ok: true,
  });
  expect(
    await connection().get('SELECT json_valid(context) AS valid FROM tasks'),
  ).toEqual({ valid: 1 });
});

test(`createTask refuses a context nested deeper than Turso accepts as ${Reason.invalid}, writing nothing`, async () => {
  expect(await createWithContext('A', nested(501))).toEqual({
    ok: false,
    reason: Reason.invalid,
  });
  expect(await rows()).toBe(0);
});

test('createTask keeps the context as given, stored as JSON', async () => {
  const result = await createWithContext('A');
  expect(result).toMatchObject({ ok: true, task: { context } });
  expect(
    await connection().get(
      "SELECT context ->> '$.repo' AS repo, json_type(context) AS type FROM tasks",
    ),
  ).toEqual({ repo: 'org/app', type: 'object' });
});

test('createTask stores a context left out as null', async () => {
  await create('A');
  expect(await connection().get('SELECT context FROM tasks')).toEqual({
    context: null,
  });
});

test('listReady returns the context of each ready task', async () => {
  await createWithContext('A');
  await create('B');
  expect(
    await tasks.listReady({ assignees: ['dev'], limit: 10 }),
  ).toMatchObject({
    ok: true,
    tasks: [
      { title: 'A', context },
      { title: 'B', context: null },
    ],
  });
});

test('claimTask hands out the task with its context', async () => {
  await createWithContext('A');
  expect(await claim()).toMatchObject({ ok: true, task: { context } });
});

const uses =
  'thatsnotmynameio/sextou/packages/workflows/hello-world/Taskfile.yml@87dfc7f4f839d6e334ab1a1cdf6494c62499d9ff';

/**
 * Creates a task that names a uses.
 * @param title the task's title
 * @param value the uses, of any type: hello-world's by default
 */
function createWithUses(title: string, value: unknown = uses) {
  return tasks.createTask({
    title,
    kind: 'task',
    priority: 2,
    assignee: 'dev',
    createdBy: 'planner',
    uses: value as never,
  });
}

test('createTask keeps the uses as given', async () => {
  expect(await createWithUses('A')).toMatchObject({
    ok: true,
    task: { uses },
  });
  expect(await connection().get('SELECT uses FROM tasks')).toEqual({ uses });
});

test('createTask stores a uses left out as null', async () => {
  await create('A');
  expect(await connection().get('SELECT uses FROM tasks')).toEqual({
    uses: null,
  });
});

test(`createTask refuses a uses whose ref is not a full commit SHA as ${Reason.invalid}, writing nothing`, async () => {
  expect(
    await createWithUses(
      'A',
      'thatsnotmynameio/sextou/packages/workflows/hello-world/Taskfile.yml@main',
    ),
  ).toEqual({ ok: false, reason: Reason.invalid });
  expect(await rows()).toBe(0);
});

test('claimTask hands out the task with its uses', async () => {
  await createWithUses('A');
  expect(await claim()).toMatchObject({ ok: true, task: { uses } });
});

test('claimTask hands out a task without a uses like any other, with a null uses', async () => {
  await create('A');
  expect(
    await tasks.listReady({ assignees: ['dev'], limit: 10 }),
  ).toMatchObject({ ok: true, tasks: [{ title: 'A', uses: null }] });
  expect(await claim()).toMatchObject({
    ok: true,
    task: { title: 'A', uses: null, status: Status.running },
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
  { title: 'A', kind: 'task', priority: 2, assignee: 'dev', context: ['x'] },
  { title: 'A', kind: 'task', priority: 2, assignee: 'dev', context: 'x' },
  { title: 'A', kind: 'task', priority: 2, assignee: 'dev', context: null },
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

// A task cancelled while open keeps its links, so a path back to the task can
// run through it.
test(`link refuses a link that closes a cycle through a task cancelled while open, as ${Reason.cycle}`, async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await tasks.cancelTask({ id: b, changedBy: 'planner' });
  expect(await link(a, b)).toEqual({ ok: false, reason: Reason.cycle });
  expect(await links()).toEqual([{ task_id: b, blocker_id: a }]);
  expect(await counter(a)).toBe(0);
});

test(`link refuses a longer cycle that runs through a cancelled task, as ${Reason.cycle}`, async () => {
  const a = await create('A');
  const b = await create('B');
  const c = await create('C');
  await link(b, a);
  await tasks.cancelTask({ id: b, changedBy: 'planner' });
  await link(c, b);
  expect(await link(a, c)).toEqual({ ok: false, reason: Reason.cycle });
  expect(await links()).toHaveLength(2);
  expect(await counter(a)).toBe(0);
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
      claimId: 'claim-1',
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

// Without its order, a claim would follow the ready index assignee by
// assignee, in name order: the task to take belongs to the later name.
test('claimTask starts the oldest ready task of its assignees at equal priority', async () => {
  const older = await create('Older', 2, undefined, 'qa');
  await create('Newer', 2, undefined, 'dev');
  expect(await claim(['dev', 'qa'])).toMatchObject({ task: { id: older } });
});

test('claimTask starts the most urgent ready task of its assignees before an older one', async () => {
  await create('Older', 2, undefined, 'alice');
  const urgent = await create('Urgent', 0, undefined, 'dev');
  expect(await claim(['alice', 'dev'])).toMatchObject({
    task: { id: urgent },
  });
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
    claimId: 'claim-1',
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
    new Set(results.map((result) => (result.ok ? result.task?.id : undefined))),
  ).toEqual(new Set([a, b]));
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
    cancelRequested: false,
  });
  expect(await expiry(executionId)).toBe(1_700_000_015_000);
});

test('renewExecution renews no other attempt', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  const b = await create('B');
  const renewed = await startedAttempt(a);
  const other = await startedAttempt(b);
  now.mockReturnValue(1_700_000_010_000);
  await renew(renewed);
  expect(await expiry(other)).toBe(1_700_000_000_000 + lease);
});

test('renewExecution still renews a lease past its expiry that was not swept', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  const executionId = await startedAttempt(a);
  now.mockReturnValue(1_700_000_000_000 + lease * 2);
  expect(await renew(executionId)).toMatchObject({ ok: true });
  expect(await expiry(executionId)).toBe(1_700_000_000_000 + lease * 3);
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
    expect(await finish(a, to)).toEqual({
      ok: true,
      status: to,
      reason: null,
      created: [],
    });
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
    expect(await finish(a, to)).toEqual({
      ok: true,
      status: to,
      reason: null,
      created: [],
    });
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

test('claimTask sent again with the same claim id answers the same attempt, its lease pushed, and starts nothing else', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  await create('B');
  const first = await claim(['dev'], 'claim-1');
  now.mockReturnValue(1_700_000_000_000 + 1_000);
  const again = await claim(['dev'], 'claim-1');
  expect(again).toEqual({
    ok: true,
    task: first.ok && first.task,
    execution: {
      id: await latest(a),
      attempt: 1,
      expiresAt: 1_700_000_000_000 + 1_000 + lease,
    },
  });
  expect(await expiry(await latest(a))).toBe(1_700_000_000_000 + 1_000 + lease);
  expect(await ready()).toEqual(['B']);
  expect(await history(a)).toHaveLength(2);
});

test('claimTask sent again once its attempt ended answers no task and starts none', async () => {
  const a = await create('A');
  await claim(['dev'], 'claim-1');
  await finish(a, Status.succeeded);
  await create('B');
  expect(await claim(['dev'], 'claim-1')).toEqual({ ok: true, task: null });
  expect(await ready()).toEqual(['B']);
});

test("claimTask takes another actor's claim id as a new claim", async () => {
  const a = await create('A');
  const b = await create('B');
  await claim(['dev'], 'claim-1');
  expect(
    await tasks.claimTask({
      claimId: 'claim-1',
      assignees: ['dev'],
      actor: 'bot-dev-2',
      leaseMs: lease,
    }),
  ).toMatchObject({ task: { id: b } });
  expect(await status(a)).toBe(Status.running);
});

test.each([{ claimId: '' }, { claimId: ' ' }, { claimId: 7 }, {}])(
  `claimTask refuses %j as ${Reason.invalid}, starting nothing`,
  async (input) => {
    const a = await create('A');
    expect(
      await tasks.claimTask({
        assignees: ['dev'],
        actor: 'bot',
        leaseMs: lease,
        ...input,
      } as never),
    ).toEqual({ ok: false, reason: Reason.invalid });
    expect(await status(a)).toBe(Status.open);
  },
);

test('finishTask sent again, the same finish, succeeds and changes nothing', async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  const executionId = await startedAttempt(a);
  const done = {
    executionId,
    changedBy: 'bot-dev-1',
    status: Status.succeeded,
    reason: 'done',
    resultPath: 'out/1',
  };
  await tasks.finishTask(done);
  const recorded = await history(a);
  expect(await tasks.finishTask({ ...done, reason: ' done ' })).toEqual({
    ok: true,
    status: Status.succeeded,
    reason: 'done',
    created: [],
  });
  expect(await history(a)).toEqual(recorded);
  expect(await counter(b)).toBe(0);
});

test.each([
  { changedBy: 'bot-dev-2' },
  { status: Status.failed },
  { reason: 'other' },
  { reason: undefined },
  { resultPath: 'out/2' },
  { resultPath: undefined },
])(
  `finishTask refuses a finish that differs from the one that ended the attempt, %j, as ${Reason.leaseLost}`,
  async (change) => {
    const a = await create('A');
    const executionId = await startedAttempt(a);
    const done = {
      executionId,
      changedBy: 'bot-dev-1',
      status: Status.succeeded,
      reason: 'done',
      resultPath: 'out/1',
    };
    await tasks.finishTask(done);
    expect(await tasks.finishTask({ ...done, ...change })).toEqual({
      ok: false,
      reason: Reason.leaseLost,
    });
  },
);

test(`finishTask refuses, as ${Reason.leaseLost}, the finish of an expired attempt that matches a later cancel of the open task`, async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  const executionId = await startedAttempt(a);
  now.mockReturnValue(1_700_000_000_000 + lease);
  await expire(2);
  await tasks.cancelTask({ id: a, changedBy: 'bot-dev-1' });
  expect(
    await tasks.finishTask({
      executionId,
      changedBy: 'bot-dev-1',
      status: Status.cancelled,
    }),
  ).toEqual({ ok: false, reason: Reason.leaseLost });
});

test(`finishTask refuses, as ${Reason.leaseLost}, the finish of an expired attempt that matches how a later attempt ended`, async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  const lost = await startedAttempt(a);
  now.mockReturnValue(1_700_000_000_000 + lease);
  await expire(2);
  await claim();
  await finish(a, Status.succeeded);
  expect(
    await tasks.finishTask({
      executionId: lost,
      changedBy: 'bot-dev-1',
      status: Status.succeeded,
    }),
  ).toEqual({ ok: false, reason: Reason.leaseLost });
});

test(`finishTask refuses the finish of an attempt the sweep ended, even one that matches its end, as ${Reason.leaseLost}`, async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  const executionId = await startedAttempt(a);
  now.mockReturnValue(1_700_000_000_000 + lease);
  await expire(1);
  expect(
    await tasks.finishTask({
      executionId,
      changedBy: 'server',
      status: Status.failed,
      reason: 'lease expired',
    }),
  ).toEqual({ ok: false, reason: Reason.leaseLost });
  expect(
    await tasks.finishTask({
      executionId,
      changedBy: 'bot-dev-1',
      status: Status.failed,
      reason: 'lease expired',
    }),
  ).toEqual({ ok: false, reason: Reason.leaseLost });
});

// Covers AE6.
test(`finishTask refuses an attempt that already ended, in any other state, as ${Reason.leaseLost}`, async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await moveTo(a, Status.succeeded);
  for (const to of finalStatuses.filter((to) => to !== Status.succeeded)) {
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
  expect(await finish(a, Status.succeeded)).toMatchObject({
    status: Status.succeeded,
  });
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
  expect(await finish(a, Status.succeeded)).toMatchObject({
    status: Status.succeeded,
  });
  expect(await status(a)).toBe(Status.succeeded);
});

// A task of a run's file of tasks, titled by its key, with what every task
// needs.
function fileTask(key: string, fields: object = {}) {
  return {
    key,
    title: key,
    kind: 'review',
    priority: 2,
    assignee: 'dev',
    ...fields,
  };
}

// The text of a file of tasks holding these.
function tasksFile(...file: object[]) {
  return JSON.stringify({ tasks: file });
}

// The limits a finish with a file of tasks gets unless a test sets its own.
const limits = { maxTasks: 50, maxDepth: 20 };

// The finish a runner sends for a task's latest attempt that succeeded and
// left this file of tasks.
async function succeededWith(id: string, text: string) {
  return {
    executionId: await latest(id),
    changedBy: 'bot-dev-1',
    status: Status.succeeded,
    tasks: text,
    ...limits,
  };
}

async function finishWith(id: string, text: string, own: object = {}) {
  return tasks.finishTask({ ...(await succeededWith(id, text)), ...own });
}

// The ids a finish's answer gives the tasks it created, by their keys.
function createdIds(result: Awaited<ReturnType<Tasks['finishTask']>>) {
  if (!result.ok) {
    throw new Error(`finish: ${result.reason}`);
  }
  return Object.fromEntries(result.created.map(({ key, id }) => [key, id]));
}

// The task's children, in the order they were created.
function children(id: string) {
  return connection().all(
    'SELECT id, title, status FROM tasks WHERE parent_id = ? ORDER BY rowid',
    id,
  );
}

// The ids of the task's blockers, sorted.
async function blockersOf(id: string) {
  return (
    await connection().all(
      'SELECT blocker_id FROM task_links WHERE task_id = ? ORDER BY blocker_id',
      id,
    )
  ).map((row) => String(row.blocker_id));
}

// The finish's answer for a file it refused, which fails the task.
function refusedFile(reason: string) {
  return { ok: true, status: Status.failed, reason, created: [] };
}

// Review, with Merge waiting for it, finished with a file of three lanes
// and synthesize, which waits for the lanes.
async function finishReview() {
  const review = await create('Review');
  const merge = await create('Merge');
  await link(merge, review);
  await start(review);
  const result = await finishWith(
    review,
    tasksFile(
      fileTask('security'),
      fileTask('perf'),
      fileTask('style'),
      fileTask('synthesize', { blockedBy: ['security', 'perf', 'style'] }),
    ),
  );
  return { review, merge, result, ids: createdIds(result) };
}

// Covers AE1.
test('finishTask creates the tasks of its file as children of the finished task', async () => {
  const { review, result, ids } = await finishReview();
  expect(result).toEqual({
    ok: true,
    status: Status.succeeded,
    reason: null,
    created: ['security', 'perf', 'style', 'synthesize'].map((key) => ({
      key,
      id: expect.stringMatching(/^tsk_[0-9a-f]{32}$/),
    })),
  });
  expect(await children(review)).toEqual(
    ['security', 'perf', 'style', 'synthesize'].map((key) => ({
      id: ids[key],
      title: key,
      status: Status.open,
    })),
  );
  expect(await status(review)).toBe(Status.succeeded);
  expect(await blockersOf(ids.synthesize)).toEqual(
    [ids.security, ids.perf, ids.style].sort(),
  );
  expect(await counter(ids.synthesize)).toBe(3);
  expect(await ready()).toEqual(['security', 'perf', 'style']);
});

// Covers AE1.
test("finishTask makes the finished task's dependent wait for the final task of its file", async () => {
  const { review, merge, ids } = await finishReview();
  expect(await blockersOf(merge)).toEqual([review, ids.synthesize].sort());
  expect(await counter(merge)).toBe(1);
});

test("finishTask keeps a dependent held through a second round the file's final task creates, until that round's last task succeeded", async () => {
  const { merge, ids } = await finishReview();
  for (const lane of [ids.security, ids.perf, ids.style]) {
    await moveTo(lane, Status.succeeded);
  }
  await startedAttempt(ids.synthesize);
  const second = createdIds(
    await finishWith(
      ids.synthesize,
      tasksFile(
        fileTask('recheck'),
        fileTask('synthesize-2', { blockedBy: ['recheck'] }),
      ),
    ),
  );
  expect(await status(ids.synthesize)).toBe(Status.succeeded);
  expect(await counter(merge)).toBe(1);
  expect(await ready()).toEqual(['recheck']);
  await moveTo(second.recheck, Status.succeeded);
  expect(await ready()).toEqual(['synthesize-2']);
  await moveTo(second['synthesize-2'], Status.succeeded);
  expect(await ready()).toEqual(['Merge']);
});

test('finishTask records the creation of each task of its file as the one who finished', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  await start(a);
  const ids = createdIds(
    await finishWith(a, tasksFile(fileTask('lint'), fileTask('test'))),
  );
  for (const id of [ids.lint, ids.test]) {
    expect(await history(id)).toEqual([
      {
        from_status: null,
        to_status: Status.open,
        changed_by: 'bot-dev-1',
        reason: null,
        time_changed: 1_700_000_000_000,
      },
    ]);
  }
});

test('finishTask stores each task of its file with the fields the file gives it, trimmed as createTask trims them', async () => {
  const a = await create('A');
  await start(a);
  const ids = createdIds(
    await finishWith(
      a,
      tasksFile(
        fileTask('lint', {
          title: ' Lint ',
          kind: ' check ',
          priority: 0,
          assignee: ' qa ',
          description: ' Run the linter ',
          source: ' docs/lint.md ',
          context: { repo: 'org/app', depth: 1 },
          uses,
        }),
        fileTask('test', { description: ' ', source: '' }),
      ),
    ),
  );
  expect(
    await connection().all(
      'SELECT id, title, kind, priority, parent_id, assignee, description, source_path, context, uses, status FROM tasks WHERE parent_id = ? ORDER BY rowid',
      a,
    ),
  ).toEqual([
    {
      id: ids.lint,
      title: 'Lint',
      kind: 'check',
      priority: 0,
      parent_id: a,
      assignee: 'qa',
      description: 'Run the linter',
      source_path: 'docs/lint.md',
      context: '{"repo":"org/app","depth":1}',
      uses,
      status: Status.open,
    },
    {
      id: ids.test,
      title: 'test',
      kind: 'review',
      priority: 2,
      parent_id: a,
      assignee: 'dev',
      description: null,
      source_path: null,
      context: null,
      uses: null,
      status: Status.open,
    },
  ]);
});

// A finished with a file whose build waits for fetch.
async function finishFetchBuild() {
  const a = await create('A');
  await start(a);
  return createdIds(
    await finishWith(
      a,
      tasksFile(fileTask('build', { blockedBy: ['fetch'] }), fileTask('fetch')),
    ),
  );
}

test('finishTask leaves a task of its file that waits for none ready', async () => {
  const ids = await finishFetchBuild();
  expect(await counter(ids.fetch)).toBe(0);
  expect(await ready()).toEqual(['fetch']);
});

test('finishTask holds a task of its file that waits for another until that one succeeded', async () => {
  const ids = await finishFetchBuild();
  expect(await counter(ids.build)).toBe(1);
  await moveTo(ids.fetch, Status.succeeded);
  expect(await ready()).toEqual(['build']);
});

test('finishTask makes each dependent wait for every task of a file whose tasks are all final, until each succeeded or was skipped', async () => {
  const a = await create('A');
  const b = await create('B');
  const c = await create('C');
  await link(b, a);
  await link(c, a);
  await start(a);
  const ids = createdIds(
    await finishWith(a, tasksFile(fileTask('one'), fileTask('two'))),
  );
  for (const dependent of [b, c]) {
    expect(await blockersOf(dependent)).toEqual([a, ids.one, ids.two].sort());
    expect(await counter(dependent)).toBe(2);
  }
  await moveTo(ids.one, Status.succeeded);
  expect(await ready()).toEqual(['two']);
  await moveTo(ids.two, Status.skipped);
  expect(await ready()).toEqual(['B', 'C']);
});

test('finishTask keeps a dependent held by its other open blocker once the finished task hands it over', async () => {
  const a = await create('A');
  const other = await create('Other');
  const b = await create('B');
  await link(b, a);
  await link(b, other);
  await start(a);
  const ids = createdIds(await finishWith(a, tasksFile(fileTask('lane'))));
  expect(await counter(b)).toBe(2);
  await moveTo(ids.lane, Status.succeeded);
  expect(await counter(b)).toBe(1);
  expect(await ready()).toEqual(['Other']);
});

test('finishTask gives a cancelled dependent no link to the tasks of its file', async () => {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await tasks.cancelTask({ id: b, changedBy: 'planner' });
  await start(a);
  await finishWith(a, tasksFile(fileTask('lane')));
  expect(await blockersOf(b)).toEqual([a]);
  expect(await counter(b)).toBe(0);
});

// Covers AE7.
test('finishTask leaves the tasks of a file held by a lane that failed until someone unlinks them', async () => {
  const review = await create('Review');
  const merge = await create('Merge');
  await link(merge, review);
  await start(review);
  const ids = createdIds(
    await finishWith(
      review,
      tasksFile(
        fileTask('security'),
        fileTask('perf'),
        fileTask('synthesize', { blockedBy: ['security', 'perf'] }),
      ),
    ),
  );
  await moveTo(ids.security, Status.failed);
  await moveTo(ids.perf, Status.succeeded);
  expect(await counter(ids.synthesize)).toBe(1);
  expect(await ready()).toEqual([]);
  await unlink(ids.synthesize, ids.security);
  expect(await ready()).toEqual(['synthesize']);
  await unlink(merge, ids.synthesize);
  expect(await ready()).toEqual(['Merge', 'synthesize']);
});

// Covers AE7.
test('finishTask leaves the dependent of a cancelled task of its file held by it', async () => {
  const review = await create('Review');
  const merge = await create('Merge');
  await link(merge, review);
  await start(review);
  const ids = createdIds(
    await finishWith(review, tasksFile(fileTask('synthesize'))),
  );
  await tasks.cancelTask({ id: ids.synthesize, changedBy: 'planner' });
  expect(await counter(merge)).toBe(1);
  expect(await ready()).toEqual([]);
});

// The files that hold no task.
const emptyFiles = ['', ' \n ', '{"tasks": []}'];

// A, with B waiting for it, finished with this file.
async function finishEmpty(text: string) {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await start(a);
  return finishWith(a, text, { reason: 'done' });
}

// Covers AE2.
test.each(emptyFiles)(
  'finishTask with the file %j finishes as succeeded, creating nothing',
  async (text) => {
    expect(await finishEmpty(text)).toEqual({
      ok: true,
      status: Status.succeeded,
      reason: 'done',
      created: [],
    });
    expect(await rows()).toBe(2);
  },
);

// Covers AE2.
test.each(emptyFiles)(
  'finishTask with the file %j frees the tasks it blocks',
  async (text) => {
    await finishEmpty(text);
    expect(await ready()).toEqual(['B']);
  },
);

// The final states other than succeeded, which take no file of tasks.
const unsucceeded: FinalStatus[] = [
  Status.failed,
  Status.cancelled,
  Status.skipped,
];

// A, finished in this state with a file of one task, and the answer.
async function finishUnsucceeded(to: FinalStatus) {
  const a = await create('A');
  await start(a);
  const result = await finishWith(a, tasksFile(fileTask('lane')), {
    status: to,
    reason: 'stopped',
  });
  return { a, result };
}

test.each(unsucceeded)(
  'finishTask as %s with a file of tasks records that state',
  async (to) => {
    const { a, result } = await finishUnsucceeded(to);
    expect(result).toEqual({
      ok: true,
      status: to,
      reason: 'stopped',
      created: [],
    });
    expect(await status(a)).toBe(to);
  },
);

test.each(unsucceeded)(
  'finishTask as %s with a file of tasks creates nothing',
  async (to) => {
    await finishUnsucceeded(to);
    expect(await rows()).toBe(1);
  },
);

// Review, with Merge waiting for it, finished with a file whose style task
// names a uses at a branch, and the answer.
async function finishBadUses() {
  const review = await create('Review');
  const merge = await create('Merge');
  await link(merge, review);
  await start(review);
  const result = await finishWith(
    review,
    tasksFile(
      fileTask('security'),
      fileTask('perf'),
      fileTask('style', { uses: 'org/app/Taskfile.yml@main' }),
    ),
    { reason: 'done' },
  );
  return { review, merge, result };
}

// Covers AE5.
test('finishTask fails the task over a task of its file whose uses has no full commit SHA, creating nothing', async () => {
  const { review, result } = await finishBadUses();
  expect(result).toEqual(
    refusedFile('tasks file: task "style" has no valid uses'),
  );
  expect(await status(review)).toBe(Status.failed);
  expect((await history(review)).at(-1)).toMatchObject({
    to_status: Status.failed,
    changed_by: 'bot-dev-1',
    reason: 'tasks file: task "style" has no valid uses',
  });
  expect(await rows()).toBe(2);
});

// Covers AE5.
test('finishTask keeps the dependents of a task it failed over a uses with no full commit SHA held', async () => {
  const { merge } = await finishBadUses();
  expect(await counter(merge)).toBe(1);
});

test('finishTask fails the task over a file that is not JSON, with a reason that quotes none of it', async () => {
  const a = await create('A');
  await start(a);
  expect(await finishWith(a, '{"tasks": [secret')).toEqual(
    refusedFile('tasks file: not JSON'),
  );
  expect(await rows()).toBe(1);
});

// Covers AE11.
test('finishTask fails the task over a field its file does not define, naming the field', async () => {
  const a = await create('A');
  await start(a);
  expect(
    await finishWith(
      a,
      tasksFile(fileTask('lint'), fileTask('test', { blocked_by: ['lint'] })),
    ),
  ).toEqual(
    refusedFile('tasks file: task "test" has the unknown field "blocked_by"'),
  );
  expect(await rows()).toBe(1);
});

test.each([
  [
    'a key two tasks have',
    tasksFile(fileTask('lint'), fileTask('test'), fileTask('lint')),
    'task "lint" repeats the key of an earlier task',
  ],
  [
    'a blocker no task in it has',
    tasksFile(fileTask('test', { blockedBy: ['lint'] })),
    'task "test" waits for a key no task in the file has',
  ],
  [
    'a blocker named twice by one task',
    tasksFile(
      fileTask('lint'),
      fileTask('test', { blockedBy: ['lint', 'lint'] }),
    ),
    'task "test" waits for the same key twice',
  ],
  [
    'two tasks that wait for each other',
    tasksFile(
      fileTask('lint', { blockedBy: ['test'] }),
      fileTask('test', { blockedBy: ['lint'] }),
    ),
    'task "lint" waits for itself through its links',
  ],
  [
    'a task that waits for itself',
    tasksFile(fileTask('lint'), fileTask('test', { blockedBy: ['test'] })),
    'task "test" waits for itself through its links',
  ],
  [
    'a cycle behind a task that waits for it',
    tasksFile(
      fileTask('merge', { blockedBy: ['test'] }),
      fileTask('lint'),
      fileTask('test', { blockedBy: ['build', 'lint'] }),
      fileTask('build', { blockedBy: ['test'] }),
    ),
    'task "test" waits for itself through its links',
  ],
  ['a list for a file', '[]', 'not an object with a list of tasks'],
  ['no list of tasks', '{}', 'not an object with a list of tasks'],
  [
    'a field the file does not define',
    JSON.stringify({ tasks: [], version: 1 }),
    'has the unknown field "version"',
  ],
  [
    'a long unknown field',
    JSON.stringify({ tasks: [fileTask('lint', { ['x'.repeat(65)]: 1 })] }),
    'task "lint" has an unknown field',
  ],
  [
    'an unknown field as long as a reason quotes',
    JSON.stringify({ tasks: [fileTask('lint', { ['x'.repeat(64)]: 1 })] }),
    `task "lint" has the unknown field "${'x'.repeat(64)}"`,
  ],
  [
    'a task that is null',
    JSON.stringify({ tasks: [fileTask('lint'), null] }),
    'task 2 is not an object',
  ],
  [
    'a task that is not an object',
    JSON.stringify({ tasks: [fileTask('lint'), 'test'] }),
    'task 2 is not an object',
  ],
  [
    'a task without a title',
    JSON.stringify({ tasks: [{ ...fileTask('lint'), title: undefined }] }),
    'task "lint" has no valid title',
  ],
  [
    'a task with a blank key',
    tasksFile(fileTask('lint'), fileTask(' ')),
    'task 2 has no valid key',
  ],
  [
    'a task whose key is too long to quote',
    tasksFile(fileTask('k'.repeat(65), { priority: 9 })),
    'task 1 has no valid priority',
  ],
  [
    'a task whose key is as long as a reason quotes',
    tasksFile(fileTask('k'.repeat(64), { priority: 9 })),
    `task "${'k'.repeat(64)}" has no valid priority`,
  ],
])(
  'finishTask fails the task over a file with %s, creating nothing',
  async (_name, text, why) => {
    const a = await create('A');
    await start(a);
    expect(await finishWith(a, text)).toEqual(
      refusedFile(`tasks file: ${why}`),
    );
    expect(await rows()).toBe(1);
  },
);

// Covers AE6.
test('finishTask fails the task over a file with more tasks than maxTasks, creating nothing', async () => {
  const a = await create('A');
  await start(a);
  expect(
    await finishWith(
      a,
      tasksFile(fileTask('one'), fileTask('two'), fileTask('three')),
      { maxTasks: 2 },
    ),
  ).toEqual(refusedFile('tasks file: 3 tasks, more than the limit of 2'));
  expect(await rows()).toBe(1);
});

test('finishTask creates a file of exactly maxTasks tasks', async () => {
  const a = await create('A');
  await start(a);
  const result = await finishWith(
    a,
    tasksFile(fileTask('one'), fileTask('two')),
    { maxTasks: 2 },
  );
  expect(result).toMatchObject({ status: Status.succeeded });
  expect(await rows()).toBe(3);
});

// Covers AE6.
test.each([
  { parents: 0, maxDepth: 1, created: true },
  { parents: 2, maxDepth: 3, created: true },
  { parents: 2, maxDepth: 2, created: false },
  { parents: 3, maxDepth: 2, created: false },
])(
  'finishTask with a file, for a task under $parents parents and a maxDepth of $maxDepth, creates its tasks: $created',
  async ({ parents, maxDepth, created }) => {
    let parent: string | undefined;
    for (let level = 0; level < parents; level++) {
      parent = await create(`P${level}`, 2, parent);
    }
    const a = await create('A', 2, parent);
    await start(a);
    const result = await finishWith(a, tasksFile(fileTask('lane')), {
      maxDepth,
    });
    expect(result).toEqual(
      created
        ? expect.objectContaining({ status: Status.succeeded })
        : refusedFile(
            `tasks file: its tasks would sit deeper than the limit of ${maxDepth}`,
          ),
    );
    expect(await children(a)).toHaveLength(created ? 1 : 0);
  },
);

// Covers AE4.
test('finishTask sent again with the same file answers the tasks it created, creating none', async () => {
  const review = await create('Review');
  const merge = await create('Merge');
  await link(merge, review);
  await start(review);
  const done = await succeededWith(
    review,
    tasksFile(
      fileTask('style'),
      fileTask('security'),
      fileTask('synthesize', { blockedBy: ['style', 'security'] }),
    ),
  );
  const first = await tasks.finishTask(done);
  expect(await tasks.finishTask(done)).toEqual(first);
  expect(await rows()).toBe(5);
  expect(await counter(merge)).toBe(1);
  expect(await history(review)).toHaveLength(3);
});

// Covers AE8.
test('finishTask sent again with a file it refused answers the same failure', async () => {
  const a = await create('A');
  await start(a);
  const done = await succeededWith(
    a,
    tasksFile(fileTask('lint'), fileTask('lint')),
  );
  await tasks.finishTask(done);
  expect(await tasks.finishTask(done)).toEqual(
    refusedFile('tasks file: task "lint" repeats the key of an earlier task'),
  );
  expect(await status(a)).toBe(Status.failed);
  expect(await history(a)).toHaveLength(3);
});

test.each([
  { tasks: tasksFile(fileTask('other')) },
  { tasks: '' },
  { tasks: undefined },
  { status: Status.failed },
  { reason: 'other' },
  { changedBy: 'bot-dev-2' },
  { resultPath: 'out/2' },
])(
  `finishTask refuses a finish that differs from the one with a file that ended the attempt, %j, as ${Reason.leaseLost}`,
  async (change) => {
    const a = await create('A');
    await start(a);
    const done = await succeededWith(a, tasksFile(fileTask('lane')));
    await tasks.finishTask(done);
    expect(await tasks.finishTask({ ...done, ...change })).toEqual({
      ok: false,
      reason: Reason.leaseLost,
    });
    expect(await rows()).toBe(2);
  },
);

// A, with B waiting for it, which someone asked to cancel while it ran, and
// the finish with a file of one task its runner sends.
async function cancelledWithFile() {
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await start(a);
  await tasks.cancelTask({ id: a, changedBy: 'planner', reason: 'dropped' });
  return { a, b, done: await succeededWith(a, tasksFile(fileTask('lane'))) };
}

// Covers AE9.
test('finishTask with a file for a task someone asked to cancel creates nothing', async () => {
  const { done } = await cancelledWithFile();
  await tasks.finishTask(done);
  expect(await rows()).toBe(2);
});

// Covers AE9.
test('finishTask with a file for a task someone asked to cancel cancels it as theirs', async () => {
  const { a, b, done } = await cancelledWithFile();
  const answer = {
    ok: true,
    status: Status.cancelled,
    reason: 'dropped',
    created: [],
  };
  expect(await tasks.finishTask(done)).toEqual(answer);
  expect(await status(a)).toBe(Status.cancelled);
  expect((await history(a)).at(-1)).toMatchObject({
    from_status: Status.running,
    to_status: Status.cancelled,
    changed_by: 'planner',
    reason: 'dropped',
  });
  expect(await counter(b)).toBe(1);
  expect(await tasks.finishTask(done)).toEqual(answer);
});

test('finishTask with a file that is not JSON, for a task someone asked to cancel, cancels it', async () => {
  const a = await create('A');
  await start(a);
  await tasks.cancelTask({ id: a, changedBy: 'planner' });
  expect(await finishWith(a, 'not json')).toEqual({
    ok: true,
    status: Status.cancelled,
    reason: null,
    created: [],
  });
});

test.each([undefined, '', '{"tasks": []}'])(
  'finishTask with the file %j, for a task someone asked to cancel, finishes as sent',
  async (text) => {
    const a = await create('A');
    await start(a);
    await tasks.cancelTask({ id: a, changedBy: 'planner' });
    expect(await finishWith(a, text as never, { reason: 'done' })).toEqual({
      ok: true,
      status: Status.succeeded,
      reason: 'done',
      created: [],
    });
    expect(await status(a)).toBe(Status.succeeded);
  },
);

test('finishTask past the timeout rolls back every task and link of its file', async () => {
  await tasks.close();
  exec.mockClear();
  // Each read of the clock is 1 ms after the last: a finish that records
  // four creations and its end reads it past the timeout.
  let clock = 0;
  tasks = await openTasks(':memory:', {
    logger: pino({ level: 'silent' }),
    now: () => (clock += 1),
    timeoutMs: 5,
  });
  const a = await create('A');
  const b = await create('B');
  await link(b, a);
  await start(a);
  expect(
    await finishWith(
      a,
      tasksFile(
        fileTask('one'),
        fileTask('two'),
        fileTask('three'),
        fileTask('four', { blockedBy: ['one'] }),
      ),
    ),
  ).toEqual({ ok: false, reason: Reason.timeout });
  expect(await rows()).toBe(2);
  expect(await links()).toEqual([{ task_id: b, blocker_id: a }]);
  expect(await status(a)).toBe(Status.running);
  expect(
    await connection().get('SELECT count(*) AS n FROM task_execution_tasks'),
  ).toEqual({ n: 0 });
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

test('cancelTask sent again, the same cancel of an open task, succeeds and changes nothing', async () => {
  const a = await create('A');
  await tasks.cancelTask({ id: a, changedBy: 'planner', reason: 'dropped' });
  const recorded = await history(a);
  expect(
    await tasks.cancelTask({ id: a, changedBy: 'planner', reason: 'dropped' }),
  ).toEqual({ ok: true, status: Status.cancelled });
  expect(await history(a)).toEqual(recorded);
});

test('cancelTask sent again after the sweep cancelled the running task succeeds', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  await startedAttempt(a);
  await tasks.cancelTask({ id: a, changedBy: 'planner', reason: 'dropped' });
  now.mockReturnValue(1_700_000_000_000 + lease);
  await expire(1);
  expect(
    await tasks.cancelTask({ id: a, changedBy: 'planner', reason: 'dropped' }),
  ).toEqual({ ok: true, status: Status.cancelled });
});

test.each([
  { changedBy: 'reviewer', reason: 'dropped' },
  { changedBy: 'planner', reason: 'other' },
  { changedBy: 'planner' },
])(
  `cancelTask refuses a cancel that differs from the one that cancelled the task, %j, as ${Reason.alreadyFinished}`,
  async (cancel) => {
    const a = await create('A');
    await tasks.cancelTask({ id: a, changedBy: 'planner', reason: 'dropped' });
    expect(await tasks.cancelTask({ id: a, ...cancel })).toEqual({
      ok: false,
      reason: Reason.alreadyFinished,
    });
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
  expect(await expire(1)).toEqual({
    ok: true,
    expired: [{ taskId: a, executionId, attempt: 1, status: Status.failed }],
  });
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
  const first = await latest(a);
  now.mockReturnValue(1_700_000_000_000 + lease);
  expect(await expire(2)).toEqual({
    ok: true,
    expired: [
      { taskId: a, executionId: first, attempt: 1, status: Status.open },
    ],
  });
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
  const second = await latest(a);
  now.mockReturnValue(1_700_000_000_000 + lease * 2);
  expect(await expire(2)).toEqual({
    ok: true,
    expired: [
      { taskId: a, executionId: second, attempt: 2, status: Status.failed },
    ],
  });
  expect(await status(a)).toBe(Status.failed);
  expect(await execution(a)).toHaveLength(2);
});

test('expireExecutions cancels a task someone asked to cancel, recording it as theirs', async () => {
  const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  const a = await create('A');
  await start(a);
  await tasks.cancelTask({ id: a, changedBy: 'planner', reason: 'dup' });
  now.mockReturnValue(1_700_000_000_000 + lease);
  expect(await expire(3)).toEqual({
    ok: true,
    expired: [
      {
        taskId: a,
        executionId: await latest(a),
        attempt: 1,
        status: Status.cancelled,
      },
    ],
  });
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
  expect(await expire(1)).toEqual({ ok: true, expired: [] });
  expect(await status(a)).toBe(Status.running);
  now.mockReturnValue(1_700_000_000_000 + lease);
  expect(await expire(1)).toMatchObject({
    expired: [{ taskId: a, status: Status.failed }],
  });
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
  const result = await expire(1);
  expect(
    result.ok && result.expired.map(({ taskId }) => taskId).toSorted(),
  ).toEqual([a, b].toSorted());
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
    claimId: ' claim-1 ',
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
