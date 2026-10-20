import { existsSync } from 'node:fs';
import path from 'node:path';
import { bdInitEnv, gitEnv, type ChildEnvContext } from './child-env';
import type { Layout } from './layout';
import { runToEnd } from './processes';

export interface OrganizationOptions {
  bd: string;
  git: string;
  doltPort: number;
  doltPassword: string;
  layout: Layout;
  env: ChildEnvContext;
}

// Makes sure the default organization's database exists with its events
// journal on, before its bd serve starts. bd serve reads the journal setting
// only when it starts, so it is turned on every time. The database is created
// only when the organization's beads configuration is missing.
export async function ensureOrganization({
  bd,
  git,
  doltPort,
  doltPassword,
  layout,
  env,
}: OrganizationOptions): Promise<void> {
  // bd serve runs git to find the root of the folder it serves: the
  // organization's folder is an empty repository of its own.
  if (!existsSync(path.join(layout.organization, '.git'))) {
    await runToEnd(
      'git init',
      git,
      ['init', '--quiet', '--template=', layout.organization],
      {
        cwd: layout.organization,
        env: gitEnv(env),
      },
    );
  }
  const options = {
    cwd: layout.organization,
    env: bdInitEnv(env, doltPassword, git),
  };
  await runToEnd(
    'bd init',
    bd,
    [
      'init',
      '--server',
      '--server-host',
      '127.0.0.1',
      '--server-port',
      String(doltPort),
      '--server-user',
      'root',
      '--database',
      'sextou_default',
      '--prefix',
      'sx',
      '--skip-agents',
      '--skip-hooks',
      '--non-interactive',
      '--role',
      'maintainer',
      '--quiet',
      '--init-if-missing',
    ],
    options,
  );
  await runToEnd(
    'bd config set',
    bd,
    ['config', 'set', 'events-journal', 'true'],
    options,
  );
}
