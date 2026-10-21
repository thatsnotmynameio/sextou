import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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

let dir: string;
let exec: MockInstance<DatabaseSync['exec']>;
const opened: Tasks[] = [];

function open(path: string) {
  const tasks = openTasks(path);
  opened.push(tasks);
  return tasks;
}

// The connection openTasks opened, to read its settings.
function connection() {
  return exec.mock.contexts[0] as DatabaseSync;
}

function pragma(name: string, column = name) {
  return connection().prepare(`PRAGMA ${name}`).get()?.[column];
}

// Reads a closed file with a connection of its own.
function inspect<T>(path: string, read: (client: DatabaseSync) => T): T {
  const client = new DatabaseSync(path);
  try {
    return read(client);
  } finally {
    client.close();
  }
}

function tables(client: DatabaseSync) {
  return client
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

function mode(path: string) {
  return statSync(path).mode & 0o777;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-tasks-'));
  exec = vi.spyOn(DatabaseSync.prototype, 'exec');
});

afterEach(() => {
  for (const tasks of opened.splice(0)) tasks.close();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('openTasks in memory', () => {
  it('opens a migrated, empty graph', () => {
    open(':memory:');
    expect(tables(connection())).toEqual([
      'task_executions',
      'task_links',
      'task_status_changes',
      'tasks',
    ]);
    expect(pragma('user_version')).toBe(steps.length);
    expect(
      connection().prepare('SELECT count(*) AS n FROM tasks').get(),
    ).toEqual({ n: 0 });
  });

  it('closes twice without throwing', () => {
    const tasks = open(':memory:');
    tasks.close();
    expect(connection().isOpen).toBe(false);
    expect(() => tasks.close()).not.toThrow();
  });
});

describe('openTasks on a file', () => {
  it('migrates a new file to the shipped steps', () => {
    const path = join(dir, 'graph.db');
    open(path).close();
    inspect(path, (client) => {
      expect(tables(client)).toEqual([
        'task_executions',
        'task_links',
        'task_status_changes',
        'tasks',
      ]);
      expect(client.prepare('PRAGMA user_version').get()).toEqual({
        user_version: steps.length,
      });
    });
  });

  it('applies nothing to a file it migrated before, and keeps its rows', () => {
    const path = join(dir, 'graph.db');
    open(path).close();
    inspect(path, (client) => {
      client.exec('CREATE TABLE kept (x); INSERT INTO kept VALUES (1)');
    });
    open(path).close();
    inspect(path, (client) => {
      expect(client.prepare('SELECT x FROM kept').all()).toEqual([{ x: 1 }]);
      expect(client.prepare('PRAGMA user_version').get()).toEqual({
        user_version: steps.length,
      });
    });
  });

  it('runs in WAL mode, durable, with foreign keys on and a busy timeout', () => {
    open(join(dir, 'graph.db'));
    expect(pragma('journal_mode')).toBe('wal');
    // 2 is FULL.
    expect(pragma('synchronous')).toBe(2);
    expect(pragma('foreign_keys')).toBe(1);
    expect(pragma('busy_timeout', 'timeout')).toBe(5000);
  });

  // SQLite deletes the WAL file when the last connection closes.
  it('refuses a file a newer version migrated, and leaves it unchanged', () => {
    const path = join(dir, 'graph.db');
    inspect(path, (client) => {
      client.exec('CREATE TABLE future (x); PRAGMA user_version = 99');
    });
    const before = readFileSync(path);
    expect(() => open(path)).toThrow(
      `This tasks database was written by a newer version (schema 99, this one knows ${steps.length})`,
    );
    expect(connection().isOpen).toBe(false);
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(existsSync(`${path}-wal`)).toBe(false);
  });

  it('throws on a file that is not a database', () => {
    const path = join(dir, 'notes.db');
    writeFileSync(path, 'not a database, just some text that is long enough');
    expect(() => open(path)).toThrow('file is not a database');
    expect(connection().isOpen).toBe(false);
  });

  it('throws when the folder is a regular file', () => {
    writeFileSync(join(dir, 'file'), '');
    expect(() => open(join(dir, 'file', 'graph.db'))).toThrow('EEXIST');
  });

  // File modes mean nothing on Windows, where the profile's permissions apply.
  it.skipIf(process.platform === 'win32')(
    'creates a missing folder and the file for their owner only, sidecars too',
    () => {
      const path = join(dir, 'missing', 'graph.db');
      open(path);
      connection().exec('CREATE TABLE t (x)');
      expect(mode(join(dir, 'missing'))).toBe(0o700);
      expect(mode(path)).toBe(0o600);
      expect(mode(`${path}-wal`)).toBe(0o600);
      expect(mode(`${path}-shm`)).toBe(0o600);
    },
  );
});
