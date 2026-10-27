import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    serverUrl: string;
  }
}

// The server runs as its own process, from its sources, with its own tsx:
// the runner imports nothing from it but its router's type. Its folder is
// found through the workspace's link, which Stryker's sandbox, a copy of this
// package in another folder, reaches too.
const serverDir = dirname(
  dirname(createRequire(import.meta.url).resolve('@sextou/server/router')),
);

// How long the server has to log that it listens, as the beforeAll that
// started it had: Vitest gives a global setup no timeout of its own.
const startTimeoutMs = 30_000;

/**
 * The integration suite's global setup: starts the server on a port the
 * system picks, with a short lease, once per Vitest instance, and hands its
 * URL to the tests as `serverUrl`. Stryker keeps one instance per worker and
 * runs a test file again for each mutant, so the server starts once per
 * worker instead of once per mutant. A server that exits or doesn't listen
 * within startTimeoutMs is stopped, its folder removed, and the setup fails.
 * @param project the project the tests inject the URL from
 * @returns the teardown, which stops the server and removes its data folder
 */
export default async function setup(project: TestProject) {
  const dir = mkdtempSync(join(tmpdir(), 'sextou-runner-server-'));
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH,
      SEXTOU_SERVER_PORT: '0',
      SEXTOU_SERVER_DATA_DIR: dir,
      SEXTOU_SERVER_LEASE_MS: '600',
      SEXTOU_SERVER_LEASE_SWEEP_MS: '100',
      SEXTOU_SERVER_LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const stop = async () => {
    if (server.exitCode === null && server.signalCode === null) {
      const exited = once(server, 'exit');
      server.kill('SIGTERM');
      await exited;
    }
    rmSync(dir, { recursive: true, force: true });
  };
  let url: string;
  try {
    url = await withDeadline(listening(server.stdout), startTimeoutMs);
  } catch (error) {
    await stop();
    throw error;
  }
  // Closing readline paused stdout: reading on keeps a server that outlives
  // many runs from blocking on a full pipe.
  server.stdout.resume();
  project.provide('serverUrl', url);
  return stop;
}

// Resolves as `promise` does, or rejects once `ms` pass first.
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`The server didn't listen within ${ms} ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

// Resolves with the URL of the record the server logs once listening.
async function listening(stdout: NodeJS.ReadableStream): Promise<string> {
  for await (const line of createInterface({ input: stdout })) {
    const record = parseRecord(line);
    if (record?.msg === 'listening' && typeof record.url === 'string') {
      return record.url;
    }
  }
  throw new Error('The server exited before listening');
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
