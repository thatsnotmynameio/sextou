import { expect, test, vi } from 'vitest';
import { loadConfig } from '../../src/config';

function load(env: Record<string, string | undefined>) {
  return loadConfig(env, { hostname: () => 'box' });
}

test('loadConfig uses every default when no variable is set', () => {
  expect(load({})).toEqual({
    serverUrl: 'http://127.0.0.1:4310',
    name: 'box',
    assignees: ['box'],
    requestTimeoutMs: 30000,
    pollMs: 5000,
    taskBin: 'task',
    tarBin: 'tar',
    checkTimeoutMs: 10000,
    githubUrl: 'https://github.com',
    downloadTimeoutMs: 300000,
    runTimeoutMs: 21600000,
    killGraceMs: 10000,
    maxTasksFileBytes: 1048576,
    dev: false,
    logLevel: 'info',
  });
});

test('loadConfig takes every variable that is set', () => {
  expect(
    load({
      SEXTOU_RUNNER_SERVER_URL: 'https://tasks.example/api',
      SEXTOU_RUNNER_NAME: 'r1',
      SEXTOU_RUNNER_ASSIGNEES: 'dev,ops',
      SEXTOU_RUNNER_REQUEST_TIMEOUT_MS: '700',
      SEXTOU_RUNNER_POLL_MS: '200',
      SEXTOU_RUNNER_TASK_BIN: '/opt/go-task',
      SEXTOU_RUNNER_TAR_BIN: '/usr/bin/bsdtar',
      SEXTOU_RUNNER_CHECK_TIMEOUT_MS: '700',
      SEXTOU_RUNNER_GITHUB_URL: 'https://git.example',
      SEXTOU_RUNNER_DOWNLOAD_TIMEOUT_MS: '600',
      SEXTOU_RUNNER_RUN_TIMEOUT_MS: '900',
      SEXTOU_RUNNER_KILL_GRACE_MS: '800',
      SEXTOU_RUNNER_MAX_TASKS_FILE_BYTES: '2048',
      SEXTOU_RUNNER_DEV: 'true',
      SEXTOU_RUNNER_LOG_LEVEL: 'debug',
    }),
  ).toEqual({
    serverUrl: 'https://tasks.example/api',
    name: 'r1',
    assignees: ['dev', 'ops'],
    requestTimeoutMs: 700,
    pollMs: 200,
    taskBin: '/opt/go-task',
    tarBin: '/usr/bin/bsdtar',
    checkTimeoutMs: 700,
    githubUrl: 'https://git.example',
    downloadTimeoutMs: 600,
    runTimeoutMs: 900,
    killGraceMs: 800,
    maxTasksFileBytes: 2048,
    dev: true,
    logLevel: 'debug',
  });
});

test('loadConfig does not read the hostname when the name is set', () => {
  const hostname = vi.fn(() => 'box');
  expect(loadConfig({ SEXTOU_RUNNER_NAME: 'r1' }, { hostname }).name).toBe(
    'r1',
  );
  expect(hostname).not.toHaveBeenCalled();
});

test('loadConfig takes the set name as the default assignee', () => {
  expect(load({ SEXTOU_RUNNER_NAME: 'r1' }).assignees).toEqual(['r1']);
});

test('loadConfig drops the trailing slashes of the server URL', () => {
  expect(
    load({ SEXTOU_RUNNER_SERVER_URL: 'http://127.0.0.1:4310//' }).serverUrl,
  ).toBe('http://127.0.0.1:4310');
});

test.each(['', 'not a url', 'ftp://127.0.0.1', '127.0.0.1:4310'])(
  'loadConfig rejects SEXTOU_RUNNER_SERVER_URL=%j',
  (value) => {
    expect(() => load({ SEXTOU_RUNNER_SERVER_URL: value })).toThrow(
      `Invalid SEXTOU_RUNNER_SERVER_URL: ${JSON.stringify(value)} (expected an http or https URL)`,
    );
  },
);

test('loadConfig drops the trailing slashes of the GitHub URL', () => {
  expect(
    load({ SEXTOU_RUNNER_GITHUB_URL: 'http://127.0.0.1:8080/' }).githubUrl,
  ).toBe('http://127.0.0.1:8080');
});

test('loadConfig rejects a SEXTOU_RUNNER_GITHUB_URL that is not http or https', () => {
  expect(() => load({ SEXTOU_RUNNER_GITHUB_URL: 'git@github.com' })).toThrow(
    'Invalid SEXTOU_RUNNER_GITHUB_URL: "git@github.com" (expected an http or https URL)',
  );
});

test('loadConfig trims the name', () => {
  expect(load({ SEXTOU_RUNNER_NAME: '  r1 ' }).name).toBe('r1');
});

test.each(['', '   '])('loadConfig rejects SEXTOU_RUNNER_NAME=%j', (value) => {
  expect(() => load({ SEXTOU_RUNNER_NAME: value })).toThrow(
    `Invalid SEXTOU_RUNNER_NAME: ${JSON.stringify(value)} (expected a name)`,
  );
});

test('loadConfig trims each assignee', () => {
  expect(load({ SEXTOU_RUNNER_ASSIGNEES: ' dev , ops' }).assignees).toEqual([
    'dev',
    'ops',
  ]);
});

test.each(['', ' ', 'dev,', ',dev', 'dev,,ops'])(
  'loadConfig rejects SEXTOU_RUNNER_ASSIGNEES=%j',
  (value) => {
    expect(() => load({ SEXTOU_RUNNER_ASSIGNEES: value })).toThrow(
      `Invalid SEXTOU_RUNNER_ASSIGNEES: ${JSON.stringify(value)} (expected names separated by commas)`,
    );
  },
);

test.each([
  ['SEXTOU_RUNNER_REQUEST_TIMEOUT_MS', 'requestTimeoutMs'],
  ['SEXTOU_RUNNER_POLL_MS', 'pollMs'],
  ['SEXTOU_RUNNER_CHECK_TIMEOUT_MS', 'checkTimeoutMs'],
  ['SEXTOU_RUNNER_DOWNLOAD_TIMEOUT_MS', 'downloadTimeoutMs'],
  ['SEXTOU_RUNNER_RUN_TIMEOUT_MS', 'runTimeoutMs'],
  ['SEXTOU_RUNNER_KILL_GRACE_MS', 'killGraceMs'],
] as const)(
  'loadConfig takes %s from 1 to 2147483647 milliseconds',
  (name, key) => {
    expect(load({ [name]: '1' })[key]).toBe(1);
    expect(load({ [name]: '2147483647' })[key]).toBe(2147483647);
  },
);

test.each([
  ['SEXTOU_RUNNER_REQUEST_TIMEOUT_MS', '0'],
  ['SEXTOU_RUNNER_REQUEST_TIMEOUT_MS', '2147483648'],
  ['SEXTOU_RUNNER_POLL_MS', '1.5'],
  ['SEXTOU_RUNNER_POLL_MS', ''],
  ['SEXTOU_RUNNER_RUN_TIMEOUT_MS', '-5'],
  ['SEXTOU_RUNNER_KILL_GRACE_MS', '1e3'],
  ['SEXTOU_RUNNER_CHECK_TIMEOUT_MS', '0'],
  ['SEXTOU_RUNNER_DOWNLOAD_TIMEOUT_MS', '0'],
])('loadConfig rejects %s=%j', (name, value) => {
  expect(() => load({ [name]: value })).toThrow(
    `Invalid ${name}: ${JSON.stringify(value)} (expected a whole number of milliseconds from 1 to 2147483647)`,
  );
});

test('loadConfig takes SEXTOU_RUNNER_MAX_TASKS_FILE_BYTES from 1 byte', () => {
  expect(
    load({ SEXTOU_RUNNER_MAX_TASKS_FILE_BYTES: '1' }).maxTasksFileBytes,
  ).toBe(1);
});

test.each(['0', '1.5', '-5', '1e3', ''])(
  'loadConfig rejects SEXTOU_RUNNER_MAX_TASKS_FILE_BYTES=%j',
  (value) => {
    expect(() => load({ SEXTOU_RUNNER_MAX_TASKS_FILE_BYTES: value })).toThrow(
      `Invalid SEXTOU_RUNNER_MAX_TASKS_FILE_BYTES: ${JSON.stringify(value)} (expected a whole number of bytes from 1)`,
    );
  },
);

test('loadConfig trims SEXTOU_RUNNER_TASK_BIN', () => {
  expect(load({ SEXTOU_RUNNER_TASK_BIN: ' go-task ' }).taskBin).toBe('go-task');
});

test.each(['', '  '])(
  'loadConfig rejects SEXTOU_RUNNER_TASK_BIN=%j',
  (value) => {
    expect(() => load({ SEXTOU_RUNNER_TASK_BIN: value })).toThrow(
      `Invalid SEXTOU_RUNNER_TASK_BIN: ${JSON.stringify(value)} (expected a command or a path)`,
    );
  },
);

test('loadConfig trims SEXTOU_RUNNER_TAR_BIN', () => {
  expect(load({ SEXTOU_RUNNER_TAR_BIN: ' gtar ' }).tarBin).toBe('gtar');
});

test.each(['', '  '])(
  'loadConfig rejects SEXTOU_RUNNER_TAR_BIN=%j',
  (value) => {
    expect(() => load({ SEXTOU_RUNNER_TAR_BIN: value })).toThrow(
      `Invalid SEXTOU_RUNNER_TAR_BIN: ${JSON.stringify(value)} (expected a command or a path)`,
    );
  },
);

test.each(['', 'yes', 'TRUE', '1'])(
  'loadConfig rejects SEXTOU_RUNNER_DEV=%j',
  (value) => {
    expect(() => load({ SEXTOU_RUNNER_DEV: value })).toThrow(
      `Invalid SEXTOU_RUNNER_DEV: ${JSON.stringify(value)} (expected true or false)`,
    );
  },
);

test('loadConfig takes SEXTOU_RUNNER_DEV=false', () => {
  expect(load({ SEXTOU_RUNNER_DEV: 'false' }).dev).toBe(false);
});

test.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])(
  'loadConfig takes SEXTOU_RUNNER_LOG_LEVEL=%s',
  (level) => {
    expect(load({ SEXTOU_RUNNER_LOG_LEVEL: level }).logLevel).toBe(level);
  },
);

test.each(['', 'verbose', 'INFO'])(
  'loadConfig rejects SEXTOU_RUNNER_LOG_LEVEL=%j',
  (value) => {
    expect(() => load({ SEXTOU_RUNNER_LOG_LEVEL: value })).toThrow(
      `Invalid SEXTOU_RUNNER_LOG_LEVEL: ${JSON.stringify(value)} (expected one of fatal, error, warn, info, debug, trace, silent)`,
    );
  },
);
