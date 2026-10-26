import { lstat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

// Whether `path`, inside the workspace, goes through a symlink below it, as
// one an earlier step of the run left, which would lead a script out of it.
// The workspace itself is the runner's, and may be one.
export async function throughSymlink(workspace: string, path: string) {
  let current = workspace;
  const names = relative(workspace, path).split(sep);
  for (const name of names.filter((name) => name !== '')) {
    current = join(current, name);
    const stats = await lstat(current).catch(() => undefined);
    if (stats === undefined) {
      return false;
    }
    if (stats.isSymbolicLink()) {
      return true;
    }
  }
  return false;
}
