import { describe, expect, it } from 'vitest';
import { bdEnv, bdInitEnv, doltEnv, gitEnv } from './child-env';
import { layoutOf } from './layout';

const layout = layoutOf('/d');
const linux = { platform: 'linux' as const, layout, windowsEnv: {} };
const windows = {
  platform: 'win32' as const,
  layout: layoutOf('C:\\d'),
  windowsEnv: { SystemRoot: 'C:\\Windows', TEMP: 'C:\\t', TMP: 'C:\\t2' },
};

describe('doltEnv', () => {
  it('holds only the home, the root path and the telemetry switch', () => {
    expect(doltEnv(linux)).toEqual({
      HOME: '/d/dolt-home',
      DOLT_ROOT_PATH: '/d/dolt-home',
      DOLT_DISABLE_EVENT_FLUSH: '1',
    });
  });

  // Dolt applies them only on the launch that creates privileges.db.
  it('carries the root password and host only when asked to', () => {
    expect(doltEnv(linux, 'secret')).toEqual({
      HOME: '/d/dolt-home',
      DOLT_ROOT_PATH: '/d/dolt-home',
      DOLT_DISABLE_EVENT_FLUSH: '1',
      DOLT_ROOT_PASSWORD: 'secret',
      DOLT_ROOT_HOST: '127.0.0.1',
    });
  });

  it('carries the Windows variables and USERPROFILE on win32', () => {
    expect(doltEnv(windows)).toEqual({
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\t',
      TMP: 'C:\\t2',
      USERPROFILE: windows.layout.doltHome,
      DOLT_ROOT_PATH: windows.layout.doltHome,
      DOLT_DISABLE_EVENT_FLUSH: '1',
    });
  });

  it('leaves out a Windows variable the server does not have', () => {
    expect(
      doltEnv({
        ...windows,
        windowsEnv: { SystemRoot: 'C:\\Windows', TEMP: undefined },
      }),
    ).not.toHaveProperty('TEMP');
  });
});

describe('gitEnv', () => {
  it('holds only the home', () => {
    expect(gitEnv(linux)).toEqual({ HOME: '/d/dolt-home' });
  });
});

describe('bdEnv', () => {
  it('points bd at git, the organization and Dolt, with telemetry off', () => {
    expect(bdEnv(linux, 'secret', '/usr/bin/git')).toEqual({
      HOME: '/d/dolt-home',
      PATH: '/usr/bin',
      BEADS_DIR: '/d/beads/default/.beads',
      BEADS_DOLT_PASSWORD: 'secret',
      BEADS_DOLT_AUTO_START: '0',
      BD_DISABLE_METRICS: '1',
    });
  });

  it('adds the non-interactive switch for the setup commands', () => {
    expect(bdInitEnv(linux, 'secret', '/usr/bin/git')).toEqual({
      ...bdEnv(linux, 'secret', '/usr/bin/git'),
      BD_NON_INTERACTIVE: '1',
    });
  });

  // Each environment is built from scratch, never from the server's.
  it('carries nothing from the server’s own environment', () => {
    process.env.BEADS_DIR = '/elsewhere';
    process.env.BD_EVENTS_JOURNAL = 'false';
    process.env.DOLT_ROOT_PASSWORD = 'other';
    try {
      for (const env of [
        doltEnv(linux),
        gitEnv(linux),
        bdEnv(linux, 'secret', '/usr/bin/git'),
        bdInitEnv(linux, 'secret', '/usr/bin/git'),
      ]) {
        expect(env).not.toHaveProperty('BD_EVENTS_JOURNAL');
        expect(env.PATH).not.toBe(process.env.PATH);
        expect(env.BEADS_DIR).not.toBe('/elsewhere');
        expect(env.DOLT_ROOT_PASSWORD).toBeUndefined();
      }
    } finally {
      delete process.env.BEADS_DIR;
      delete process.env.BD_EVENTS_JOURNAL;
      delete process.env.DOLT_ROOT_PASSWORD;
    }
  });
});
