// Pino's level names, written out here because Pino's own list leaves out
// silent. In a file of their own, which loads no Pino, so the apps' config.ts
// reads them through @sextou/logger/levels without loading the logger.
export const logLevels = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;

export type LogLevel = (typeof logLevels)[number];
