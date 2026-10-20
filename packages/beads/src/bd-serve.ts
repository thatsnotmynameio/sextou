import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { bdEnv, type ChildEnvContext } from './child-env';
import type { Layout } from './layout';
import {
  isAlive,
  lastLines,
  portAccepts,
  readRunFile,
  removeRunFile,
  stopProcess,
  waitFor,
  writeRunFile,
} from './processes';
import { readOrCreateSecret } from './secrets';
import { createBeadsService, DEFAULT_ORGANIZATION } from './service';

export interface BdServeOptions {
  bd: string;
  git: string;
  port: number;
  doltPassword: string;
  layout: Layout;
  env: ChildEnvContext;
  // How long bd serve has to get ready, in milliseconds.
  readyTimeout?: number;
}

export interface RunningBdServe {
  child: ChildProcess;
  token: string;
}

// Stops the bd serve an earlier run recorded, when its pid is alive and
// still holds its port; bd serve drains for 20 s. The run file goes either
// way. It runs before the Dolt step, since a leftover holds connections to a
// Dolt that may be replaced.
export async function stopLeftoverBdServe(layout: Layout): Promise<void> {
  const recorded = readRunFile(layout.bdServeRun);
  if (!recorded) return;
  if (isAlive(recorded.pid) && (await portAccepts(recorded.port))) {
    await stopProcess(recorded.pid, 25_000);
  }
  removeRunFile(layout.bdServeRun);
}

// Starts the default organization's bd serve with its token, in the server's
// process group so a Ctrl+C reaches it too, and resolves once it answers the
// readiness route. Kills it and throws when it exits or never gets ready.
export async function startBdServe({
  bd,
  git,
  port,
  doltPassword,
  layout,
  env,
  readyTimeout = 30_000,
}: BdServeOptions): Promise<RunningBdServe> {
  const token = readOrCreateSecret(layout.bdServeToken);
  const log = openSync(layout.bdServeLog, 'a', 0o600);
  const child = spawn(
    bd,
    [
      'serve',
      '--addr',
      `127.0.0.1:${port}`,
      '--auth-token-file',
      layout.bdServeToken,
    ],
    {
      cwd: layout.organization,
      env: bdEnv(env, doltPassword, git),
      stdio: ['ignore', log, log],
      windowsHide: true,
    },
  );
  closeSync(log);

  let exited = false;
  const failed = new Promise<never>((_, reject) => {
    child.once('error', reject);
    child.once('exit', () => {
      exited = true;
      reject(
        new Error(
          `bd serve exited before it was ready: ${lastLines(layout.bdServeLog)}`,
        ),
      );
    });
  });
  failed.catch(() => undefined);
  if (child.pid !== undefined) {
    writeRunFile(layout.bdServeRun, { pid: child.pid, port });
  }

  const service = createBeadsService({
    token,
    organizations: new Map([[DEFAULT_ORGANIZATION, { port, child }]]),
  });
  const ready = await Promise.race([
    waitFor(
      async () => exited || (await service.ping(DEFAULT_ORGANIZATION)),
      readyTimeout,
    ),
    failed,
  ]);
  if (exited) await failed;
  if (!ready) {
    child.kill('SIGKILL');
    removeRunFile(layout.bdServeRun);
    throw new Error(
      `bd serve was not ready on port ${port} within ${readyTimeout / 1000} s`,
    );
  }
  return { child, token };
}
