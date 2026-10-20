import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import type { Pin, PlatformKey, Release } from './pins';

// The pinned release for a platform and architecture. Throws naming them when
// there is none.
export function releaseFor(
  pin: Pin,
  platform: NodeJS.Platform,
  arch: string,
): Release {
  const release = pin.releases[`${platform}-${arch}` as PlatformKey];
  if (!release) {
    throw new Error(
      `No pinned release of ${pin.name} ${pin.version} for ${platform} ${arch}`,
    );
  }
  return release;
}

// The binary's file name, as it is kept on disk.
export function binaryName(release: Release): string {
  return path.posix.basename(release.binary);
}

// The tar that extracts the archives. On Windows it is Windows' own, which
// reads zip; Git's tar on the PATH does not. C:\Windows is SystemRoot's
// default.
export function tarPath(
  platform: NodeJS.Platform,
  env: { SystemRoot?: string },
): string {
  return platform === 'win32'
    ? path.win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
}

// The git on the server's PATH: bd serve runs git to find the root of the
// organization's folder, and won't start without it.
export function findGit(
  pathValue: string | undefined,
  platform: NodeJS.Platform,
): string {
  const name = platform === 'win32' ? 'git.exe' : 'git';
  for (const folder of (pathValue ?? '').split(path.delimiter)) {
    if (folder === '') continue;
    const file = path.join(folder, name);
    try {
      accessSync(file, constants.X_OK);
      return file;
    } catch {
      // Not here, or not executable.
    }
  }
  throw new Error('git was not found on the PATH; beads needs it');
}
