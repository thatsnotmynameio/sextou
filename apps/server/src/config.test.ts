import { describe, expect, it } from 'vitest';
import { loadConfig, type PathContext } from './config';

const paths: PathContext = {
  platform: 'linux',
  homedir: () => '/home/ana',
  cwd: '/work',
};
const defaultDatabase = '/home/ana/.local/share/sextou/sextou.db';

function load(env: Record<string, string | undefined>, args: string[]) {
  return loadConfig(env, args, paths);
}

describe('loadConfig', () => {
  it('listens on 127.0.0.1:4310 by default', () => {
    expect(load({}, [])).toEqual({
      host: '127.0.0.1',
      port: 4310,
      database: defaultDatabase,
    });
  });

  it('reads the host and port from the environment', () => {
    expect(
      load({ SEXTOU_SERVER_HOST: '0.0.0.0', SEXTOU_SERVER_PORT: '8080' }, []),
    ).toEqual({ host: '0.0.0.0', port: 8080, database: defaultDatabase });
  });

  it('lets the arguments override the environment', () => {
    expect(
      load({ SEXTOU_SERVER_HOST: '0.0.0.0', SEXTOU_SERVER_PORT: '8080' }, [
        '--host',
        '::1',
        '--port',
        '9090',
      ]),
    ).toEqual({ host: '::1', port: 9090, database: defaultDatabase });
  });

  it('accepts port 0, for a port the system picks', () => {
    expect(load({}, ['--port', '0']).port).toBe(0);
  });

  describe.each(['', 'abc', '0x50', '1e3', '-1', '65536'])(
    'rejects port %j',
    (port) => {
      it('from SEXTOU_SERVER_PORT', () => {
        expect(() => load({ SEXTOU_SERVER_PORT: port }, [])).toThrow(
          `Invalid SEXTOU_SERVER_PORT: ${JSON.stringify(port)}`,
        );
      });

      it('from --port', () => {
        expect(() => load({}, [`--port=${port}`])).toThrow(
          `Invalid --port: ${JSON.stringify(port)}`,
        );
      });
    },
  );

  // An empty host would bind every interface, not loopback.
  it('rejects an empty host from SEXTOU_SERVER_HOST', () => {
    expect(() => load({ SEXTOU_SERVER_HOST: '' }, [])).toThrow(
      'Invalid SEXTOU_SERVER_HOST: ""',
    );
  });

  it('rejects an empty host from --host', () => {
    expect(() => load({}, ['--host='])).toThrow('Invalid --host: ""');
  });

  it('rejects an unknown flag', () => {
    expect(() => load({}, ['--verbose'])).toThrow("'--verbose'");
  });

  it('puts the database in the data directory by default', () => {
    expect(load({ XDG_DATA_HOME: '/data' }, []).database).toBe(
      '/data/sextou/sextou.db',
    );
  });

  it('reads the database path from the environment', () => {
    expect(load({ SEXTOU_SERVER_DATABASE: '/a.db' }, []).database).toBe(
      '/a.db',
    );
  });

  it('lets --database override the environment', () => {
    expect(
      load({ SEXTOU_SERVER_DATABASE: '/a.db' }, ['--database', '/b.db'])
        .database,
    ).toBe('/b.db');
  });

  it('resolves a relative database path against the working directory', () => {
    expect(load({}, ['--database', 'data.db']).database).toBe('/work/data.db');
  });

  it('keeps :memory: as it is', () => {
    expect(load({}, ['--database', ':memory:']).database).toBe(':memory:');
  });

  it('does not read the home directory when a database path is given', () => {
    const config = loadConfig({}, ['--database', '/b.db'], {
      ...paths,
      homedir: () => {
        throw new Error('read the home directory');
      },
    });
    expect(config.database).toBe('/b.db');
  });

  // SQLite opens an empty path as a temporary database, deleted on close.
  it('rejects an empty database path from SEXTOU_SERVER_DATABASE', () => {
    expect(() => load({ SEXTOU_SERVER_DATABASE: '' }, [])).toThrow(
      'Invalid SEXTOU_SERVER_DATABASE: ""',
    );
  });

  it('rejects an empty database path from --database', () => {
    expect(() => load({}, ['--database='])).toThrow('Invalid --database: ""');
  });
});
