import { expect, test } from 'vitest';
import {
  createTaskSchema,
  finishTaskSchema,
  linkSchema,
  listReadySchema,
  startTaskSchema,
  unlinkSchema,
} from './schemas';
import { Status } from './status';

test('createTaskSchema outputs a new task with its texts trimmed', () => {
  expect(
    createTaskSchema.parse({
      title: ' Write the parser ',
      kind: ' task ',
      priority: 2,
      parentId: ' tsk_1 ',
      assignee: ' dev ',
      description: ' Parse the input. ',
      sourcePath: ' ./notes/task.md ',
      createdBy: ' planner ',
    }),
  ).toEqual({
    title: 'Write the parser',
    kind: 'task',
    priority: 2,
    parentId: ' tsk_1 ',
    assignee: 'dev',
    description: 'Parse the input.',
    sourcePath: './notes/task.md',
    createdBy: 'planner',
  });
});

test('createTaskSchema outputs null for a description and source path left out', () => {
  expect(
    createTaskSchema.parse({
      title: 'A',
      kind: 'task',
      priority: 0,
      assignee: 'dev',
      createdBy: 'planner',
    }),
  ).toEqual({
    title: 'A',
    kind: 'task',
    priority: 0,
    assignee: 'dev',
    description: null,
    sourcePath: null,
    createdBy: 'planner',
  });
});

test.each([linkSchema, unlinkSchema])(
  'the link schemas output both ids as given',
  (schema) => {
    expect(schema.parse({ taskId: ' tsk_1 ', blockerId: '' })).toEqual({
      taskId: ' tsk_1 ',
      blockerId: '',
    });
  },
);

test('startTaskSchema outputs a start with its texts trimmed', () => {
  expect(
    startTaskSchema.parse({
      id: 'tsk_1',
      changedBy: ' orchestrator ',
      actor: ' bot-dev-1 ',
      logPath: ' ./logs/1.log ',
    }),
  ).toEqual({
    id: 'tsk_1',
    changedBy: 'orchestrator',
    actor: 'bot-dev-1',
    logPath: './logs/1.log',
  });
});

test('finishTaskSchema outputs a finish with its texts trimmed and blank ones as null', () => {
  expect(
    finishTaskSchema.parse({
      id: 'tsk_1',
      changedBy: ' bot-dev-1 ',
      status: Status.skipped,
      reason: ' Done elsewhere. ',
      resultPath: '  ',
    }),
  ).toEqual({
    id: 'tsk_1',
    changedBy: 'bot-dev-1',
    status: Status.skipped,
    reason: 'Done elsewhere.',
    resultPath: null,
  });
});

test('listReadySchema outputs the assignees trimmed', () => {
  expect(
    listReadySchema.parse({ assignees: [' dev ', 'qa'], limit: 4 }),
  ).toEqual({ assignees: ['dev', 'qa'], limit: 4 });
});

test('listReadySchema accepts a limit past the safe integers', () => {
  expect(listReadySchema.parse({ assignees: ['dev'], limit: 1e20 })).toEqual({
    assignees: ['dev'],
    limit: 1e20,
  });
});
