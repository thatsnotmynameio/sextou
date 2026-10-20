import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  createReadStream,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import type { Layout } from './layout';
import type { Pin, Pins, Release } from './pins';
import { binaryName, releaseFor } from './platform';

export interface BinariesOptions {
  layout: Layout;
  pins: Pins;
  platform: NodeJS.Platform;
  arch: string;
  // The tar that extracts the archives (tarPath).
  tar: string;
  fetch: typeof fetch;
  // Called before each download, so a slow first start reads as progress.
  log: (line: string) => void;
}

// The paths of bd and Dolt, each checked against its pinned hash once. A
// binary that is missing or doesn't match is downloaded again; the step
// throws when a download, a checksum or the extraction fails.
export async function ensureBinaries(
  options: BinariesOptions,
): Promise<Record<keyof Pins, string>> {
  // A crashed start leaves its temporary folder behind.
  for (const entry of readdirSync(options.layout.bin)) {
    if (entry.startsWith('.tmp-')) {
      rmSync(path.join(options.layout.bin, entry), {
        recursive: true,
        force: true,
      });
    }
  }
  return {
    bd: await ensureBinary(options, 'bd'),
    dolt: await ensureBinary(options, 'dolt'),
  };
}

async function ensureBinary(
  { layout, pins, platform, arch, tar, fetch, log }: BinariesOptions,
  tool: keyof Pins,
): Promise<string> {
  const pin = pins[tool];
  const release = releaseFor(pin, platform, arch);
  const folder = path.join(layout.bin, `${tool}-${pin.version}`);
  const binary = path.join(folder, binaryName(release));
  if ((await hashOf(binary).catch(() => undefined)) === release.binarySha256) {
    return binary;
  }

  log(`Downloading ${pin.name} ${pin.version} from ${release.url}`);
  const temporary = mkdtempSync(path.join(layout.bin, '.tmp-'));
  try {
    // The archive's hash is checked before tar ever reads it.
    const archive = path.join(temporary, 'archive');
    writeFileSync(archive, await download(fetch, release));
    const extracted = path.join(temporary, 'extracted');
    mkdirSync(extracted);
    await extract(tar, archive, extracted, pin);

    const file = path.join(extracted, ...release.binary.split('/'));
    const hash = await hashOf(file);
    if (hash !== release.binarySha256) {
      throw new Error(
        `Checksum mismatch for ${pin.name} ${pin.version} (${release.binary}): expected ${release.binarySha256}, got ${hash}`,
      );
    }
    chmodSync(file, 0o755);
    const staged = path.join(temporary, 'staged');
    mkdirSync(staged);
    renameSync(file, path.join(staged, binaryName(release)));
    rmSync(folder, { recursive: true, force: true });
    renameSync(staged, folder);
    return binary;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

async function download(fetch: BinariesOptions['fetch'], release: Release) {
  let response: Response;
  try {
    response = await fetch(release.url);
  } catch (error) {
    throw new Error(
      `Could not download ${release.url}: ${(error as Error).message}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `Could not download ${release.url}: HTTP ${response.status}`,
    );
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== release.archiveSha256) {
    throw new Error(
      `Checksum mismatch for ${release.url}: expected ${release.archiveSha256}, got ${hash}`,
    );
  }
  return bytes;
}

// Extracts with the system tar, which reads both .tar.gz and, on Windows,
// zip.
function extract(tar: string, archive: string, into: string, pin: Pin) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(tar, ['-xf', archive, '-C', into], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      reject(new Error(`Could not run ${tar}: ${error.message}`));
    });
    child.once('close', (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${tar} could not extract the ${pin.name} ${pin.version} archive: ${stderr.trim()}`,
          ),
        );
      }
    });
  });
}

async function hashOf(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
