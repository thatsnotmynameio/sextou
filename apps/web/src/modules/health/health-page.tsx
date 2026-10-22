import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import type { TRPC } from '../../trpc';

// The server's version and whether its database answers, from health.check.
export function HealthPage({ trpc }: { trpc: TRPC }) {
  const health = useQuery(trpc.health.check.queryOptions());

  return (
    <section className="flex max-w-md flex-col gap-4">
      <h1 className="text-xl font-semibold text-strong">
        <Trans>Server health</Trans>
      </h1>
      {health.isPending ? (
        <p className="text-muted">
          <Trans>Checking the server…</Trans>
        </p>
      ) : health.isError ? (
        <p role="alert">
          {answered(health.error) ? (
            <Trans>
              The server answered with an error and couldn’t report its health.
            </Trans>
          ) : (
            <Trans>The server can’t be reached.</Trans>
          )}
        </p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-md border border-border p-4">
          <dt className="text-muted">
            <Trans>Version</Trans>
          </dt>
          <dd>{health.data.version}</dd>
          <dt className="text-muted">
            <Trans>Database</Trans>
          </dt>
          <dd>
            {health.data.database === 'up' ? (
              <Trans>up</Trans>
            ) : (
              <Trans>down</Trans>
            )}
          </dd>
        </dl>
      )}
    </section>
  );
}

// A tRPC error with data is one the server sent. Without data, no tRPC
// answer came back: the connection failed, the request timed out, or
// something other than the server answered.
function answered(error: unknown) {
  return error instanceof TRPCClientError && error.data !== undefined;
}
