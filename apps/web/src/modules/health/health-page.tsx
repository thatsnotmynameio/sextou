import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { TRPCClientError } from '@trpc/client';
import { CircleAlert } from 'lucide-react';
import type { TRPC } from '../../trpc';

// The server's version and whether its database answers, from health.check.
// The route's title, in the shell's header, names the page.
export function HealthPage({ trpc }: { trpc: TRPC }) {
  const health = useQuery(trpc.health.check.queryOptions());

  return (
    <section className="flex max-w-md flex-col gap-4">
      {health.isPending ? (
        // The shape of the answer, until it arrives.
        <div className="flex flex-col gap-2 rounded-box border border-base-300 p-4">
          <span className="sr-only">
            <Trans>Checking the server…</Trans>
          </span>
          <div aria-hidden="true" className="skeleton h-6 w-40" />
          <div aria-hidden="true" className="skeleton h-6 w-32" />
        </div>
      ) : health.isError ? (
        <div role="alert" className="alert alert-error alert-soft">
          <CircleAlert aria-hidden="true" size={18} />
          <span>
            {answered(health.error) ? (
              <Trans>
                The server answered with an error and couldn’t report its
                health.
              </Trans>
            ) : (
              <Trans>The server can’t be reached.</Trans>
            )}
          </span>
        </div>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 rounded-box border border-base-300 p-4">
          <dt className="text-base-content/70">
            <Trans>Version</Trans>
          </dt>
          <dd className="font-mono">{health.data.version}</dd>
          <dt className="text-base-content/70">
            <Trans>Database</Trans>
          </dt>
          <dd className="flex items-center gap-2">
            {health.data.database === 'up' ? (
              <>
                <span aria-hidden="true" className="status status-success" />
                <Trans>up</Trans>
              </>
            ) : (
              <>
                <span aria-hidden="true" className="status status-error" />
                <Trans>down</Trans>
              </>
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
