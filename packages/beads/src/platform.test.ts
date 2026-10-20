import { describe, expect, it } from 'vitest';
import { pins } from './pins';
import { binaryName, releaseFor, tarPath } from './platform';

describe('releaseFor', () => {
  it.each([
    ['linux', 'x64'],
    ['linux', 'arm64'],
    ['darwin', 'x64'],
    ['darwin', 'arm64'],
    ['win32', 'x64'],
  ] as const)('selects the %s %s release of bd and Dolt', (platform, arch) => {
    for (const pin of [pins.bd, pins.dolt]) {
      const release = releaseFor(pin, platform, arch);
      expect(release.url).toMatch(/^https:\/\//);
      expect(release.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(release.binarySha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('selects the Windows binary on win32', () => {
    expect(releaseFor(pins.bd, 'win32', 'x64').binary).toBe('bd.exe');
  });

  it.each([
    ['win32', 'arm64'],
    ['freebsd', 'x64'],
    ['linux', 'mips'],
  ] as const)('throws naming %s %s', (platform, arch) => {
    expect(() => releaseFor(pins.dolt, platform, arch)).toThrow(
      `No pinned release of Dolt 2.2.0 for ${platform} ${arch}`,
    );
  });
});

describe('binaryName', () => {
  it('is the last segment of the path inside the archive', () => {
    expect(binaryName(releaseFor(pins.dolt, 'linux', 'x64'))).toBe('dolt');
    expect(binaryName(releaseFor(pins.dolt, 'win32', 'x64'))).toBe('dolt.exe');
  });
});

describe('tarPath', () => {
  it('runs the tar on the PATH outside Windows', () => {
    expect(tarPath('linux', {})).toBe('tar');
    expect(tarPath('darwin', { SystemRoot: 'C:\\Windows' })).toBe('tar');
  });

  // Git's tar on the PATH reads no zip; Windows' own does.
  it('runs System32\\tar.exe under SystemRoot on Windows', () => {
    expect(tarPath('win32', { SystemRoot: 'D:\\Win' })).toBe(
      'D:\\Win\\System32\\tar.exe',
    );
    expect(tarPath('win32', {})).toBe('C:\\Windows\\System32\\tar.exe');
  });
});
