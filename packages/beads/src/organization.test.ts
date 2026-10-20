import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layoutOf, prepareFolders, type Layout } from './layout';
import { ensureOrganization, type OrganizationOptions } from './organization';
import { findGit } from './platform';
import { fakeBinary, recordedCalls } from './test/fakes';

let dir: string;
let layout: Layout;
let calls: string;
const git = findGit(process.env.PATH, process.platform);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-organization-'));
  layout = layoutOf(join(dir, 'data'));
  prepareFolders(layout);
  calls = join(dir, 'calls.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function options(
  overrides: Partial<OrganizationOptions> = {},
): OrganizationOptions {
  return {
    bd: overrides.bd ?? fakeBinary(join(dir, 'bd'), 'fake-bd.ts', calls),
    git,
    doltPort: 4311,
    doltPassword: 'the-password',
    layout,
    env: { platform: process.platform, layout, windowsEnv: {} },
    ...overrides,
  };
}

describe.runIf(process.platform !== 'win32')('ensureOrganization', () => {
  it('makes the folder a git repository, creates the database and turns the journal on', async () => {
    await ensureOrganization(options());

    const [init, config] = recordedCalls(calls);
    expect(init.argv).toEqual([
      'init',
      '--server',
      '--server-host',
      '127.0.0.1',
      '--server-port',
      '4311',
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
    ]);
    expect(config.argv).toEqual(['config', 'set', 'events-journal', 'true']);
    for (const call of [init, config]) {
      expect(call.cwd).toBe(layout.organization);
      expect(call.env).toMatchObject({
        PATH: join(git, '..'),
        BEADS_DIR: layout.beadsDir,
        BEADS_DOLT_PASSWORD: 'the-password',
        BD_NON_INTERACTIVE: '1',
      });
    }
    expect(readFileSync(join(layout.beadsDir, 'config.yaml'), 'utf8')).toBe(
      'events-journal: true\n',
    );
    // An empty repository of its own: no commit, no hook.
    expect(
      execFileSync(git, [
        '-C',
        layout.organization,
        'rev-parse',
        '--show-toplevel',
      ])
        .toString()
        .trim(),
    ).toBe(layout.organization);
    expect(existsSync(join(layout.organization, '.git', 'hooks'))).toBe(false);
  });

  it('runs the same commands on a second start, and the database is left as it is', async () => {
    await ensureOrganization(options());
    await ensureOrganization(options());

    expect(recordedCalls(calls).map((call) => call.argv[0])).toEqual([
      'init',
      'config',
      'init',
      'config',
    ]);
    expect(readFileSync(join(layout.beadsDir, 'metadata.json'), 'utf8')).toBe(
      '{"dolt_database":"sextou_default"}',
    );
  });

  it('writes nothing outside the data directory', async () => {
    await ensureOrganization(options());
    expect(readdirSync(dir).sort()).toEqual(['bd', 'calls.jsonl', 'data']);
  });

  it('fails with bd’s stderr when init fails', async () => {
    const bd = fakeBinary(join(dir, 'bd'), 'fake-bd.ts', calls, 'init-fails');

    await expect(ensureOrganization(options({ bd }))).rejects.toThrow(
      'bd init exited with code 1: fake bd: cannot log in with the-password',
    );
    expect(recordedCalls(calls)).toHaveLength(1);
  });

  it('fails with bd’s stderr when turning the journal on fails', async () => {
    const bd = fakeBinary(join(dir, 'bd'), 'fake-bd.ts', calls, 'config-fails');

    await expect(ensureOrganization(options({ bd }))).rejects.toThrow(
      'bd config set exited with code 1: fake bd: cannot write config.yaml',
    );
  });
});
