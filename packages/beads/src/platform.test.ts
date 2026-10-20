import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pins } from './pins';
import { binaryName, findGit, releaseFor, tarPath } from './platform';

describe.runIf(process.platform !== 'win32')('findGit', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sextou-git-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function file(folder: string, name: string, mode: number) {
    mkdirSync(join(dir, folder), { recursive: true });
    writeFileSync(join(dir, folder, name), '');
    chmodSync(join(dir, folder, name), mode);
  }

  it('returns the first executable git on the PATH', () => {
    file('a', 'other', 0o755);
    file('b', 'git', 0o644);
    file('c', 'git', 0o755);
    file('d', 'git', 0o755);
    const path = ['a', 'b', 'c', 'd'].map((each) => join(dir, each));

    expect(findGit(path.join(delimiter), 'linux')).toBe(join(dir, 'c', 'git'));
  });

  it.each([undefined, ''])('throws asking for git when PATH is %j', (path) => {
    expect(() => findGit(path, 'linux')).toThrow(
      'git was not found on the PATH; beads needs it',
    );
  });

  it('looks for git.exe on Windows', () => {
    file('w', 'git.exe', 0o755);
    expect(findGit(join(dir, 'w'), 'win32')).toBe(join(dir, 'w', 'git.exe'));
  });
});

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
