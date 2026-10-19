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
// and no process state. A clock that stepped back after the start reports 0,
// never a negative uptime.
export function getHealth({ version, startedAt, now }: HealthInput): Health {
  return {
    version,
    uptimeSeconds: Math.max(
      0,
      Math.floor((now.getTime() - startedAt.getTime()) / 1000),
    ),
  };
}
