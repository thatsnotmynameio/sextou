import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import {
  afterEach,
  beforeEach,
  expect,
  onTestFinished,
  test,
  vi,
} from 'vitest';
import { createLogger } from '../../src/logger';
import { checkGoTask, runTaskfile, taskfileExecute } from '../../src/taskfile';
import { bin, goTask } from '../go-task';
import { memory } from '../logger';

// Long enough for every run that isn't meant to be stopped.
const limits = { timeoutMs: 20000, killGraceMs: 5000 };

let dir: string;
let output: ReturnType<typeof memory>;

// A logger that writes each record to `output`.
function logger() {
  return createLogger({ level: 'info', pretty: false }, output.destination);
}

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
  writeFileSync(path, plaintext(cmds));
  return path;
}

// The text of a Taskfile whose default task runs `cmds` with no echo of each
// command.
function plaintext(cmds: string[]) {
  return [
    'version: "3"',
    'silent: true',
    'tasks:',
    '  default:',
    '    cmds:',
    ...cmds.map((cmd) => `      - ${JSON.stringify(cmd)}`),
  ].join('\n');
}

function run(
  path: string,
  {
    signal = new AbortController().signal,
    timeoutMs = limits.timeoutMs,
    killGraceMs = limits.killGraceMs,
    bin: taskBin = bin,
  } = {},
) {
  return runTaskfile({
    bin: taskBin,
    taskfile: path,
    timeoutMs,
    killGraceMs,
    logger: logger(),
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

goTask(
  'runTaskfile resolves succeeded when the default task exits 0',
  async () => {
    expect(await run(taskfile(['true']))).toEqual({ outcome: 'succeeded' });
  },
);

goTask(
  'runTaskfile logs each line of stdout and stderr as an output record',
  async () => {
    await run(taskfile(['echo one', 'echo two >&2', 'echo three']));

    expect(lines()).toEqual([
      { stream: 'stdout', line: 'one' },
      { stream: 'stderr', line: 'two' },
      { stream: 'stdout', line: 'three' },
    ]);
  },
);

goTask("runTaskfile runs the commands in the Taskfile's folder", async () => {
  const path = taskfile(['pwd'], 'nested/work');

  await run(path);

  expect(lines()).toEqual([
    { stream: 'stdout', line: join(dir, 'nested/work') },
  ]);
});

goTask(
  "runTaskfile runs go-task in the Taskfile's folder, its USER_WORKING_DIR",
  async () => {
    const path = taskfile(['echo {{.USER_WORKING_DIR}}'], 'nested/work');

    await run(path);

    expect(lines()).toEqual([
      { stream: 'stdout', line: join(dir, 'nested/work') },
    ]);
  },
);

goTask(
  'runTaskfile kills with SIGKILL what the run left in its group once it ended',
  async () => {
    const pidFile = join(dir, 'pid');

    const result = await run(
      // go-task's own shell waits for its background commands; another
      // shell leaves them behind. The sleep ignores SIGTERM, as the shell
      // that started it does.
      taskfile([
        `sh -c 'trap "" TERM; sleep 30 > /dev/null 2>&1 & echo $! > ${pidFile}'`,
      ]),
    );

    expect(result).toEqual({ outcome: 'succeeded' });
    const pid = Number(readFileSync(pidFile, 'utf8'));
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  },
);

goTask('runTaskfile gives the run no input', async () => {
  expect(await run(taskfile(['cat']), { timeoutMs: 5000 })).toEqual({
    outcome: 'succeeded',
  });
});

goTask(
  'runTaskfile resolves failed with the exit code of the command that failed',
  async () => {
    expect(await run(taskfile(['exit 3', 'echo never']))).toEqual({
      outcome: 'failed',
      reason: 'exit code 3',
    });
    expect(lines()).not.toContainEqual({ stream: 'stdout', line: 'never' });
  },
);

goTask(
  'runTaskfile resolves failed when the Taskfile does not exist',
  async () => {
    expect(await run(join(dir, 'Taskfile.yml'))).toEqual({
      outcome: 'failed',
      reason: 'exit code 100',
    });
  },
);

test('runTaskfile resolves failed with the error when the binary does not exist', async () => {
  const missing = join(dir, 'no-task');

  expect(await run(taskfile(['true']), { bin: missing })).toEqual({
    outcome: 'failed',
    reason: `spawn ${missing} ENOENT`,
  });
});

goTask(
  'runTaskfile stops a run that takes longer than timeoutMs and resolves timeout',
  async () => {
    const started = Date.now();

    const result = await run(taskfile(['sleep 30']), {
      timeoutMs: 300,
      killGraceMs: 500,
    });

    expect(result).toEqual({ outcome: 'failed', reason: 'timeout' });
    expect(Date.now() - started).toBeLessThan(5000);
  },
);

goTask('runTaskfile stops a run once its signal aborts', async () => {
  const controller = new AbortController();
  const path = taskfile(['sleep 30 & echo started; wait $!']);
  const started = Date.now();
  // A grace longer than the test: only SIGTERM can end the run in time.
  const running = run(path, { signal: controller.signal, killGraceMs: 60000 });
  await waitForLine('started');

  controller.abort();
  const result = await running;

  expect(result.outcome).toBe('failed');
  expect(Date.now() - started).toBeLessThan(5000);
});

goTask(
  'runTaskfile kills a run that ignores SIGTERM once killGraceMs pass',
  async () => {
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
  },
);

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

goTask(
  'runTaskfile ends a run whose output a command outside its group keeps open, once killGraceMs pass',
  async () => {
    const started = Date.now();

    // setsid puts sleep in a session of its own, which inherits the output.
    const result = await run(taskfile(['setsid sleep 3 &', 'echo done']), {
      killGraceMs: 300,
    });

    expect(result).toEqual({ outcome: 'succeeded' });
    expect(lines()).toEqual([{ stream: 'stdout', line: 'done' }]);
    expect(Date.now() - started).toBeLessThan(2500);
  },
);

goTask(
  'runTaskfile does not count as timeout a run that exited before it, with its output still open',
  async () => {
    // go-task exits at once; sleep, in its group, keeps the output open past
    // the timeout, and ends within the grace. A background command keeps it
    // open only when another command follows it.
    const result = await run(taskfile(['sleep 1 &', 'echo done']), {
      timeoutMs: 300,
      killGraceMs: 5000,
    });

    expect(result).toEqual({ outcome: 'succeeded' });
  },
);

goTask(
  'runTaskfile ends a stopped run whose output a command outside its group keeps open',
  async () => {
    const controller = new AbortController();
    const path = taskfile([
      'setsid sleep 3 &',
      'sleep 30 & echo started; wait $!',
    ]);
    const running = run(path, { signal: controller.signal, killGraceMs: 300 });
    await waitForLine('started');
    const stopped = Date.now();

    // SIGTERM ends go-task and its group, the SIGKILL after the grace finds no
    // process, and the output closes once the grace passes.
    controller.abort();
    const result = await running;

    expect(result.outcome).toBe('failed');
    expect(Date.now() - stopped).toBeLessThan(2500);
  },
);

goTask(
  "runTaskfile kills the run's group when the runner's process exits",
  async () => {
    const before = process.listeners('exit');
    const running = run(taskfile(['echo started', 'sleep 30']));
    const [killOnExit] = process
      .listeners('exit')
      .filter((listener) => !before.includes(listener));
    await waitForLine('started');

    killOnExit(0);

    expect(await running).toEqual({
      outcome: 'failed',
      reason: 'signal SIGKILL',
    });
    expect(process.listeners('exit')).toEqual(before);
  },
);

// Runs a task whose Taskfile is `text` through taskfileExecute.
function execute(text: string, taskBin = bin) {
  return taskfileExecute({ bin: taskBin, ...limits })(
    { id: 'tsk_1', taskfile: text },
    { signal: new AbortController().signal, logger: logger() },
  );
}

goTask(
  "taskfileExecute runs the task's Taskfile in a folder of its own under the temporary folder",
  async () => {
    expect(await execute(plaintext(['pwd']))).toEqual({ outcome: 'succeeded' });

    const [{ line }] = lines();
    expect(dirname(line)).toBe(tmpdir());
    expect(basename(line)).toMatch(/^sextou-execution-/);
  },
);

goTask(
  'taskfileExecute removes the folder once the run succeeded',
  async () => {
    await execute(plaintext(['pwd']));

    await vi.waitFor(() => expect(existsSync(lines()[0].line)).toBe(false));
  },
);

goTask('taskfileExecute resolves failed when the run failed', async () => {
  expect(await execute(plaintext(['exit 4']))).toEqual({
    outcome: 'failed',
    reason: 'exit code 4',
  });
});

goTask('taskfileExecute removes the folder once the run failed', async () => {
  await execute(plaintext(['pwd', 'exit 4']));

  await vi.waitFor(() => expect(existsSync(lines()[0].line)).toBe(false));
});

goTask(
  "taskfileExecute keeps the run's result when its folder can't be removed",
  async () => {
    const result = await execute(
      plaintext([
        'mkdir locked',
        'touch locked/file',
        'chmod 555 locked',
        'pwd',
      ]),
    );

    expect(result).toEqual({ outcome: 'succeeded' });
    const folder = lines()[0].line;
    onTestFinished(() => {
      chmodSync(join(folder, 'locked'), 0o755);
      rmSync(folder, { recursive: true, force: true });
    });
    await vi.waitFor(() =>
      expect(output.records()).toContainEqual(
        expect.objectContaining({ msg: 'folder not removed', dir: folder }),
      ),
    );
  },
);

test('taskfileExecute resolves failed with the error when the binary does not exist', async () => {
  const missing = join(dir, 'no-task');

  expect(await execute(plaintext(['true']), missing)).toEqual({
    outcome: 'failed',
    reason: `spawn ${missing} ENOENT`,
  });
});

// An executable script in `dir` that runs `body`.
function script(body: string) {
  const path = join(dir, 'fake-task');
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return path;
}

goTask('checkGoTask resolves undefined for go-task', async () => {
  expect(await checkGoTask(bin, 5000)).toBeUndefined();
});

test('checkGoTask resolves the error when the binary does not exist', async () => {
  const missing = join(dir, 'no-task');

  expect(await checkGoTask(missing, 5000)).toBe(`spawn ${missing} ENOENT`);
});

test('checkGoTask resolves why when the help names no --taskfile', async () => {
  expect(await checkGoTask(script('echo "task add <description>"'), 5000)).toBe(
    'its help names no --taskfile',
  );
});

test('checkGoTask resolves why when a binary without --taskfile fails', async () => {
  expect(await checkGoTask(script('exit 2'), 5000)).toBe(
    'its help names no --taskfile',
  );
});

test('checkGoTask takes --taskfile from the help on stderr', async () => {
  expect(
    await checkGoTask(script('echo "  -t, --taskfile string" >&2'), 5000),
  ).toBeUndefined();
});

test('checkGoTask resolves timeout when the help takes longer than timeoutMs', async () => {
  expect(await checkGoTask(script('exec sleep 30'), 200)).toBe('timeout');
});

async function waitForLine(line: string) {
  while (!lines().some((record) => record.line === line)) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
