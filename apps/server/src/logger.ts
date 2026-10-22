import { pino, type DestinationStream } from 'pino';
import type { LogLevel } from './config';

// The server's logger: one JSON line per record, at the given level and above,
// on stdout unless a test passes another destination. No transport: Pino runs
// a transport from files it loads at run time, which the single-file bundle
// doesn't carry.
export function createLogger(level: LogLevel, destination?: DestinationStream) {
  return pino({ level }, destination);
}
