import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { connect, Database } from '@tursodatabase/database';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { steps } from './migrations';
import { openTasks, type Tasks } from './open-tasks';
import { Status } from './status';

let dir: string;
let exec: MockInstance<Database['exec']>;
const opened: Tasks[] = [];

async function open(path: string) {
  const tasks = await openTasks(path);
  opened.push(tasks);
  return tasks;
}

// The connection openTasks opened, to read its settings.
function connection() {
  return exec.mock.contexts[0] as Database;
}

async function pragma(name: string) {
  return (await connection().get(`PRAGMA ${name}`))?.[name];
}

// Reads a closed file with a connection of its own.
async function inspect<T>(
  path: string,
  read: (client: Database) => Promise<T>,
): Promise<T> {
  const client = await connect(path);
  try {
    return await read(client);
  } finally {
    await client.close();
  }
}

async function tables(client: Database) {
  const rows = await client.all(
    "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
  );
  return rows.map((row) => row.name);
}

function mode(path: string) {
  return statSync(path).mode & 0o777;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-tasks-'));
  exec = vi.spyOn(Database.prototype, 'exec');
});

afterEach(async () => {
  for (const tasks of opened.splice(0)) await tasks.close();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('openTasks in memory', () => {
  it('opens a migrated, empty graph', async () => {
    await open(':memory:');
    expect(await tables(connection())).toEqual([
      'execution',
      'link',
      'status_change',
      'task',
    ]);
    expect(await pragma('user_version')).toBe(steps.length);
    expect(await connection().get('SELECT count(*) AS n FROM task')).toEqual({
      n: 0,
    });
  });

  it('closes twice without throwing', async () => {
    const tasks = await open(':memory:');
    await tasks.close();
    expect(connection().open).toBe(false);
    await expect(tasks.close()).resolves.toBeUndefined();
  });

  it('rejects an operation once closed', async () => {
    const tasks = await open(':memory:');
    await tasks.close();
    await expect(
      tasks.listReady({ assignees: ['dev'], limit: 1 }),
    ).rejects.toThrow('The database connection is not open');
    await expect(
      tasks.createTask({
        title: 'A',
        kind: 'task',
        priority: 2,
        assignee: 'dev',
        createdBy: 'planner',
      }),
    ).rejects.toThrow('The database connection is not open');
  });
});

describe('openTasks on a file', () => {
  it('migrates a new file to the shipped steps', async () => {
    const path = join(dir, 'graph.db');
    await (await open(path)).close();
    await inspect(path, async (client) => {
      expect(await tables(client)).toEqual([
        'execution',
        'link',
        'status_change',
        'task',
      ]);
      expect(await client.get('PRAGMA user_version')).toEqual({
        user_version: steps.length,
      });
    });
  });

  it('applies nothing to a file it migrated before, and keeps its rows', async () => {
    const path = join(dir, 'graph.db');
    await (await open(path)).close();
    await inspect(path, (client) =>
      client.exec('CREATE TABLE kept (x); INSERT INTO kept VALUES (1)'),
    );
    await (await open(path)).close();
    await inspect(path, async (client) => {
      expect(await client.all('SELECT x FROM kept')).toEqual([{ x: 1 }]);
      expect(await client.get('PRAGMA user_version')).toEqual({
        user_version: steps.length,
      });
    });
  });

  it('runs in WAL mode, durable, with foreign keys on', async () => {
    await open(join(dir, 'graph.db'));
    expect(await pragma('journal_mode')).toBe('wal');
    // 2 is FULL.
    expect(await pragma('synchronous')).toBe(2);
    expect(await pragma('foreign_keys')).toBe(1);
  });

  // Turso keeps the WAL file, which opening creates, so the main file's bytes
  // and the recorded steps show the file is unchanged.
  it('refuses a file a newer version migrated, and leaves it unchanged', async () => {
    const path = join(dir, 'graph.db');
    await inspect(path, (client) =>
      client.exec('CREATE TABLE future (x); PRAGMA user_version = 99'),
    );
    const before = readFileSync(path);
    await expect(open(path)).rejects.toThrow(
      `This tasks database was written by a newer version (schema 99, this one knows ${steps.length})`,
    );
    expect(connection().open).toBe(false);
    expect(readFileSync(path).equals(before)).toBe(true);
    await inspect(path, async (client) => {
      expect(await tables(client)).toEqual(['future']);
      expect(await client.get('PRAGMA user_version')).toEqual({
        user_version: 99,
      });
    });
  });

  it('rejects a file that is not a database', async () => {
    const path = join(dir, 'notes.db');
    writeFileSync(path, 'not a database, just some text that is long enough');
    await expect(open(path)).rejects.toThrow('File is not a database');
  });

  it('rejects when the folder is a regular file', async () => {
    writeFileSync(join(dir, 'file'), '');
    await expect(open(join(dir, 'file', 'graph.db'))).rejects.toThrow('EEXIST');
  });

  it('leaves a file that standard SQLite reads', async () => {
    const path = join(dir, 'graph.db');
    const tasks = await open(path);
    await tasks.createTask({
      title: 'A',
      kind: 'task',
      priority: 2,
      assignee: 'dev',
      createdBy: 'planner',
    });
    await tasks.close();
    const client = new DatabaseSync(path);
    try {
      expect(client.prepare('PRAGMA integrity_check').all()).toEqual([
        { integrity_check: 'ok' },
      ]);
      expect(client.prepare('SELECT title, status FROM task').all()).toEqual([
        { title: 'A', status: Status.open },
      ]);
    } finally {
      client.close();
    }
  });

  it('refuses a second process while open, and keeps working', async () => {
    const path = join(dir, 'graph.db');
    const tasks = await open(path);
    const child = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import { connect } from '@tursodatabase/database'; await connect(process.argv[1]);",
        path,
      ],
      { cwd: import.meta.dirname, encoding: 'utf8' },
    );
    expect(child.status).not.toBe(0);
    expect(child.stderr).toContain('File is locked by another process');
    expect(
      await tasks.createTask({
        title: 'A',
        kind: 'task',
        priority: 2,
        assignee: 'dev',
        createdBy: 'planner',
      }),
    ).toMatchObject({ ok: true });
    expect(
      await tasks.listReady({ assignees: ['dev'], limit: 1 }),
    ).toMatchObject({ ok: true, tasks: [{ title: 'A' }] });
  });

  // File modes mean nothing on Windows, where the profile's permissions apply.
  it.skipIf(process.platform === 'win32')(
    'creates a missing folder and the file for their owner only, its sidecar too',
    async () => {
      const path = join(dir, 'missing', 'graph.db');
      const tasks = await open(path);
      await connection().exec('CREATE TABLE t (x)');
      expect(mode(join(dir, 'missing'))).toBe(0o700);
      expect(mode(path)).toBe(0o600);
      expect(mode(`${path}-wal`)).toBe(0o600);
      await tasks.close();
      expect(mode(path)).toBe(0o600);
      expect(mode(`${path}-wal`)).toBe(0o600);
    },
  );

  it.skipIf(process.platform === 'win32')(
    'makes an existing file and its sidecar owner-only',
    async () => {
      const path = join(dir, 'graph.db');
      await (await open(path)).close();
      for (const file of [path, `${path}-wal`]) chmodSync(file, 0o644);
      await open(path);
      expect(mode(path)).toBe(0o600);
      expect(mode(`${path}-wal`)).toBe(0o600);
    },
  );
});
