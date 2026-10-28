import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';

// The network a unit test sees: msw answers each request as the handlers the
// test adds (`network.use(…)`) say, and a request none of them takes fails
// the test.
export const network = setupServer();

// Starts the network for the calling test file and drops each test's handlers
// after it.
export function setUpNetwork() {
  beforeAll(() => {
    network.listen({ onUnhandledFrame: 'error' });
  });
  afterEach(() => {
    network.resetHandlers();
  });
  afterAll(() => {
    network.close();
  });
}
