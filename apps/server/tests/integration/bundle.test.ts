// The production bundle, built and run as a deploy runs it. It inlines
// @sextou/tasks but not the package's migrations, which the build copies
// beside server.mjs; the tests from source never see that difference.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { connect } from '@tursodatabase/database';
import { build } from 'vite';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  test,
} from 'vitest';

const serverDir = join(import.meta.dirname, '..', '..');

let outDir: string;
let dataDir: string;

// One build for every test: none writes into it.
beforeAll(async () => {
  // Inside node_modules, so server.mjs finds the packages it leaves out of
  // the bundle (Turso, Pino) the way dist/server.mjs does.
  const cache = join(serverDir, 'node_modules', '.bundle-test');
  mkdirSync(cache, { recursive: true });
  outDir = mkdtempSync(join(cache, 'dist-'));
  await build({
    root: serverDir,
    configFile: join(serverDir, 'vite.config.mts'),
    logLevel: 'silent',
    build: { outDir, emptyOutDir: true },
  });
});

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
});

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'sextou-bundle-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

// Runs server.mjs until it logs that it listens, then stops it, and returns
// every record it logged.
async function run(
  env: Record<string, string> = { SEXTOU_SERVER_DATA_DIR: dataDir },
): Promise<{ level: number; msg: string }[]> {
  const child = spawn(process.execPath, [join(outDir, 'server.mjs')], {
    env: {
      ...process.env,
      // The test's own paths, never ones the shell exported: spawn leaves
      // out a variable whose value is undefined.
      SEXTOU_SERVER_DATA_DIR: undefined,
      SEXTOU_SERVER_DATABASE: undefined,
      SEXTOU_SERVER_TASKS_DB: undefined,
      SEXTOU_SERVER_PORT: '0',
      SEXTOU_SERVER_LOG_LEVEL: 'info',
      ...env,
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

// From source the default is the checkout's apps/server/storage; the bundle
// keeps the user's data directory. The XDG variable points it at the test's
// folder, on Linux, which CI runs.
test.runIf(process.platform === 'linux')(
  'the production bundle puts the databases in the user data directory when no path is given',
  async () => {
    await run({ XDG_DATA_HOME: dataDir });

    expect(existsSync(join(dataDir, 'sextou', 'tasks.db'))).toBe(true);
  },
);
