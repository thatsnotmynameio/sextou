import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { render, screen } from '@testing-library/react';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createAppRouter } from '../../../../src/router';

// The server runs as its own process, from its sources, with its own
// tsx: the web app imports nothing from it but its router's type. Its folder
// is found through the workspace's link, which Stryker's sandbox, a copy of
// this package in another folder, reaches too.
const serverDir = dirname(
  dirname(createRequire(import.meta.url).resolve('@sextou/server/router')),
);
const { version } = JSON.parse(
  readFileSync(join(serverDir, 'package.json'), 'utf8'),
);

let dir: string;
let server: ChildProcess | undefined;

// Starts the server on a port the system picks and resolves with its URL,
// from the record it logs once listening. Its stdout is one JSON record per
// line; a line that isn't JSON is skipped.
async function startServer(database: string): Promise<string> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH,
      SEXTOU_SERVER_PORT: '0',
      SEXTOU_SERVER_DATABASE: database,
      SEXTOU_SERVER_DATA_DIR: dir,
      // At warn and above, the server doesn't log where it listens.
      SEXTOU_SERVER_LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  // The spawned process keeps its stdio's types; the variable the cleanup
  // reads doesn't.
  server = child;
  for await (const line of createInterface({ input: child.stdout })) {
    const record = parseRecord(line);
    if (record?.msg === 'listening' && typeof record.url === 'string') {
      return record.url;
    }
  }
  throw new Error('The server exited before listening');
}

function parseRecord(line: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

// A real server's first answer, which opens its database, can take longer
// than Testing Library's one second: wait as long as the request may.
const requestTimeoutMs = 10_000;
const wait = { timeout: requestTimeoutMs };

function renderHome(serverUrl: string) {
  const router = createAppRouter({
    serverUrl,
    requestTimeoutMs,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-web-'));
});

afterEach(async () => {
  // A process a signal ended has a signalCode and no exitCode.
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = once(server, 'exit');
    server.kill('SIGTERM');
    await exited;
  }
  server = undefined;
  rmSync(dir, { recursive: true, force: true });
});

// Covers AE1.
test('the health page shows the server’s version and its database up', async () => {
  renderHome(await startServer(':memory:'));

  expect(await screen.findByText(version, {}, wait)).toBeInTheDocument();
  expect(screen.getByText('up')).toBeInTheDocument();
});

// Covers AE2.
test('the health page shows the database down when the server can’t open it', async () => {
  writeFileSync(join(dir, 'file'), '');
  renderHome(await startServer(join(dir, 'file', 'sextou.db')));

  expect(await screen.findByText(version, {}, wait)).toBeInTheDocument();
  expect(screen.getByText('down')).toBeInTheDocument();
});

// Covers AE3: nothing listens on a port a closed listener freed.
test('the health page says the server can’t be reached when nothing listens', async () => {
  const listener = createServer().listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const { port } = listener.address() as AddressInfo;
  await new Promise((closed) => listener.close(closed));

  renderHome(`http://127.0.0.1:${port}`);

  expect(await screen.findByRole('alert', {}, wait)).toHaveTextContent(
    'The server can’t be reached.',
  );
});
