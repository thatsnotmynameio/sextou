import { fc, test } from '@fast-check/vitest';
import { Database } from '@tursodatabase/database';
import { pino } from 'pino';
import { afterEach, expect, vi } from 'vitest';
import { openTasks } from '../../src/open-tasks';
import { type FinalStatus, finalStatuses, Status } from '../../src/status';

// The experiment's take on graph.test.ts's random operations: the same
// operations and invariants, drawn by fast-check, which shrinks a failing
// sequence to its shortest. Each run opens a graph of its own.

const lease = 30_000;
const assignees = ['dev', 'qa', 'ops'] as const;

// A task by its position among those created so far.
const index = fc.nat({ max: 1_000 });
const assignee = fc.constantFrom(...assignees);

const operation = fc.oneof(
  {
    weight: 20,
    arbitrary: fc.record({
      kind: fc.constant('create'),
      parent: index,
      assignee,
    }),
  },
  {
    weight: 22,
    arbitrary: fc.record({
      kind: fc.constant('link'),
      task: index,
      blocker: index,
    }),
  },
  {
    weight: 10,
    arbitrary: fc.record({
      kind: fc.constant('unlink'),
      task: index,
      blocker: index,
    }),
  },
  {
    weight: 8,
    arbitrary: fc.record({ kind: fc.constant('start'), task: index }),
  },
  { weight: 6, arbitrary: fc.record({ kind: fc.constant('claim'), assignee }) },
  {
    weight: 14,
    arbitrary: fc.record({
      kind: fc.constant('finish'),
      task: index,
      // Mostly a running task, so finishes happen; any task otherwise.
      running: fc.boolean(),
      status: fc.constantFrom<FinalStatus>(...finalStatuses),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({ kind: fc.constant('cancel'), task: index }),
  },
  {
    weight: 6,
    arbitrary: fc.record({ kind: fc.constant('renew'), task: index }),
  },
  { weight: 8, arbitrary: fc.record({ kind: fc.constant('expire') }) },
);

// The mutation config runs fewer sequences: each one opens a graph and runs
// its operations on Turso.
const numRuns = Number(process.env.GRAPH_PROPERTY_RUNS ?? 100);

afterEach(() => {
  vi.restoreAllMocks();
});

test.prop(
  [
    fc.array(operation, {
      maxLength: Number(process.env.GRAPH_PROPERTY_LENGTH ?? 100),
    }),
  ],
  { numRuns },
)(
  'the graph after any operations keeps every counter equal to the holding blockers, no started task held by one, one lease per running task, and every change recorded',
  async (operations) => {
    let clock = 1_700_000_000_000;
    const exec = vi.spyOn(Database.prototype, 'exec');
    const tasks = await openTasks(':memory:', {
      logger: pino({ level: 'silent' }),
      now: () => clock,
    });
    const connection = () => exec.mock.contexts[0] as Database;
    try {
      let claims = 0;
      const claim = (names: string[]) =>
        tasks.claimTask({
          claimId: `claim-${(claims += 1)}`,
          assignees: names,
          actor: 'bot-dev-1',
          leaseMs: lease,
        });
      const latest = async (id: string) => {
        const row = await connection().get(
          'SELECT id FROM task_executions WHERE task_id = ? ORDER BY attempt DESC LIMIT 1',
          id,
        );
        return row === undefined ? 'exe_none' : String(row.id);
      };
      const runningIds = async () =>
        (
          await connection().all(
            `SELECT id FROM tasks WHERE status = '${Status.running}'`,
          )
        ).map((row) => String(row.id));
      const create = async (parentId: string, name: string) => {
        const result = await tasks.createTask({
          title: `T${ids.length}`,
          kind: 'task',
          priority: 2,
          parentId,
          assignee: name,
          createdBy: 'planner',
        });
        if (!result.ok) {
          throw new Error(`create: ${result.reason}`);
        }
        return result.task.id;
      };
      // Starts this task, if it is ready, through a claim only it answers.
      const start = async (id: string) => {
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
          return;
        }
        const result = await claim([only]);
        if (result.ok && result.task === null) {
          await tasks.assignTask({
            id,
            assignee: String(own),
            changedBy: 'orchestrator',
          });
        }
      };

      const first = await tasks.createTask({
        title: 'T0',
        kind: 'task',
        priority: 2,
        assignee: 'dev',
        createdBy: 'planner',
      });
      if (!first.ok) {
        throw new Error(`create: ${first.reason}`);
      }
      const ids = [first.task.id];
      const pick = (at: number) => ids[at % ids.length];

      for (const op of operations) {
        switch (op.kind) {
          case 'create':
            ids.push(await create(pick(op.parent), op.assignee));
            break;
          case 'link':
            await tasks.link({
              taskId: pick(op.task),
              blockerId: pick(op.blocker),
            });
            break;
          case 'unlink':
            await tasks.unlink({
              taskId: pick(op.task),
              blockerId: pick(op.blocker),
            });
            break;
          case 'start':
            await start(pick(op.task));
            break;
          case 'claim':
            await claim([op.assignee]);
            break;
          case 'finish': {
            const candidates = await runningIds();
            const id =
              op.running && candidates.length > 0
                ? candidates[op.task % candidates.length]
                : pick(op.task);
            await tasks.finishTask({
              executionId: await latest(id),
              changedBy: 'bot-dev-1',
              status: op.status,
            });
            break;
          }
          case 'cancel':
            await tasks.cancelTask({ id: pick(op.task), changedBy: 'planner' });
            break;
          case 'renew': {
            const candidates = await runningIds();
            if (candidates.length > 0) {
              await tasks.renewExecution({
                executionId: await latest(
                  candidates[op.task % candidates.length],
                ),
                leaseMs: lease,
              });
            }
            break;
          }
          case 'expire':
            clock += lease / 2;
            await tasks.expireExecutions({
              maxAttempts: 2,
              changedBy: 'server',
            });
            break;
        }
      }

      const holding = `blocker.status IN ('${Status.open}', '${Status.running}', '${Status.failed}', '${Status.cancelled}')`;
      const drift = await connection().all(
        `SELECT tasks.id FROM tasks WHERE tasks.holding_blockers <> (
            SELECT count(*) FROM task_links JOIN tasks AS blocker ON blocker.id = task_links.blocker_id
            WHERE task_links.task_id = tasks.id AND ${holding})`,
      );
      const heldAfterStart = await connection().all(
        `SELECT task_links.task_id FROM task_links
          JOIN tasks ON tasks.id = task_links.task_id
          JOIN tasks AS blocker ON blocker.id = task_links.blocker_id
          WHERE ${holding} AND tasks.status IN ('${Status.running}', '${Status.succeeded}', '${Status.failed}', '${Status.skipped}')`,
      );
      const unrecorded = await connection().all(
        `SELECT tasks.id FROM tasks WHERE tasks.status IS NOT (
            SELECT to_status FROM task_status_changes WHERE task_id = tasks.id
            ORDER BY id DESC LIMIT 1)
          OR (SELECT count(*) FROM task_executions WHERE task_id = tasks.id AND expires_at IS NOT NULL)
            <> (tasks.status = '${Status.running}')`,
      );
      expect(drift).toEqual([]);
      expect(heldAfterStart).toEqual([]);
      expect(unrecorded).toEqual([]);
    } finally {
      await tasks.close();
      exec.mockRestore();
    }
  },
  120_000,
);
