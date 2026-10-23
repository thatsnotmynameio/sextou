import type { AppRouter } from '@sextou/server/router';
import type { TRPCClientError } from '@trpc/client';
import type { Client } from './client';
import type { Logger } from './logger';

export interface PollOptions {
  client: Client;
  // The wait after each request settles, before the next one.
  intervalMs: number;
  logger: Logger;
  // Ends the loop: it ends the wait, and aborts a request in flight.
  signal: AbortSignal;
}

// Asks the server for a task, logs the answer, waits the interval, and again,
// until the signal aborts. One request at a time, so a server that hangs
// never piles them up. A failed request is logged and the loop goes on.
export async function poll({
  client,
  intervalMs,
  logger,
  signal,
}: PollOptions) {
  while (!signal.aborted) {
    try {
      await client.runner.next.query(undefined, { signal });
      logger.info('no task');
    } catch (error) {
      // A request the runner itself aborted, to stop, didn't fail.
      if (signal.aborted) {
        return;
      }
      logger.warn(failure(error), 'request failed');
    }
    await wait(intervalMs, signal);
  }
}

// What a failure record says, with no stack: a down server would write one
// every interval. An error the server sent carries data, with its tRPC code;
// without data there was no answer: the connection failed, the request timed
// out, or something other than the server answered. The client rejects only
// with a TRPCClientError.
function failure(error: unknown) {
  const { message, data } = error as TRPCClientError<AppRouter>;
  return data
    ? { kind: 'server-error', code: data.code, error: message }
    : { kind: 'no-answer', error: message };
}

// Resolves once `ms` pass, or at once when the signal aborts.
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      // Stryker disable next-line CallExpression: a timer left after an abort would only resolve a promise already resolved.
      clearTimeout(timer);
      // Stryker disable next-line StringLiteral,CallExpression: a listener left after the timer would only resolve a promise already resolved.
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done);
  });
}
