import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { run } from '../../../shared/run';

// run() on node itself, as a child process, with a script given by -e.

const notRun = 127;

// Runs node with `script` until `signal` aborts, or until the script writes
// the line `abortOn`, as one whose handlers are ready does, with
// `killGraceMs` of grace, and resolves with its exit code and the lines it
// wrote.
async function node(
  script: string,
  {
    signal,
    abortOn,
    killGraceMs = 10_000,
    stdin = '',
  }: {
    signal?: AbortSignal;
    abortOn?: string;
    killGraceMs?: number;
    stdin?: string;
  } = {},
) {
  const controller = new AbortController();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(
    process.execPath,
    ['-e', script],
    {
      cwd: tmpdir(),
      env: process.env,
      signal: signal ?? controller.signal,
      killGraceMs,
      stdin,
      stdout: (line) => {
        stdout.push(line);
        if (line === abortOn) {
          controller.abort();
        }
      },
      stderr: (line) => stderr.push(line),
    },
    notRun,
  );
  return { code, stdout, stderr };
}

// A script that ignores SIGTERM and lives 30 seconds. It writes ready once it
// ignores SIGTERM, which a signal sent before would end at once.
const stubborn = `process.on('SIGTERM', () => {}); console.log('ready'); setTimeout(() => {}, 30_000);`;

test('run resolves with the exit code of the program', async () => {
  expect((await node('process.exit(3)')).code).toBe(3);
});

test('run hands the program its stdin', async () => {
  const { stdout } = await node(
    `let s = ''; process.stdin.on('data', (c) => { s += c; }).on('end', () => console.log(s));`,
    { stdin: 'hello' },
  );

  expect(stdout).toEqual(['hello']);
});

test('run hands on each line the program writes, by its stream', async () => {
  expect(
    await node(`console.log('one\\ntwo'); console.error('three');`),
  ).toEqual({ code: 0, stdout: ['one', 'two'], stderr: ['three'] });
});

test('run hands on what a child of the program writes after the program exits', async () => {
  // The child inherits the program's stdout, and writes once it has ended.
  const child = `setTimeout(() => console.log('late'), 300);`;

  const { stdout } = await node(
    `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'inherit' }).unref();`,
  );

  expect(stdout).toEqual(['late']);
});

test('run resolves with notRun when the program does not start', async () => {
  expect(
    await run(
      join(tmpdir(), 'sextou-no-such-program'),
      [],
      {
        cwd: tmpdir(),
        env: process.env,
        signal: new AbortController().signal,
        killGraceMs: 1,
      },
      notRun,
    ),
  ).toBe(notRun);
});

test('run stops the program with SIGTERM when the signal aborts', async () => {
  const { code } = await node(
    `process.on('SIGTERM', () => process.exit(7)); console.log('ready'); setTimeout(() => {}, 30_000);`,
    { abortOn: 'ready' },
  );

  expect(code).toBe(7);
});

test('run resolves with 1 when a signal ended the program', async () => {
  expect(
    (
      await node('setTimeout(() => {}, 30_000)', {
        signal: AbortSignal.timeout(500),
      })
    ).code,
  ).toBe(1);
});

test('run kills a program that ignores SIGTERM once its grace went by', async () => {
  const started = Date.now();

  await node(stubborn, { abortOn: 'ready', killGraceMs: 500 });

  expect(Date.now() - started).toBeLessThan(10_000);
});

test('run stops a program at once when the signal aborted before it started', async () => {
  const started = Date.now();

  await node(stubborn, { signal: AbortSignal.abort(), killGraceMs: 500 });

  expect(Date.now() - started).toBeLessThan(10_000);
});

test('run resolves once a program it stopped exits, though a child of it holds its output', async () => {
  const started = Date.now();

  // The child inherits the program's stdout and stderr, and outlives it by
  // 12 seconds, then ends on its own. The grace is longer, so only the
  // program's exit ends the wait.
  const child = `process.on('SIGTERM', () => {}); setTimeout(() => {}, 12_000);`;
  await node(
    `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(child)}], { stdio: 'inherit' }); process.on('SIGTERM', () => process.exit(0)); console.log('ready');`,
    { abortOn: 'ready', killGraceMs: 30_000 },
  );

  expect(Date.now() - started).toBeLessThan(10_000);
});
