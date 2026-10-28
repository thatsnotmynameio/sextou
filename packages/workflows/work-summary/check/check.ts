import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitEnv } from '../../shared/git.ts';
import { run } from '../../shared/run.ts';
import {
  defaultKillGraceMs,
  readBin,
  readTimeout,
} from '../../shared/settings.ts';
import { throughSymlink } from '../../shared/workspace.ts';
import { type Branch, checkBranch, planUnits } from './branch.ts';
import { defaultTimeoutMs, readSettings } from './settings.ts';
import { checkSummary } from './summary.ts';

// Exits with 1 when the summary is refused: missing, not JSON, malformed,
// contradicting itself or the branch, with one line per reason.
export const summaryRefused = 1;
// Exits with 2 when the task's input is wrong: the context, a variable, a
// plan with no unit, a base that names no commit or shares no history with
// HEAD, or any other git failure. The summary is then not judged.
export const inputRefused = 2;
// Exits with 127 when git doesn't run.
export const noGit = 127;
// Exits with 124 when git took longer than WORK_SUMMARY_TIMEOUT_MS, which
// stops it: SIGTERM, then SIGKILL once WORK_SUMMARY_KILL_GRACE_MS went by.
export const timedOut = 124;

// Checks the work summary the task's context (WORK_SUMMARY_CONTEXT, as JSON)
// names against the repository it names in the run's workspace
// (WORK_SUMMARY_WORKSPACE): its form, its coherence and its agreement with
// the branch from the merge base of the base ref and HEAD. `env` is the
// environment git runs with, and `log` gets each line the check writes,
// git's errors included. git is the program WORK_SUMMARY_GIT_BIN names, a
// command on the PATH or an absolute path, git on the PATH when it is unset
// or empty.
// Resolves with the exit code: 0 when the summary is valid, else
// summaryRefused, inputRefused, noGit or timedOut.
export async function check(
  env: NodeJS.ProcessEnv,
  log: (line: string) => void,
): Promise<number> {
  const refuse = (reason: string, code: number) => {
    log(`work-summary: ${reason}`);
    return code;
  };
  // Stryker disable next-line StringLiteral: any path but an absolute one refuses the same
  const workspace = env.WORK_SUMMARY_WORKSPACE ?? '';
  // Stryker disable next-line StringLiteral: any text but JSON refuses the same
  const read = readSettings(env.WORK_SUMMARY_CONTEXT ?? '', workspace);
  if (!read.ok) {
    return refuse(read.reason, inputRefused);
  }
  const timeoutMs = readTimeout(env.WORK_SUMMARY_TIMEOUT_MS, defaultTimeoutMs);
  if (timeoutMs === undefined) {
    return refuse(
      'WORK_SUMMARY_TIMEOUT_MS is a whole number of milliseconds from 1 to 2147483647',
      inputRefused,
    );
  }
  const killGraceMs = readTimeout(
    env.WORK_SUMMARY_KILL_GRACE_MS,
    defaultKillGraceMs,
  );
  if (killGraceMs === undefined) {
    return refuse(
      'WORK_SUMMARY_KILL_GRACE_MS is a whole number of milliseconds from 1 to 2147483647',
      inputRefused,
    );
  }
  const gitBin = readBin(env.WORK_SUMMARY_GIT_BIN, 'git');
  if (gitBin === undefined) {
    return refuse(
      'WORK_SUMMARY_GIT_BIN is a command on the PATH or an absolute path',
      inputRefused,
    );
  }
  const { settings } = read;
  if (await throughSymlink(workspace, settings.path)) {
    return refuse('path is inside the workspace', inputRefused);
  }
  if (await throughSymlink(workspace, settings.planFile)) {
    return refuse('plan is a path in the repository', inputRefused);
  }
  if (await throughSymlink(workspace, settings.summary)) {
    return refuse('summary is a path inside the workspace', inputRefused);
  }

  // git's HOME is an empty folder of its own, so no configuration of the
  // runner's user changes the output the check reads.
  const home = await mkdtemp(join(tmpdir(), 'sextou-work-summary-home-'));
  try {
    const deadline = AbortSignal.timeout(timeoutMs);
    const facts = await readBranch({
      gitBin,
      env: gitEnv(env, home),
      workspace,
      path: settings.path,
      base: settings.base,
      deadline,
      killGraceMs,
    });
    if (deadline.aborted) {
      return refuse(`git took longer than ${timeoutMs} ms`, timedOut);
    }
    if (facts === noGit) {
      return refuse('git does not run', noGit);
    }
    if ('reason' in facts) {
      facts.lines.forEach((line) => log(line));
      return refuse(facts.reason, inputRefused);
    }

    let plan: string;
    try {
      plan = await readFile(settings.planFile, 'utf8');
    } catch (error) {
      return refuse(`plan: ${(error as Error).message}`, inputRefused);
    }
    const units = planUnits(plan);
    if (units.length === 0) {
      return refuse(
        `plan ${settings.plan} has no unit heading (### U<n>. )`,
        inputRefused,
      );
    }

    let text: string;
    try {
      text = await readFile(settings.summary, 'utf8');
    } catch (error) {
      return refuse(`summary: ${(error as Error).message}`, summaryRefused);
    }
    const { reasons, summary } = checkSummary(text);
    if (summary !== undefined) {
      reasons.push(...checkBranch(summary, facts, units, settings.ignore));
    }
    for (const reason of reasons) {
      log(`work-summary: ${reason}`);
    }
    return reasons.length === 0 ? 0 : summaryRefused;
  } finally {
    await rm(home, { recursive: true });
  }
}

// The branch's facts, or why git couldn't read them, with the lines git
// wrote on its stderr.
type ReadBranch = Branch | typeof noGit | { reason: string; lines: string[] };

async function readBranch({
  gitBin,
  env,
  workspace,
  path,
  base,
  deadline,
  killGraceMs,
}: {
  gitBin: string;
  env: NodeJS.ProcessEnv;
  workspace: string;
  path: string;
  base: string;
  deadline: AbortSignal;
  killGraceMs: number;
}): Promise<ReadBranch> {
  // A git that hangs on --version doesn't run either.
  if (
    (await run(
      gitBin,
      ['--version'],
      { cwd: workspace, env, signal: deadline, killGraceMs },
      noGit,
    )) !== 0
  ) {
    return noGit;
  }

  // Runs git in the repository, and resolves with its exit code and what it
  // wrote on stdout, whole, and on stderr, by line.
  const git = async (...args: string[]) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await run(
      gitBin,
      args,
      {
        cwd: path,
        env,
        signal: deadline,
        killGraceMs,
        stdout: (line) => stdout.push(line),
        stderr: (line) => stderr.push(line),
      },
      inputRefused,
    );
    return { code, stdout: stdout.join('\n'), stderr };
  };
  const failed = (
    args: string[],
    { code, stderr }: { code: number; stderr: string[] },
  ) => ({
    reason: `git ${args[0]} exited with ${code}`,
    lines: stderr,
  });
  // The NUL-separated paths git wrote with -z.
  const paths = (stdout: string) =>
    stdout.split('\0').filter((path) => path !== '');

  const resolveArgs = ['rev-parse', '--verify', '--quiet', `${base}^{commit}`];
  const resolved = await git(...resolveArgs);
  if (resolved.code === 1) {
    return { reason: `base ${base} names no commit`, lines: [] };
  }
  if (resolved.code !== 0) {
    return failed(resolveArgs, resolved);
  }

  const mergeBaseArgs = ['merge-base', resolved.stdout, 'HEAD'];
  const mergeBase = await git(...mergeBaseArgs);
  if (mergeBase.code === 1) {
    return {
      reason: `base ${base} shares no history with HEAD here: the checkout lacks the branch's history`,
      lines: [],
    };
  }
  if (mergeBase.code !== 0) {
    return failed(mergeBaseArgs, mergeBase);
  }
  const from = mergeBase.stdout;

  const diffArgs = ['diff', '--name-only', '-z', '--no-renames', from, 'HEAD'];
  const diff = await git(...diffArgs);
  if (diff.code !== 0) {
    return failed(diffArgs, diff);
  }

  const treeArgs = [
    'ls-tree',
    '-r',
    '-z',
    '--full-tree',
    '--name-only',
    'HEAD',
  ];
  const tree = await git(...treeArgs);
  if (tree.code !== 0) {
    return failed(treeArgs, tree);
  }

  // One line per commit: its full SHA, its short one, its subject and the
  // values of its Units: trailers, matched regardless of case, joined by
  // commas.
  const logArgs = [
    'log',
    '--format=%H%x00%h%x00%s%x00%(trailers:key=Units,valueonly,unfold,separator=%x2C)',
    `${from}..HEAD`,
  ];
  const commits = await git(...logArgs);
  if (commits.code !== 0) {
    return failed(logArgs, commits);
  }
  const branch: Branch = {
    changed: paths(diff.stdout),
    commits: [],
    tree: paths(tree.stdout),
  };
  for (const line of commits.stdout.split('\n').filter((line) => line !== '')) {
    const [full = '', sha = '', subject = '', trailers = ''] = line.split('\0');
    // The paths it changed against its first parent: a merge lists what it
    // brought in.
    const changedArgs = [
      'diff',
      '--name-only',
      '-z',
      '--no-renames',
      `${full}^1`,
      full,
    ];
    const changed = await git(...changedArgs);
    if (changed.code !== 0) {
      return failed(changedArgs, changed);
    }
    branch.commits.push({
      sha,
      subject,
      units: trailers
        .split(',')
        .map((unit) => unit.trim())
        .filter((unit) => unit !== ''),
      paths: paths(changed.stdout),
    });
  }
  return branch;
}
