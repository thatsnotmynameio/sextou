// Fake bd and dolt for the tests: each is a #!/bin/sh wrapper that runs a
// Node script with the test's Node. The children get no PATH, so a
// `#!/usr/bin/env node` shebang would not find Node, and exec keeps the pid
// the run files record.
import { once } from 'node:events';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

// A loopback port nothing listens on, picked by the system.
export async function freePort(): Promise<number> {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

export interface Call {
  pid: number;
  argv: string[];
  env: Record<string, string>;
  cwd: string;
}

// Writes an executable wrapper at file that runs the fake script with the
// given leading arguments: the file its calls are recorded in, and a mode.
export function fakeBinary(
  file: string,
  script: 'fake-dolt.ts' | 'fake-bd.ts',
  calls: string,
  mode = 'normal',
) {
  writeFileSync(
    file,
    `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dirname, script)}" "${calls}" "${mode}" "$@"\n`,
  );
  chmodSync(file, 0o755);
  return file;
}

// Every call a fake recorded, oldest first.
export function recordedCalls(calls: string): Call[] {
  if (!existsSync(calls)) return [];
  return readFileSync(calls, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Call);
}

// Kills every process a fake recorded; detached fakes outlive the test.
export function killRecorded(calls: string) {
  for (const { pid } of recordedCalls(calls)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}
