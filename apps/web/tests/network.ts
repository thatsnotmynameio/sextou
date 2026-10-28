import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

// The network a unit test sees: msw answers each request as the handlers the
// test adds (`network.use(…)`) say, and a request none of them takes fails
// the test.
export const network = setupServer();

// Starts the network for the calling test file and drops each test's handlers
// after it. msw rejects a request no handler takes, but the app may catch that
// rejection and show its no-answer state, which a test of that state would
// pass on: so the test also fails after it ends, naming each such request.
export function setUpNetwork() {
  const unhandled: string[] = [];
  beforeAll(() => {
    network.events.on('request:unhandled', ({ request }) => {
      unhandled.push(`${request.method} ${request.url}`);
    });
    network.listen({ onUnhandledFrame: 'error' });
  });
  afterEach(() => {
    network.resetHandlers();
    const requests = unhandled.splice(0);
    if (requests.length > 0) {
      throw new Error(`no handler took ${requests.join(', ')}`);
    }
  });
  afterAll(() => {
    network.events.removeAllListeners();
    network.close();
  });
}
