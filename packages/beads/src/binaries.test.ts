import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureBinaries, type BinariesOptions } from './binaries';
import { layoutOf, prepareFolders, type Layout } from './layout';
import { fetchOf, makeArchive, pinOf, sha256 } from './test/archives';

let dir: string;
let layout: Layout;

const bdArchive = makeArchive('bd', '#!/bin/sh\necho bd\n');
const doltArchive = makeArchive('dolt-test/bin/dolt', '#!/bin/sh\necho dolt\n');
const pins = {
  bd: pinOf('bd', '1.3.1', bdArchive),
  dolt: pinOf('Dolt', '2.2.0', doltArchive),
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-binaries-'));
  layout = layoutOf(dir);
  prepareFolders(layout);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function options(overrides: Partial<BinariesOptions> = {}): BinariesOptions {
  return {
    layout,
    pins,
    platform: process.platform,
    arch: process.arch,
    tar: 'tar',
    fetch: fetchOf(bdArchive, doltArchive).fetch,
    log: () => undefined,
    ...overrides,
  };
}

// Puts content where a verified binary lives.
function place(tool: string, name: string, content: string) {
  mkdirSync(join(layout.bin, tool), { recursive: true });
  writeFileSync(join(layout.bin, tool, name), content, { mode: 0o755 });
}

describe.runIf(process.platform !== 'win32')('ensureBinaries', () => {
  it('returns binaries already in place with the pinned hash, without fetching', async () => {
    place('bd-1.3.1', 'bd', '#!/bin/sh\necho bd\n');
    place('dolt-2.2.0', 'dolt', '#!/bin/sh\necho dolt\n');
    const { fetch, urls } = fetchOf();

    const binaries = await ensureBinaries(options({ fetch }));

    expect(binaries).toEqual({
      bd: join(layout.bin, 'bd-1.3.1', 'bd'),
      dolt: join(layout.bin, 'dolt-2.2.0', 'dolt'),
    });
    expect(urls).toEqual([]);
  });

  it('downloads, verifies and moves a missing binary into place', async () => {
    const { fetch, urls } = fetchOf(bdArchive, doltArchive);
    const lines: string[] = [];

    const binaries = await ensureBinaries(
      options({ fetch, log: (line) => lines.push(line) }),
    );

    expect(urls).toEqual([bdArchive.release.url, doltArchive.release.url]);
    expect(readFileSync(binaries.dolt, 'utf8')).toBe('#!/bin/sh\necho dolt\n');
    expect(binaries.dolt).toBe(join(layout.bin, 'dolt-2.2.0', 'dolt'));
    expect(statSync(binaries.bd).mode & 0o777).toBe(0o755);
    expect(readdirSync(layout.bin).sort()).toEqual(['bd-1.3.1', 'dolt-2.2.0']);
    expect(lines).toEqual([
      `Downloading bd 1.3.1 from ${bdArchive.release.url}`,
      `Downloading Dolt 2.2.0 from ${doltArchive.release.url}`,
    ]);
  });

  it('replaces a binary in place whose hash differs from the pin', async () => {
    place('bd-1.3.1', 'bd', 'tampered');
    place('bd-1.3.1', 'stray', 'left by an older layout');

    const binaries = await ensureBinaries(options());

    expect(sha256(readFileSync(binaries.bd))).toBe(
      bdArchive.release.binarySha256,
    );
    expect(readdirSync(join(layout.bin, 'bd-1.3.1'))).toEqual(['bd']);
  });

  it('throws naming the URL when the download fails, leaving nothing behind', async () => {
    const fetch = () => Promise.reject(new TypeError('fetch failed'));

    await expect(ensureBinaries(options({ fetch }))).rejects.toThrow(
      `Could not download ${bdArchive.release.url}: fetch failed`,
    );
    expect(readdirSync(layout.bin)).toEqual([]);
  });

  it('throws naming the URL when the download answers an error', async () => {
    const { fetch } = fetchOf(doltArchive);
    await expect(ensureBinaries(options({ fetch }))).rejects.toThrow(
      `Could not download ${bdArchive.release.url}: HTTP 404`,
    );
  });

  it('throws naming the checksum of an archive that differs from the pin, without extracting it', async () => {
    const other = makeArchive('bd', 'another bd', bdArchive.release.url);
    const { fetch } = fetchOf(other, doltArchive);

    await expect(
      ensureBinaries(options({ fetch, tar: join(dir, 'no-tar') })),
    ).rejects.toThrow(
      `Checksum mismatch for ${bdArchive.release.url}: expected ${bdArchive.release.archiveSha256}, got ${sha256(other.bytes)}`,
    );
    expect(readdirSync(layout.bin)).toEqual([]);
  });

  it('throws naming the checksum of an extracted binary that differs from the pin', async () => {
    const pinned = {
      ...pins,
      bd: pinOf('bd', '1.3.1', {
        ...bdArchive,
        release: { ...bdArchive.release, binarySha256: sha256('other') },
      }),
    };

    await expect(ensureBinaries(options({ pins: pinned }))).rejects.toThrow(
      `Checksum mismatch for bd 1.3.1 (bd): expected ${sha256('other')}, got ${bdArchive.release.binarySha256}`,
    );
    expect(existsSync(join(layout.bin, 'bd-1.3.1'))).toBe(false);
  });

  it('throws when the archive does not hold the binary', async () => {
    const pinned = {
      ...pins,
      bd: pinOf('bd', '1.3.1', {
        ...bdArchive,
        release: { ...bdArchive.release, binary: 'bin/bd' },
      }),
    };
    await expect(ensureBinaries(options({ pins: pinned }))).rejects.toThrow(
      'ENOENT',
    );
  });

  it('removes a temporary folder an earlier crash left', async () => {
    mkdirSync(join(layout.bin, '.tmp-crashed'));
    await ensureBinaries(options());
    expect(existsSync(join(layout.bin, '.tmp-crashed'))).toBe(false);
  });

  it('throws naming tar when it is missing', async () => {
    const tar = join(dir, 'no-tar');
    await expect(ensureBinaries(options({ tar }))).rejects.toThrow(
      `Could not run ${tar}`,
    );
  });

  it('throws with tar’s message when it cannot extract the archive', async () => {
    const broken = { ...bdArchive, bytes: Buffer.from('not an archive') };
    const pinned = {
      ...pins,
      bd: pinOf('bd', '1.3.1', {
        ...broken,
        release: { ...bdArchive.release, archiveSha256: sha256(broken.bytes) },
      }),
    };
    await expect(
      ensureBinaries(options({ pins: pinned, fetch: fetchOf(broken).fetch })),
    ).rejects.toThrow(/^tar could not extract the bd 1\.3\.1 archive: .+/);
  });

  it('throws naming a platform with no pinned release', async () => {
    await expect(
      ensureBinaries(options({ platform: 'freebsd' })),
    ).rejects.toThrow(`No pinned release of bd 1.3.1 for freebsd`);
  });
});
