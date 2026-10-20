// Builds release archives for the tests, with the system tar, as the real
// releases are built.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Pin, PlatformKey, Release } from '../pins';

export const platformKey = `${process.platform}-${process.arch}` as PlatformKey;

export function sha256(content: string | Buffer) {
  return createHash('sha256').update(content).digest('hex');
}

export interface Archive {
  bytes: Buffer;
  release: Release;
}

// A .tar.gz holding content as an executable at inner, and the release that
// pins it at url.
export function makeArchive(
  inner: string,
  content: string,
  url = `https://example.test/${inner.replaceAll('/', '-')}.tar.gz`,
): Archive {
  const staging = mkdtempSync(join(tmpdir(), 'sextou-archive-'));
  try {
    const file = join(staging, 'root', inner);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    chmodSync(file, 0o755);
    const out = join(staging, 'archive.tar.gz');
    execFileSync('tar', ['-czf', out, '-C', join(staging, 'root'), inner]);
    const bytes = readFileSync(out);
    return {
      bytes,
      release: {
        url,
        archiveSha256: sha256(bytes),
        binary: inner,
        binarySha256: sha256(content),
      },
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

export function pinOf(name: string, version: string, archive: Archive): Pin {
  return { name, version, releases: { [platformKey]: archive.release } };
}

// A fetch that answers each archive's URL with its bytes, records each URL it
// is asked for, and answers 404 otherwise.
export function fetchOf(...archives: Archive[]) {
  const urls: string[] = [];
  const fetch = (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    const archive = archives.find((each) => each.release.url === url);
    return Promise.resolve(
      archive
        ? new Response(new Uint8Array(archive.bytes))
        : new Response(null, { status: 404 }),
    );
  };
  return { fetch: fetch as typeof globalThis.fetch, urls };
}
