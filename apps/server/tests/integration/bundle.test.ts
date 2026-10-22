// The production bundle, built and run as a deploy runs it. It inlines
// @sextou/tasks but not the package's migrations, which the build copies
// beside server.mjs; the tests from source never see that difference.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { connect } from '@tursodatabase/database';
import { build } from 'vite';
import { afterEach, beforeEach, expect, test } from 'vitest';

const serverDir = join(import.meta.dirname, '..', '..');

let outDir: string;
let dataDir: string;

beforeEach(() => {
  // Inside node_modules, so server.mjs finds the packages it leaves out of
  // the bundle (Turso, Pino) the way dist/server.mjs does.
  const cache = join(serverDir, 'node_modules', '.bundle-test');
  mkdirSync(cache, { recursive: true });
  outDir = mkdtempSync(join(cache, 'dist-'));
  dataDir = mkdtempSync(join(tmpdir(), 'sextou-bundle-'));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
  rmSync(dataDir, { recursive: true, force: true });
});

// Runs server.mjs until it logs that it listens, then stops it, and returns
// every record it logged.
async function run(): Promise<{ level: number; msg: string }[]> {
  const child = spawn(process.execPath, [join(outDir, 'server.mjs')], {
    env: {
      ...process.env,
      SEXTOU_SERVER_PORT: '0',
      SEXTOU_SERVER_DATA_DIR: dataDir,
      SEXTOU_SERVER_LOG_LEVEL: 'info',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const records = [];
  for await (const line of createInterface({ input: child.stdout })) {
    const record = JSON.parse(line);
    records.push(record);
    if (record.msg === 'listening') {
      child.kill('SIGTERM');
    }
  }
  await exited;
  return records;
}

test('the production bundle opens the tasks database with the migrations it carries', async () => {
  await build({
    root: serverDir,
    configFile: join(serverDir, 'vite.config.mts'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });

  const records = await run();

  expect(records.map(({ level, msg }) => ({ level, msg }))).toEqual([
    { level: 30, msg: 'listening' },
  ]);
  const client = await connect(join(dataDir, 'tasks.db'));
  try {
    expect(
      await client.get(
        "SELECT count(*) AS n FROM sqlite_schema WHERE name = 'tasks'",
      ),
    ).toEqual({ n: 1 });
  } finally {
    await client.close();
  }
});
