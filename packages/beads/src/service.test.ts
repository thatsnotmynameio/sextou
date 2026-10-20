import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createBeadsService, DEFAULT_ORGANIZATION } from './service';

const token = 'the-token';
const servers: Server[] = [];
const children: ChildProcess[] = [];

// A loopback server that records each request and answers with handle's
// status, or never answers when handle returns undefined.
async function listen(
  handle: (request: IncomingMessage) => number | undefined,
) {
  const requests: IncomingMessage[] = [];
  const server = createServer((request, response) => {
    requests.push(request);
    const status = handle(request);
    if (status !== undefined) response.writeHead(status).end();
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { port: (server.address() as AddressInfo).port, requests };
}

// A child process standing in for bd serve; only its state matters.
function child() {
  const process = spawn(globalThis.process.execPath, [
    '-e',
    'setInterval(() => {}, 1000)',
  ]);
  children.push(process);
  return process;
}

function service(port: number, serve = child()) {
  return createBeadsService({
    token,
    organizations: new Map([[DEFAULT_ORGANIZATION, { port, child: serve }]]),
  });
}

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    server.close();
  }
  for (const process of children.splice(0)) process.kill('SIGKILL');
});

describe('ping', () => {
  it('returns true when bd serve answers 200 to the readiness route', async () => {
    const { port, requests } = await listen(() => 200);

    await expect(service(port).ping(DEFAULT_ORGANIZATION)).resolves.toBe(true);

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('/v0/beads/ready?limit=1');
    expect(requests[0].headers.authorization).toBe(`Bearer ${token}`);
  });

  it.each([503, 401])('returns false for a %i answer', async (status) => {
    const { port } = await listen(() => status);
    await expect(service(port).ping(DEFAULT_ORGANIZATION)).resolves.toBe(false);
  });

  it('returns false when the connection is refused', async () => {
    const { port } = await listen(() => 200);
    const server = servers.pop() as Server;
    server.close();
    await once(server, 'close');

    await expect(service(port).ping(DEFAULT_ORGANIZATION)).resolves.toBe(false);
  });

  it('returns false when bd serve never answers', async () => {
    const { port } = await listen(() => undefined);
    await expect(service(port).ping(DEFAULT_ORGANIZATION)).resolves.toBe(false);
  }, 5000);

  it('returns false for an organization it does not know', async () => {
    const { port, requests } = await listen(() => 200);
    await expect(service(port).ping('other')).resolves.toBe(false);
    expect(requests).toHaveLength(0);
  });

  // Another local user could bind the freed port and collect the token.
  it('returns false without sending anything once bd serve exited', async () => {
    const { port, requests } = await listen(() => 200);
    const serve = child();
    serve.kill('SIGKILL');
    await once(serve, 'exit');

    await expect(service(port, serve).ping(DEFAULT_ORGANIZATION)).resolves.toBe(
      false,
    );
    expect(requests).toHaveLength(0);
  });
});
