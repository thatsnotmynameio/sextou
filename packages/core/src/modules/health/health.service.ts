export interface HealthInput {
  version: string;
  startedAt: Date;
  now: Date;
}

export interface Health {
  version: string;
  uptimeSeconds: number;
}

// The caller passes the version and both times, so the core reads no clock
// and no process state.
export function getHealth({ version, startedAt, now }: HealthInput): Health {
  return {
    version,
    uptimeSeconds: Math.floor((now.getTime() - startedAt.getTime()) / 1000),
  };
}
