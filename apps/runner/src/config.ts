import {
  invalid,
  parseBoolean,
  parseOneOf,
  parseTimeout,
  reader,
} from '@sextou/config';
import { logLevels, type LogLevel } from '@sextou/logger/levels';

export interface Config {
  // Where the server answers: the client calls `${serverUrl}/trpc`.
  serverUrl: string;
  // The runner's name, which the server records on each claim and completion.
  name: string;
  // The assignees whose tasks the runner takes.
  assignees: string[];
  // How long a call to the server may take before the runner counts it as
  // unanswered. Above the server's tasks timeout, so the server answers
  // first.
  requestTimeoutMs: number;
  // How long the runner waits before it claims again, when there was no task
  // or no answer, and before it sends a completion again.
  pollMs: number;
  // go-task's binary: `task` on the PATH, or a path. Some distributions name
  // it go-task.
  taskBin: string;
  // tar's binary: `tar` on the PATH, or a path.
  tarBin: string;
  // How long go-task may take to print its help when the runner starts and
  // checks it.
  checkTimeoutMs: number;
  // Where the runner downloads a task's repository from: GitHub, whose
  // ${githubUrl}/<owner>/<name>/archive/<sha>.tar.gz serves it at a commit.
  githubUrl: string;
  // How long downloading and extracting a task's repository may take before
  // the run fails, without running its Taskfile.
  downloadTimeoutMs: number;
  // How long a run may take before the runner stops it and it fails as
  // timeout.
  runTimeoutMs: number;
  // How long a stopped run has to exit after SIGTERM before SIGKILL, and how
  // long a run's output may stay open once go-task exited, stopped or not.
  killGraceMs: number;
  // Readable log lines instead of JSON.
  dev: boolean;
  // The lowest level the logger writes.
  logLevel: LogLevel;
}

// What the defaults depend on: main passes the machine's own.
export interface ConfigContext {
  // Called only when the name is the default.
  hostname: () => string;
}

// The runner's configuration, from the environment: each variable has a
// default, and apps/runner/.env.example lists them. Throws naming the
// variable on an invalid value.
export function loadConfig(
  env: Record<string, string | undefined>,
  { hostname }: ConfigContext,
): Config {
  const read = reader(env);

  const name = read('SEXTOU_RUNNER_NAME', nonEmpty('a name'), hostname);
  return {
    serverUrl: read(
      'SEXTOU_RUNNER_SERVER_URL',
      parseUrl,
      () => 'http://127.0.0.1:4310',
    ),
    name,
    assignees: read('SEXTOU_RUNNER_ASSIGNEES', parseAssignees, () => [name]),
    requestTimeoutMs: read(
      'SEXTOU_RUNNER_REQUEST_TIMEOUT_MS',
      parseTimeout,
      () => 30000,
    ),
    pollMs: read('SEXTOU_RUNNER_POLL_MS', parseTimeout, () => 5000),
    taskBin: read(
      'SEXTOU_RUNNER_TASK_BIN',
      nonEmpty('a command or a path'),
      () => 'task',
    ),
    tarBin: read(
      'SEXTOU_RUNNER_TAR_BIN',
      nonEmpty('a command or a path'),
      () => 'tar',
    ),
    checkTimeoutMs: read(
      'SEXTOU_RUNNER_CHECK_TIMEOUT_MS',
      parseTimeout,
      () => 10000,
    ),
    githubUrl: read(
      'SEXTOU_RUNNER_GITHUB_URL',
      parseUrl,
      () => 'https://github.com',
    ),
    downloadTimeoutMs: read(
      'SEXTOU_RUNNER_DOWNLOAD_TIMEOUT_MS',
      parseTimeout,
      () => 300000,
    ),
    runTimeoutMs: read(
      'SEXTOU_RUNNER_RUN_TIMEOUT_MS',
      parseTimeout,
      () => 21600000,
    ),
    killGraceMs: read('SEXTOU_RUNNER_KILL_GRACE_MS', parseTimeout, () => 10000),
    dev: read('SEXTOU_RUNNER_DEV', parseBoolean, () => false),
    logLevel: read(
      'SEXTOU_RUNNER_LOG_LEVEL',
      parseOneOf(logLevels),
      () => 'info',
    ),
  };
}

function parseUrl(value: string, name: string): string {
  const url = URL.parse(value);
  if (url?.protocol !== 'http:' && url?.protocol !== 'https:') {
    throw invalid(name, value, 'an http or https URL');
  }
  return url.href.replace(/\/+$/, '');
}

// The value trimmed, refused when nothing is left: a name, trimmed as the
// server trims the names it takes, or go-task's or tar's binary.
function nonEmpty(expected: string) {
  return (value: string, name: string): string => {
    const trimmed = value.trim();
    if (trimmed === '') {
      throw invalid(name, value, expected);
    }
    return trimmed;
  };
}

// Names separated by commas, each trimmed: at least one, none empty.
function parseAssignees(value: string, name: string): string[] {
  const names = value.split(',').map((part) => part.trim());
  if (names.includes('')) {
    throw invalid(name, value, 'names separated by commas');
  }
  return names;
}
