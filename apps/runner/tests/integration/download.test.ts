import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { RequestListener } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  afterEach,
  beforeEach,
  expect,
  onTestFinished,
  test,
  vi,
} from 'vitest';
import { download } from '../../src/download';
import { answer, archive, serve } from '../archive';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-download-'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const repository = archive({
  'tasks/hello/Taskfile.yml': 'version: "3"\n',
  'README.md': 'hello\n',
});

// Serves `listener` for the test, and downloads its root's URL into `dir`.
async function from(
  listener: RequestListener,
  { timeoutMs = 5000, signal = new AbortController().signal } = {},
) {
  const server = await serve(listener);
  onTestFinished(server.close);
  return download({ url: `${server.url}/archive`, dir, timeoutMs, signal });
}

// Answers with the headers and part of the repository's tarball, then holds
// the connection open.
const hang: RequestListener = (_request, response) => {
  response.write(repository.subarray(0, 64));
};

test('download extracts the tarball without its top folder', async () => {
  expect(await from(answer(repository))).toBeUndefined();

  expect(readFileSync(join(dir, 'tasks/hello/Taskfile.yml'), 'utf8')).toBe(
    'version: "3"\n',
  );
  expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('hello\n');
});

test('download follows a redirect', async () => {
  const listener: RequestListener = (request, response) => {
    if (request.url === '/archive') {
      response.writeHead(302, { location: '/codeload' }).end();
    } else {
      response.end(repository);
    }
  };

  expect(await from(listener)).toBeUndefined();
  expect(existsSync(join(dir, 'README.md'))).toBe(true);
});

test('download resolves the status of an answer that is not ok', async () => {
  const notFound: RequestListener = (_request, response) => {
    response.writeHead(404).end('Not Found');
  };

  expect(await from(notFound)).toBe('HTTP 404');
});

test('download resolves the status of an ok answer without a body', async () => {
  const noContent: RequestListener = (_request, response) => {
    response.writeHead(204).end();
  };

  expect(await from(noContent)).toBe('HTTP 204');
});

test('download resolves timeout when no answer comes within timeoutMs', async () => {
  expect(await from(() => undefined, { timeoutMs: 200 })).toBe('timeout');
});

test('download resolves timeout when the tarball does not end within timeoutMs', async () => {
  expect(await from(hang, { timeoutMs: 300 })).toBe('timeout');
});

test('download resolves aborted when its signal aborts before an answer', async () => {
  const controller = new AbortController();
  const result = from(() => controller.abort(), {
    signal: controller.signal,
  });

  expect(await result).toBe('aborted');
});

test('download resolves aborted when its signal aborts while tar extracts', async () => {
  const controller = new AbortController();
  const result = from(
    (request, response) => {
      hang(request, response);
      setTimeout(() => controller.abort(), 100);
    },
    { signal: controller.signal },
  );

  expect(await result).toBe('aborted');
});

test('download resolves why the request failed', async () => {
  const server = await serve(answer(repository));
  await server.close();

  expect(
    await download({
      url: server.url,
      dir,
      timeoutMs: 5000,
      signal: new AbortController().signal,
    }),
  ).toBe('fetch failed');
});

test("download resolves tar's exit code and stderr for a body that is not gzip", async () => {
  // GNU tar has gzip say it first, bsdtar says it itself.
  expect(await from(answer(Buffer.from('not a tarball')))).toMatch(
    /^tar exit code [1-9]\d*: (gzip|tar): \S.*\S$/s,
  );
});

test('download resolves why tar did not start', async () => {
  vi.stubEnv('PATH', '');

  expect(await from(answer(repository))).toBe('spawn tar ENOENT');
});
