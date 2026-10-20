import path from 'node:path';
import type { Layout } from './layout';

// What every child's environment is built from. Never the server's own
// environment: a user's BEADS_*, BD_* or DOLT_* would override sextou's
// settings, and both tools would write to the user's home.
export interface ChildEnvContext {
  platform: NodeJS.Platform;
  layout: Layout;
  // On Windows, the server's SystemRoot, TEMP and TMP, which programs need.
  windowsEnv: { SystemRoot?: string; TEMP?: string; TMP?: string };
}

type Env = Record<string, string>;

// The least a child needs on its platform, with dolt-home/ as its home, so
// neither tool nor git reads the user's configuration. No PATH: only bd needs
// one, for git.
function platformMinimum({
  platform,
  layout,
  windowsEnv,
}: ChildEnvContext): Env {
  if (platform !== 'win32') return { HOME: layout.doltHome };
  const env: Env = {};
  for (const [name, value] of Object.entries(windowsEnv)) {
    if (value !== undefined) env[name] = value;
  }
  return { ...env, USERPROFILE: layout.doltHome };
}

// dolt sql-server's environment, with telemetry off. rootPassword is passed
// only on the launch that creates privileges.db, the only one that applies it.
export function doltEnv(context: ChildEnvContext, rootPassword?: string): Env {
  return {
    ...platformMinimum(context),
    DOLT_ROOT_PATH: context.layout.doltHome,
    DOLT_DISABLE_EVENT_FLUSH: '1',
    ...(rootPassword === undefined
      ? {}
      : { DOLT_ROOT_PASSWORD: rootPassword, DOLT_ROOT_HOST: '127.0.0.1' }),
  };
}

// git init's environment.
export function gitEnv(context: ChildEnvContext): Env {
  return platformMinimum(context);
}

// bd serve's environment: a PATH holding only git's folder, since bd serve
// runs git to find the organization folder's root; the organization's
// BEADS_DIR, which also keeps bd init from running git init; and the Dolt
// password. bd never starts a Dolt of its own, and its telemetry is off.
export function bdEnv(
  context: ChildEnvContext,
  doltPassword: string,
  git: string,
): Env {
  return {
    ...platformMinimum(context),
    PATH: path.dirname(git),
    BEADS_DIR: context.layout.beadsDir,
    BEADS_DOLT_PASSWORD: doltPassword,
    BEADS_DOLT_AUTO_START: '0',
    BD_DISABLE_METRICS: '1',
  };
}

// bd init's and bd config set's environment: bd serve's, never prompting.
export function bdInitEnv(
  context: ChildEnvContext,
  doltPassword: string,
  git: string,
): Env {
  return { ...bdEnv(context, doltPassword, git), BD_NON_INTERACTIVE: '1' };
}
