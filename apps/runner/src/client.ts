import type { AppRouter } from '@sextou/server/router';
import { createTRPCClient, httpLink, type TRPCClientError } from '@trpc/client';

// How a call ended without the answer the runner asked for: the server
// refused it because the attempt lost its lease, the server didn't serve it
// in time and wrote nothing, the server refused it for another reason, or
// no answer from the server arrived (the connection failed, the call timed
// out, or something else answered).
export type Failure = 'lease_lost' | 'timeout' | 'refused' | 'no_answer';

export type Answer<T> =
  | { ok: true; value: T }
  | { ok: false; failure: Failure; message: string };

// fetch that gives up once `timeoutMs` pass, keeping the caller's own
// signal: httpLink has no timeout of its own. The same as the web app's.
export function timeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    return fetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
    });
  };
}

// The runners procedures of the server at `serverUrl`, each answering an
// Answer instead of throwing, so the runner's loop knows nothing of tRPC.
export function createRunnerClient(serverUrl: string, timeoutMs: number) {
  const { runners } = createTRPCClient<AppRouter>({
    links: [
      httpLink({ url: `${serverUrl}/trpc`, fetch: timeoutFetch(timeoutMs) }),
    ],
  });
  return {
    claim: (input: Parameters<typeof runners.claim.mutate>[0]) =>
      answer(runners.claim.mutate(input)),
    heartbeat: (executionId: string) =>
      answer(runners.heartbeat.mutate({ executionId })),
    complete: (input: Parameters<typeof runners.complete.mutate>[0]) =>
      answer(runners.complete.mutate(input)),
  };
}

export type RunnerClient = ReturnType<typeof createRunnerClient>;

// The client wraps every failure in a TRPCClientError: one the server sent
// carries data, one without data never came from it.
async function answer<T>(call: Promise<T>): Promise<Answer<T>> {
  try {
    return { ok: true, value: await call };
  } catch (error) {
    const { data, message } = error as TRPCClientError<AppRouter>;
    if (!data) {
      return { ok: false, failure: 'no_answer', message };
    }
    if (data.code === 'TIMEOUT') {
      return { ok: false, failure: 'timeout', message };
    }
    const leaseLost = data.code === 'CONFLICT' && message === 'lease_lost';
    return {
      ok: false,
      failure: leaseLost ? 'lease_lost' : 'refused',
      message,
    };
  }
}
