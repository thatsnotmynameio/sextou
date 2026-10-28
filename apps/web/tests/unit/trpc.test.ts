import { delay, http, HttpResponse } from 'msw';
import { expect, test } from 'vitest';
import { timeoutFetch } from '../../src/trpc';
import { network, setUpNetwork } from '../network';

const url = 'http://server.test/';

setUpNetwork();

// A server that never answers.
function hanging() {
  network.use(
    http.all(url, async () => {
      await delay('infinite');
      return HttpResponse.text('never');
    }),
  );
}

// Real timers: fake ones don't fire AbortSignal.timeout.
test('timeoutFetch aborts a request that outlasts its timeout with a TimeoutError', async () => {
  hanging();

  await expect(timeoutFetch(20)(url)).rejects.toMatchObject({
    name: 'TimeoutError',
  });
});

test('timeoutFetch keeps the caller’s signal', async () => {
  hanging();
  const controller = new AbortController();

  const request = timeoutFetch(60_000)(url, { signal: controller.signal });
  controller.abort();

  await expect(request).rejects.toMatchObject({ name: 'AbortError' });
});

test('timeoutFetch passes the request on with the rest of its options', async () => {
  const received: { method: string; body: string }[] = [];
  network.use(
    http.all(url, async ({ request }) => {
      received.push({ method: request.method, body: await request.text() });
      return HttpResponse.text('ok');
    }),
  );

  const response = await timeoutFetch(1000)(url, {
    method: 'POST',
    body: 'input',
  });

  expect(await response.text()).toBe('ok');
  expect(received).toEqual([{ method: 'POST', body: 'input' }]);
});
