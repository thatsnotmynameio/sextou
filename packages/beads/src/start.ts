import { readFileSync } from 'node:fs';
import { startBdServe, stopLeftoverBdServe } from './bd-serve';
import { ensureBinaries } from './binaries';
import type { ChildEnvContext } from './child-env';
import { ensureDolt } from './dolt';
import { layoutOf, prepareFolders, type Layout } from './layout';
import { ensureOrganization } from './organization';
import { pins as pinned, type Pins } from './pins';
import { findGit, tarPath } from './platform';
import { removeRunFile, stopProcess } from './processes';
import {
  createBeadsService,
  DEFAULT_ORGANIZATION,
  type BeadsService,
} from './service';

export interface StartOptions {
  // sextou's data directory, absolute.
  dataDir: string;
  // The server's PATH, where git is found.
  pathEnv: string | undefined;
  // On Windows, the server's SystemRoot, TEMP and TMP.
  windowsEnv: ChildEnvContext['windowsEnv'];
  // Where progress lines go, such as each download.
  log: (line: string) => void;
  // Each one defaults to the real one; tests pass their own.
  platform?: NodeJS.Platform;
  arch?: string;
  fetch?: typeof fetch;
  pins?: Pins;
  doltPort?: number;
  bdServePort?: number;
  // How long Dolt and bd serve each have to get ready, in milliseconds.
  readyTimeout?: number;
}

export interface Beads {
  service: BeadsService;
  // Stops each bd serve. Dolt keeps running.
  stop: () => Promise<void>;
}

// A failed start step, named for the server's message.
export class BeadsStartError extends Error {
  constructor(
    readonly step: string,
    readonly reason: string,
  ) {
    super(`${step}: ${reason}`);
    this.name = 'BeadsStartError';
  }
}

// Brings beads up: the binaries, then stopping a leftover bd serve, then
// sextou's Dolt, then the default organization's database, then its bd
// serve. Throws only a BeadsStartError, naming the step that failed; a step
// that fails stops what it started, and a ready Dolt keeps running.
export async function startBeads({
  dataDir,
  pathEnv,
  windowsEnv,
  log,
  platform = process.platform,
  arch = process.arch,
  fetch = globalThis.fetch,
  pins = pinned,
  doltPort = 4311,
  bdServePort = 4312,
  readyTimeout,
}: StartOptions): Promise<Beads> {
  const layout = layoutOf(dataDir);
  const env = { platform, layout, windowsEnv };

  const { bd, dolt, git } = await step(layout, 'binaries', async () => {
    prepareFolders(layout);
    const git = findGit(pathEnv, platform);
    const binaries = await ensureBinaries({
      layout,
      pins,
      platform,
      arch,
      tar: tarPath(platform, windowsEnv),
      fetch,
      log,
    });
    return { ...binaries, git };
  });
  await step(layout, 'bd serve leftover', () => stopLeftoverBdServe(layout));
  await step(layout, 'dolt', () =>
    ensureDolt({
      binary: dolt,
      version: pins.dolt.version,
      port: doltPort,
      layout,
      env,
      readyTimeout,
    }),
  );
  // The Dolt step created the password.
  const doltPassword = await step(layout, 'organization', async () => {
    const doltPassword = readFileSync(layout.doltPassword, 'utf8');
    await ensureOrganization({ bd, git, doltPort, doltPassword, layout, env });
    return doltPassword;
  });
  const serve = await step(layout, 'bd serve', () =>
    startBdServe({
      bd,
      git,
      port: bdServePort,
      doltPassword,
      layout,
      env,
      readyTimeout,
    }),
  );

  return {
    service: createBeadsService({
      token: serve.token,
      organizations: new Map([
        [DEFAULT_ORGANIZATION, { port: bdServePort, child: serve.child }],
      ]),
    }),
    stop: async () => {
      // A bd serve that got ready has a pid.
      await stopProcess(serve.child.pid as number, 25_000);
      removeRunFile(layout.bdServeRun);
    },
  };
}

// Runs a step, turning its failure into a BeadsStartError. A tool can print
// a credential it was given, so the message never carries one.
async function step<T>(
  layout: Layout,
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    let reason = (error as Error).message;
    for (const file of [layout.doltPassword, layout.bdServeToken]) {
      try {
        reason = reason.replaceAll(readFileSync(file, 'utf8'), '[redacted]');
      } catch {
        // Not created yet.
      }
    }
    throw new BeadsStartError(name, reason);
  }
}
