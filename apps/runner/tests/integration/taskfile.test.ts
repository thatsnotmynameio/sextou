import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createLogger } from '../../src/logger';
import { goTaskBin, runTaskfile } from '../../src/taskfile';
import { memory } from '../logger';

let dir: string;
let output: ReturnType<typeof memory>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-taskfile-'));
  output = memory();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// A Taskfile in its own folder under `dir`, whose default task runs `cmds`
// with no echo of each command.
function taskfile(cmds: string[], folder = 'work') {
  mkdirSync(join(dir, folder), { recursive: true });
  const path = join(dir, folder, 'Taskfile.yml');
  writeFileSync(
    path,
    [
      'version: "3"',
      'silent: true',
      'tasks:',
      '  default:',
      '    cmds:',
      ...cmds.map((cmd) => `      - ${JSON.stringify(cmd)}`),
    ].join('\n'),
  );
  return path;
}

function run(
  path: string,
  {
    signal = new AbortController().signal,
    timeoutMs = 20000,
    killGraceMs = 5000,
    bin = goTaskBin(),
  } = {},
) {
  return runTaskfile({
    bin,
    taskfile: path,
    timeoutMs,
    killGraceMs,
    logger: createLogger({ level: 'info', pretty: false }, output.destination),
    signal,
  });
}

function lines() {
  return output
    .records()
    .map((record) => record as { msg: string; stream: string; line: string })
    .filter((record) => record.msg === 'output')
    .map(({ stream, line }) => ({ stream, line }));
}

test('goTaskBin names the binary @go-task/cli installed', () => {
  expect(goTaskBin('linux')).toMatch(/@go-task\/cli\/bin\/task$/);
  expect(goTaskBin('win32')).toMatch(/@go-task\/cli\/bin\/task\.exe$/);
});

test('runTaskfile resolves succeeded when the default task exits 0', async () => {
  expect(await run(taskfile(['true']))).toEqual({ outcome: 'succeeded' });
});

test('runTaskfile logs each line of stdout and stderr as an output record', async () => {
  await run(taskfile(['echo one', 'echo two >&2', 'echo three']));

  expect(lines()).toEqual([
    { stream: 'stdout', line: 'one' },
    { stream: 'stderr', line: 'two' },
    { stream: 'stdout', line: 'three' },
  ]);
});

test("runTaskfile runs the commands in the Taskfile's folder", async () => {
  const path = taskfile(['pwd'], 'nested/work');

  await run(path);

  expect(lines()).toEqual([
    { stream: 'stdout', line: join(dir, 'nested/work') },
  ]);
});

test('runTaskfile resolves failed with the exit code of the command that failed', async () => {
  expect(await run(taskfile(['exit 3', 'echo never']))).toEqual({
    outcome: 'failed',
    reason: 'exit code 3',
  });
  expect(lines()).not.toContainEqual({ stream: 'stdout', line: 'never' });
});

test('runTaskfile resolves failed when the Taskfile does not exist', async () => {
  expect(await run(join(dir, 'missing', 'Taskfile.yml'))).toEqual({
    outcome: 'failed',
    reason: 'exit code 100',
  });
});

test('runTaskfile resolves failed with the error when the binary does not exist', async () => {
  const bin = join(dir, 'no-task');

  expect(await run(taskfile(['true']), { bin })).toEqual({
    outcome: 'failed',
    reason: `spawn ${bin} ENOENT`,
  });
});

test('runTaskfile stops a run that takes longer than timeoutMs and resolves timeout', async () => {
  const started = Date.now();

  const result = await run(taskfile(['sleep 30']), { timeoutMs: 300 });

  expect(result).toEqual({ outcome: 'failed', reason: 'timeout' });
  expect(Date.now() - started).toBeLessThan(5000);
});

test('runTaskfile stops a run once its signal aborts', async () => {
  const controller = new AbortController();
  const path = taskfile(['echo started', 'sleep 30']);
  const started = Date.now();
  const running = run(path, { signal: controller.signal });
  await waitForLine('started');

  controller.abort();
  const result = await running;

  expect(result.outcome).toBe('failed');
  expect(Date.now() - started).toBeLessThan(5000);
});

test('runTaskfile kills a run that ignores SIGTERM once killGraceMs pass', async () => {
  const controller = new AbortController();
  // go-task's shell has no trap for TERM: Node ignores it instead.
  const path = taskfile([
    `${process.execPath} -e "process.on('SIGTERM', () => {}); console.log('started'); setInterval(() => {}, 1000)"`,
  ]);
  const running = run(path, { signal: controller.signal, killGraceMs: 300 });
  await waitForLine('started');
  const stopped = Date.now();

  controller.abort();
  const result = await running;

  expect(result).toEqual({ outcome: 'failed', reason: 'signal SIGKILL' });
  expect(Date.now() - stopped).toBeGreaterThanOrEqual(250);
});

test('runTaskfile does not start a run whose signal already aborted', async () => {
  const marker = join(dir, 'ran');
  const controller = new AbortController();
  controller.abort();

  const result = await run(taskfile([`touch ${marker}`]), {
    signal: controller.signal,
  });

  expect(result).toEqual({ outcome: 'failed', reason: 'aborted' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(() => rmSync(marker)).toThrow();
});

async function waitForLine(line: string) {
  while (!lines().some((record) => record.line === line)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
