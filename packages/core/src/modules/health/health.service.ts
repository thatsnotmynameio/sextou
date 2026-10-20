export interface HealthInput {
  version: string;
  startedAt: Date;
  now: Date;
  // Whether the database answered a query just now.
  databaseAnswers: boolean;
}

export interface Health {
  version: string;
  uptimeSeconds: number;
  database: 'up' | 'down';
}

// The caller passes the version, both times and the database's answer, so the
// core reads no clock and no process state. A clock that stepped back after
// the start reports 0, never a negative uptime.
export function getHealth({
  version,
  startedAt,
  now,
  databaseAnswers,
}: HealthInput): Health {
  return {
    version,
    uptimeSeconds: Math.max(
      0,
      Math.floor((now.getTime() - startedAt.getTime()) / 1000),
    ),
    database: databaseAnswers ? 'up' : 'down',
  };
}
