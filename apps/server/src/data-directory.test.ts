import { expect, test } from 'vitest';
import { defaultDataDirectory } from './data-directory';

test('defaultDataDirectory uses ~/.local/share on Linux', () => {
  expect(defaultDataDirectory('linux', {}, '/home/ana')).toBe(
    '/home/ana/.local/share/sextou',
  );
});

test('defaultDataDirectory uses XDG_DATA_HOME when it is an absolute path', () => {
  expect(
    defaultDataDirectory('linux', { XDG_DATA_HOME: '/data' }, '/home/ana'),
  ).toBe('/data/sextou');
});

// The XDG specification says to ignore a relative path.
test.each(['', 'data'])(
  'defaultDataDirectory ignores XDG_DATA_HOME set to %j',
  (value) => {
    expect(
      defaultDataDirectory('linux', { XDG_DATA_HOME: value }, '/home/ana'),
    ).toBe('/home/ana/.local/share/sextou');
  },
);

test('defaultDataDirectory uses ~/Library/Application Support on macOS', () => {
  expect(
    defaultDataDirectory('darwin', { XDG_DATA_HOME: '/data' }, '/Users/ana'),
  ).toBe('/Users/ana/Library/Application Support/sextou');
});

test('defaultDataDirectory uses LOCALAPPDATA on Windows', () => {
  expect(
    defaultDataDirectory(
      'win32',
      { LOCALAPPDATA: 'D:\\Local' },
      'C:\\Users\\ana',
    ),
  ).toBe('D:\\Local\\sextou');
});

test('defaultDataDirectory falls back to AppData\\Local in the home directory on Windows', () => {
  expect(defaultDataDirectory('win32', {}, 'C:\\Users\\ana')).toBe(
    'C:\\Users\\ana\\AppData\\Local\\sextou',
  );
});
