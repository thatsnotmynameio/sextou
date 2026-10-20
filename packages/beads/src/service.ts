import type { ChildProcess } from 'node:child_process';

// The organization the server creates; the only one until organizations are
// a feature.
export const DEFAULT_ORGANIZATION = 'default';

// An organization's bd serve: the loopback port it listens on and the child
// the server spawned for it.
export interface ServedOrganization {
  port: number;
  child: Pick<ChildProcess, 'exitCode' | 'signalCode'>;
}

export interface BeadsService {
  // Whether the organization's bd serve answers with its database. Never
  // throws: any other answer, an error, a 2 s timeout or an unknown
  // organization is false.
  ping: (organization: string) => Promise<boolean>;
}

// The service sextou calls beads through, over each organization's bd serve
// with the token. It never runs the bd CLI.
export function createBeadsService({
  token,
  organizations,
}: {
  token: string;
  organizations: ReadonlyMap<string, ServedOrganization>;
}): BeadsService {
  return {
    ping: async (organization) => {
      const served = organizations.get(organization);
      // Once bd serve exited, another local user could bind its port and
      // collect the token.
      if (
        !served ||
        served.child.exitCode !== null ||
        served.child.signalCode !== null
      ) {
        return false;
      }
      try {
        const response = await fetch(
          `http://127.0.0.1:${served.port}/v0/beads/ready?limit=1`,
          {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(2000),
          },
        );
        await response.body?.cancel();
        return response.status === 200;
      } catch {
        return false;
      }
    },
  };
}
