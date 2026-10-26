import { pino, type DestinationStream } from 'pino';
import PinoPretty from 'pino-pretty';
import type { LogLevel } from './levels';

export interface LoggerOptions {
  // The lowest level written.
  level: LogLevel;
  // Readable lines, for development; one JSON record per line otherwise.
  pretty: boolean;
}

// A process's logger, on stdout unless a test passes another destination.
// pino-pretty runs as a stream in this process rather than as Pino's
// transport, which would load it in a worker thread.
export function createLogger(
  { level, pretty }: LoggerOptions,
  destination?: DestinationStream,
) {
  return pino({ level }, pretty ? PinoPretty({ destination }) : destination);
}

export type Logger = ReturnType<typeof createLogger>;
