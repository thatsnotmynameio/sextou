import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('listens on 127.0.0.1:4310 by default', () => {
    expect(loadConfig({}, [])).toEqual({ host: '127.0.0.1', port: 4310 });
  });

  it('reads the host and port from the environment', () => {
    expect(
      loadConfig(
        { SEXTOU_SERVER_HOST: '0.0.0.0', SEXTOU_SERVER_PORT: '8080' },
        [],
      ),
    ).toEqual({ host: '0.0.0.0', port: 8080 });
  });

  it('lets the arguments override the environment', () => {
    expect(
      loadConfig(
        { SEXTOU_SERVER_HOST: '0.0.0.0', SEXTOU_SERVER_PORT: '8080' },
        ['--host', '::1', '--port', '9090'],
      ),
    ).toEqual({ host: '::1', port: 9090 });
  });

  it('accepts port 0, for a port the system picks', () => {
    expect(loadConfig({}, ['--port', '0']).port).toBe(0);
  });

  describe.each(['', 'abc', '0x50', '1e3', '-1', '65536'])(
    'rejects port %j',
    (port) => {
      it('from SEXTOU_SERVER_PORT', () => {
        expect(() => loadConfig({ SEXTOU_SERVER_PORT: port }, [])).toThrow(
          `Invalid SEXTOU_SERVER_PORT: ${JSON.stringify(port)}`,
        );
      });

      it('from --port', () => {
        expect(() => loadConfig({}, [`--port=${port}`])).toThrow(
          `Invalid --port: ${JSON.stringify(port)}`,
        );
      });
    },
  );

  // An empty host would bind every interface, not loopback.
  it('rejects an empty host from SEXTOU_SERVER_HOST', () => {
    expect(() => loadConfig({ SEXTOU_SERVER_HOST: '' }, [])).toThrow(
      'Invalid SEXTOU_SERVER_HOST: ""',
    );
  });

  it('rejects an empty host from --host', () => {
    expect(() => loadConfig({}, ['--host='])).toThrow('Invalid --host: ""');
  });

  it('rejects an unknown flag', () => {
    expect(() => loadConfig({}, ['--verbose'])).toThrow("'--verbose'");
  });
});
