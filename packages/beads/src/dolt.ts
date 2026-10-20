import { spawn } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { doltEnv, type ChildEnvContext } from './child-env';
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

export interface DoltOptions {
  binary: string;
  version: string;
  port: number;
  layout: Layout;
  env: ChildEnvContext;
  // How long a new Dolt has to accept connections, in milliseconds.
  readyTimeout?: number;
}

// Makes sure sextou's Dolt runs on the port: reuses the one it started when
// it serves this data directory on the pinned version, replaces it on another
// version, and starts one when the port is free. Anything else on the port
// fails. A started Dolt is detached and outlives the server.
export async function ensureDolt(options: DoltOptions): Promise<void> {
  const { layout, port, version } = options;
  const recorded = readRunFile(layout.doltRun);
  // Two independent records must agree: sextou's own and the one Dolt keeps
  // in the folder it serves.
  const ours =
    recorded !== undefined &&
    recorded.port === port &&
    recorded.pid === servingPid(layout) &&
    isAlive(recorded.pid) &&
    (await portAccepts(port));

  if (ours && recorded.version === version) return;
  if (ours) {
    // The new one must never find the old one still writing to the folder.
    await stopProcess(recorded.pid, 30_000);
    removeRunFile(layout.doltRun);
  } else if (await portAccepts(port)) {
    throw new Error(`Port ${port} is held by a process sextou did not start`);
  }
  await startDolt(options);
}

// The pid in Dolt's sql-server.info (pid:port:secret), if any.
function servingPid(layout: Layout): number | undefined {
  try {
    const info = readFileSync(
      path.join(layout.dolt, '.dolt', 'sql-server.info'),
      'utf8',
    );
    return Number(info.split(':')[0]);
  } catch {
    return undefined;
  }
}

async function startDolt({
  binary,
  version,
  port,
  layout,
  env,
  readyTimeout = 30_000,
}: DoltOptions) {
  // Dolt applies the root password only on the launch that creates
  // privileges.db; a lost password can't be set again.
  const privileges = path.join(layout.dolt, '.doltcfg', 'privileges.db');
  const firstLaunch = !existsSync(privileges);
  if (!firstLaunch && !existsSync(layout.doltPassword)) {
    throw new Error(
      `${privileges} exists but ${layout.doltPassword} is missing: Dolt's root password is lost`,
    );
  }
  const password = readOrCreateSecret(layout.doltPassword);

  const log = openSync(layout.doltLog, 'a', 0o600);
  const child = spawn(
    binary,
    [
      'sql-server',
      '-H',
      '127.0.0.1',
      '-P',
      String(port),
      '--data-dir',
      layout.dolt,
      '--loglevel',
      'warning',
    ],
    {
      cwd: layout.dolt,
      env: doltEnv(env, firstLaunch ? password : undefined),
      // Its own process group, so a Ctrl+C in a terminal doesn't reach it.
      detached: true,
      stdio: ['ignore', log, log],
      windowsHide: true,
    },
  );
  closeSync(log);
  child.unref();

  let exited = false;
  const failed = new Promise<never>((_, reject) => {
    child.once('error', reject);
    child.once('exit', () => {
      exited = true;
      reject(
        new Error(
          `Dolt exited before accepting connections: ${lastLines(layout.doltLog)}`,
        ),
      );
    });
  });
  failed.catch(() => undefined);
  if (child.pid !== undefined) {
    writeRunFile(layout.doltRun, { pid: child.pid, port, version });
  }

  const ready = await Promise.race([
    waitFor(() => exited || portAccepts(port), readyTimeout),
    failed,
  ]);
  if (exited) await failed;
  if (!ready) {
    child.kill('SIGKILL');
    removeRunFile(layout.doltRun);
    throw new Error(
      `Dolt did not accept connections on port ${port} within ${readyTimeout / 1000} s`,
    );
  }
}
