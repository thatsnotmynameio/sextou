import { afterEach, expect, test, vi } from 'vitest';
import { timeoutFetch } from '../../src/trpc';

// A fetch that answers only once its signal aborts, as a server that never
// answers does.
function hangingFetch() {
  return vi.fn(
    (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(init.signal?.reason),
        );
      }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// Real timers: fake ones don't fire AbortSignal.timeout.
test('timeoutFetch aborts a request that outlasts its timeout with a TimeoutError', async () => {
  vi.stubGlobal('fetch', hangingFetch());

  await expect(timeoutFetch(20)('http://server.test/')).rejects.toMatchObject({
    name: 'TimeoutError',
  });
});

test('timeoutFetch keeps the caller’s signal', async () => {
  vi.stubGlobal('fetch', hangingFetch());
  const controller = new AbortController();

  const request = timeoutFetch(60_000)('http://server.test/', {
    signal: controller.signal,
  });
  controller.abort();

  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
});

test('timeoutFetch passes the request on with the rest of its options', async () => {
  const fetch = vi.fn(async () => new Response('ok'));
  vi.stubGlobal('fetch', fetch);

  const response = await timeoutFetch(1000)('http://server.test/', {
    method: 'POST',
    body: 'input',
  });

  expect(await response.text()).toBe('ok');
  expect(fetch).toHaveBeenCalledWith(
    'http://server.test/',
    expect.objectContaining({ method: 'POST', body: 'input' }),
  );
});
