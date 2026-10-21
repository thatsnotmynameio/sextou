import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { render, screen } from '@testing-library/react';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { createAppRouter } from '../../router';

// The server runs as its own process, from its sources, with its own
// tsx: the web app imports nothing from it but its router's type.
const serverDir = join(import.meta.dirname, '../../../../server');
const { version } = JSON.parse(
  readFileSync(join(serverDir, 'package.json'), 'utf8'),
);

let dir: string;
let server: ChildProcess | undefined;

// Starts the server on a port the system picks and resolves with its URL,
// from the line it prints once listening.
async function startServer(database: string): Promise<string> {
  server = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: serverDir,
    env: {
      PATH: process.env.PATH,
      SEXTOU_SERVER_PORT: '0',
      SEXTOU_SERVER_DATABASE: database,
      SEXTOU_SERVER_DATA_DIR: dir,
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  for await (const line of createInterface({ input: server.stdout! })) {
    const url = /^listening on (http:\/\/\S+)$/.exec(line)?.[1];
    if (url) return url;
  }
  throw new Error('The server exited before listening');
}

function renderHome(serverUrl: string) {
  const router = createAppRouter({
    serverUrl,
    requestTimeoutMs: 10_000,
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

  expect(await screen.findByText(version)).toBeInTheDocument();
  expect(screen.getByText('up')).toBeInTheDocument();
});

// Covers AE2.
test('the health page shows the database down when the server can’t open it', async () => {
  writeFileSync(join(dir, 'file'), '');
  renderHome(await startServer(join(dir, 'file', 'sextou.db')));

  expect(await screen.findByText(version)).toBeInTheDocument();
  expect(screen.getByText('down')).toBeInTheDocument();
});

// Covers AE3: nothing listens on the port a stopped server used.
test('the health page says the server can’t be reached once it stops', async () => {
  const url = await startServer(':memory:');
  const exited = once(server!, 'exit');
  server!.kill('SIGTERM');
  await exited;

  renderHome(url);

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The server can’t be reached.',
  );
});
