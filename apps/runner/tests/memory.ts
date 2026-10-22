import { Writable } from 'node:stream';

// A destination that keeps each line the logger writes, for the tests that
// read the runner's records.
export function memory() {
  const lines: string[] = [];
  return {
    lines,
    records: () =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
    // A stream, as pino-pretty pipes into its destination.
    destination: new Writable({
      write: (chunk, _encoding, done) => {
        lines.push(String(chunk));
        done();
      },
    }),
  };
}
