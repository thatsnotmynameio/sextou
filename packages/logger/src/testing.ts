import { Writable } from 'node:stream';

// A destination that keeps each line a logger writes, for tests.
export function memory() {
  const lines: string[] = [];
  return {
    lines,
    records: () => lines.map((line) => JSON.parse(line) as unknown),
    // A stream, as pino-pretty pipes into its destination.
    destination: new Writable({
      write: (chunk, _encoding, done) => {
        lines.push(String(chunk));
        done();
      },
    }),
  };
}
