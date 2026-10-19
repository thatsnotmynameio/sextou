import { describe, expect, it } from 'vitest';
import { defaultDatabasePath } from './database-path';

describe('defaultDatabasePath', () => {
  it('uses ~/.local/share on Linux', () => {
    expect(defaultDatabasePath('linux', {}, '/home/ana')).toBe(
      '/home/ana/.local/share/sextou/sextou.db',
    );
  });

  it('uses XDG_DATA_HOME when it is an absolute path', () => {
    expect(
      defaultDatabasePath('linux', { XDG_DATA_HOME: '/data' }, '/home/ana'),
    ).toBe('/data/sextou/sextou.db');
  });

  // The XDG specification says to ignore a relative path.
  it.each(['', 'data'])('ignores XDG_DATA_HOME set to %j', (value) => {
    expect(
      defaultDatabasePath('linux', { XDG_DATA_HOME: value }, '/home/ana'),
    ).toBe('/home/ana/.local/share/sextou/sextou.db');
  });

  it('uses ~/Library/Application Support on macOS', () => {
    expect(
      defaultDatabasePath('darwin', { XDG_DATA_HOME: '/data' }, '/Users/ana'),
    ).toBe('/Users/ana/Library/Application Support/sextou/sextou.db');
  });

  it('uses LOCALAPPDATA on Windows', () => {
    expect(
      defaultDatabasePath(
        'win32',
        { LOCALAPPDATA: 'D:\\Local' },
        'C:\\Users\\ana',
      ),
    ).toBe('D:\\Local\\sextou\\sextou.db');
  });

  it('falls back to AppData\\Local in the home directory on Windows', () => {
    expect(defaultDatabasePath('win32', {}, 'C:\\Users\\ana')).toBe(
      'C:\\Users\\ana\\AppData\\Local\\sextou\\sextou.db',
    );
  });
});
