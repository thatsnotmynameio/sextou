import path from 'node:path';

// The database file when no path is configured: sextou/sextou.db in the
// user's data directory for the platform. Each platform joins with its own
// separator, so every branch runs in the tests on any system.
export function defaultDatabasePath(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  home: string,
): string {
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local');
    return path.win32.join(base, 'sextou', 'sextou.db');
  }
  const base =
    platform === 'darwin'
      ? path.posix.join(home, 'Library', 'Application Support')
      : // The XDG specification says to ignore a relative XDG_DATA_HOME.
        env.XDG_DATA_HOME && path.posix.isAbsolute(env.XDG_DATA_HOME)
        ? env.XDG_DATA_HOME
        : path.posix.join(home, '.local', 'share');
  return path.posix.join(base, 'sextou', 'sextou.db');
}
