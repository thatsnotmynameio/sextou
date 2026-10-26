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
import type { RequestListener } from 'node:http';
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
import { answer, archive, plaintext, serve, sha } from '../archive';
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

// Where the tasks taskfileExecute runs keep their Taskfile, in the
// repository their source names.
const path = 'tasks/test/Taskfile.yml';

// Runs a task through taskfileExecute, whose repository a server for the test
// serves with `listener`: by default, a tarball with a Taskfile at `path`
// whose default task runs `cmds`, beside `files`.
async function execute(
  cmds: string[],
  {
    taskBin = bin,
    tarBin = 'tar',
    files = {},
    listener = answer(archive({ ...files, [path]: plaintext(cmds) })),
  }: {
    taskBin?: string;
    tarBin?: string;
    files?: Record<string, string>;
    listener?: RequestListener;
  } = {},
) {
  const server = await serve(listener);
  onTestFinished(server.close);
  const result = await taskfileExecute({
    githubUrl: server.url,
    downloadTimeoutMs: 5000,
    tarBin,
    bin: taskBin,
    ...limits,
  })(
    {
      id: 'tsk_1',
      source: { repo: 'thatsnotmynameio/sextou', sha, taskfile: path },
    },
    { signal: new AbortController().signal, logger: logger() },
  );
  return { result, paths: server.paths };
}

// The run's own folder, from the folder its Taskfile ran in, tasks/test
// inside it, which `pwd` wrote first. It throws on any other line, so a test
// never removes a folder that isn't a run's.
function runFolder() {
  const folder = dirname(dirname(lines()[0].line));
  if (!basename(folder).startsWith('sextou-execution-')) {
    throw new Error(`${folder} is not a run's folder`);
  }
  return folder;
}

test('taskfileExecute downloads the repository of the source at its commit', async () => {
  const { paths } = await execute(['true']);

  expect(paths).toEqual([`/thatsnotmynameio/sextou/archive/${sha}.tar.gz`]);
});

goTask(
  'taskfileExecute runs the Taskfile at its path in a folder of its own under the temporary folder',
  async () => {
    const { result } = await execute(['pwd']);

    expect(result).toEqual({ outcome: 'succeeded' });
    expect(lines()[0].line.endsWith('/tasks/test')).toBe(true);
    expect(dirname(runFolder())).toBe(tmpdir());
  },
);

goTask(
  'taskfileExecute runs the Taskfile beside the files of its repository',
  async () => {
    await execute(['cat hello.txt'], {
      files: { 'tasks/test/hello.txt': 'hello world' },
    });

    expect(lines()).toEqual([{ stream: 'stdout', line: 'hello world' }]);
  },
);

test('taskfileExecute resolves failed with why the download failed, without running go-task', async () => {
  const notFound: RequestListener = (_request, response) => {
    response.writeHead(404).end();
  };

  const { result } = await execute(['true'], {
    taskBin: join(dir, 'no-task'),
    listener: notFound,
  });

  expect(result).toEqual({ outcome: 'failed', reason: 'download: HTTP 404' });
});

goTask(
  'taskfileExecute removes the folder once the run succeeded',
  async () => {
    await execute(['pwd']);

    await vi.waitFor(() => expect(existsSync(runFolder())).toBe(false));
  },
);

goTask('taskfileExecute resolves failed when the run failed', async () => {
  expect((await execute(['exit 4'])).result).toEqual({
    outcome: 'failed',
    reason: 'exit code 4',
  });
});

goTask('taskfileExecute removes the folder once the run failed', async () => {
  await execute(['pwd', 'exit 4']);

  await vi.waitFor(() => expect(existsSync(runFolder())).toBe(false));
});

goTask(
  "taskfileExecute keeps the run's result when its folder can't be removed",
  async () => {
    const { result } = await execute([
      'pwd',
      'mkdir locked',
      'touch locked/file',
      'chmod 555 locked',
    ]);

    expect(result).toEqual({ outcome: 'succeeded' });
    const folder = runFolder();
    onTestFinished(() => {
      chmodSync(join(lines()[0].line, 'locked'), 0o755);
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

  expect((await execute(['true'], { taskBin: missing })).result).toEqual({
    outcome: 'failed',
    reason: `spawn ${missing} ENOENT`,
  });
});

test('taskfileExecute resolves failed with why the download failed when tar does not exist', async () => {
  const missing = join(dir, 'no-tar');

  expect((await execute(['true'], { tarBin: missing })).result).toEqual({
    outcome: 'failed',
    reason: `download: spawn ${missing} ENOENT`,
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
