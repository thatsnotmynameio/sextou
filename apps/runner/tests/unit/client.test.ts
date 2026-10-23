import { afterEach, expect, test, vi } from 'vitest';
import { createRunnerClient, timeoutFetch } from '../../src/client';

const serverUrl = 'http://server.test';

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// The error a tRPC server sends for a procedure that threw.
function trpcError(code: string, httpStatus: number, message: string) {
  return json(
    { error: { message, code: -32000, data: { code, httpStatus } } },
    httpStatus,
  );
}

// fetch answering as `respond` says, keeping each request it got. httpLink
// calls it with the URL and the JSON body as strings.
function stubFetch(respond: () => Response | Promise<Response>) {
  const requests: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    (input: string, init: { method: string; body: string }) => {
      requests.push({
        url: input,
        method: init.method,
        body: JSON.parse(init.body),
      });
      return Promise.resolve(respond());
    },
  );
  return requests;
}

const claimed = {
  task: {
    id: 'tsk_1',
    title: 'Say hi',
    kind: 'task',
    priority: 2,
    parentId: null,
    assignee: { name: 'dev' },
    description: null,
    source: null,
    status: 'running',
  },
  execution: { id: 'exe_1', attempt: 1, leaseMs: 30000 },
};

test('claim posts its input to runners.claim and answers the server data', async () => {
  const requests = stubFetch(() => json({ result: { data: claimed } }));
  const client = createRunnerClient(serverUrl, 1000);

  const answer = await client.claim({
    claimId: 'c1',
    runner: 'r1',
    assignees: ['dev'],
  });

  expect(answer).toEqual({ ok: true, value: claimed });
  expect(requests).toEqual([
    {
      url: 'http://server.test/trpc/runners.claim',
      method: 'POST',
      body: { claimId: 'c1', runner: 'r1', assignees: ['dev'] },
    },
  ]);
});

test('heartbeat posts the execution id to runners.heartbeat', async () => {
  const requests = stubFetch(() =>
    json({ result: { data: { cancel: true, leaseMs: 9000 } } }),
  );

  const answer = await createRunnerClient(serverUrl, 1000).heartbeat('exe_1');

  expect(answer).toEqual({ ok: true, value: { cancel: true, leaseMs: 9000 } });
  expect(requests).toEqual([
    {
      url: 'http://server.test/trpc/runners.heartbeat',
      method: 'POST',
      body: { executionId: 'exe_1' },
    },
  ]);
});

test('complete posts its input to runners.complete', async () => {
  const requests = stubFetch(() => json({ result: { data: null } }));

  const answer = await createRunnerClient(serverUrl, 1000).complete({
    runner: 'r1',
    executionId: 'exe_1',
    outcome: 'succeeded',
  });

  expect(answer).toEqual({ ok: true, value: null });
  expect(requests).toEqual([
    {
      url: 'http://server.test/trpc/runners.complete',
      method: 'POST',
      body: { runner: 'r1', executionId: 'exe_1', outcome: 'succeeded' },
    },
  ]);
});

test('a CONFLICT whose message is lease_lost answers lease_lost', async () => {
  stubFetch(() => trpcError('CONFLICT', 409, 'lease_lost'));

  const answer = await createRunnerClient(serverUrl, 1000).heartbeat('exe_1');

  expect(answer).toEqual({
    ok: false,
    failure: 'lease_lost',
    message: 'lease_lost',
  });
});

test.each([
  ['CONFLICT', 409, 'not_running'],
  ['TIMEOUT', 408, 'timeout'],
  ['BAD_REQUEST', 400, 'lease_lost'],
])(
  'an error the server sent with code %s and message %s answers refused',
  async (code, status, message) => {
    stubFetch(() => trpcError(code, status, message));

    const answer = await createRunnerClient(serverUrl, 1000).heartbeat('exe_1');

    expect(answer).toEqual({ ok: false, failure: 'refused', message });
  },
);

test('a connection that fails answers no_answer', async () => {
  vi.stubGlobal('fetch', () => Promise.reject(new TypeError('fetch failed')));

  const answer = await createRunnerClient(serverUrl, 1000).heartbeat('exe_1');

  expect(answer).toEqual({
    ok: false,
    failure: 'no_answer',
    message: 'fetch failed',
  });
});

test('an answer that is not tRPC answers no_answer', async () => {
  stubFetch(
    () =>
      new Response('<!doctype html><title>Not Found</title>', {
        status: 404,
        headers: { 'content-type': 'text/html' },
      }),
  );

  const answer = await createRunnerClient(serverUrl, 1000).heartbeat('exe_1');

  expect(answer).toMatchObject({ ok: false, failure: 'no_answer' });
});

test('a call the server does not answer within the timeout answers no_answer', async () => {
  vi.stubGlobal(
    'fetch',
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason),
        );
      }),
  );

  const answer = await createRunnerClient(serverUrl, 20).heartbeat('exe_1');

  expect(answer).toMatchObject({ ok: false, failure: 'no_answer' });
});

test('timeoutFetch aborts the request once the timeout passes', async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return Promise.resolve(new Response('ok'));
  });

  await timeoutFetch(20)('http://server.test');

  expect(signal?.aborted).toBe(false);
  await vi.waitFor(() => expect(signal?.aborted).toBe(true));
  expect(signal?.reason).toMatchObject({ name: 'TimeoutError' });
});

test("timeoutFetch aborts the request when the caller's signal aborts", async () => {
  let signal: AbortSignal | undefined;
  vi.stubGlobal('fetch', (_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal ?? undefined;
    return Promise.resolve(new Response('ok'));
  });
  const caller = new AbortController();

  await timeoutFetch(60000)('http://server.test', { signal: caller.signal });
  caller.abort(new Error('gone'));

  expect(signal?.aborted).toBe(true);
  expect(signal?.reason).toEqual(new Error('gone'));
});

test('timeoutFetch keeps the rest of the request', async () => {
  const fetch = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) =>
    Promise.resolve(new Response('ok')),
  );
  vi.stubGlobal('fetch', fetch);

  const response = await timeoutFetch(60000)('http://server.test/x', {
    method: 'POST',
    body: '{}',
  });

  expect(await response.text()).toBe('ok');
  expect(fetch.mock.calls[0][0]).toBe('http://server.test/x');
  expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', body: '{}' });
});
