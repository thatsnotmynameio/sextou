import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { migrations } from './migration.gen';
import { readMigrationFolder } from './migration-files';

let dir: string;

function write(id: string, sql: string) {
  mkdirSync(join(dir, id));
  writeFileSync(join(dir, id, 'migration.sql'), sql);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sextou-migration-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

test('readMigrationFolder reads each migration, oldest first, split into statements', () => {
  write('20261020000000_b', 'CREATE TABLE b (x);');
  write(
    '20261019000000_a',
    'CREATE TABLE a (x);\n--> statement-breakpoint\n\nCREATE INDEX a_x ON a (x);\n--> statement-breakpoint\n',
  );
  expect(readMigrationFolder(dir)).toEqual([
    {
      id: '20261019000000_a',
      statements: ['CREATE TABLE a (x);', 'CREATE INDEX a_x ON a (x);'],
    },
    { id: '20261020000000_b', statements: ['CREATE TABLE b (x);'] },
  ]);
});

test('readMigrationFolder reads CRLF line endings as LF', () => {
  write('a', 'CREATE TABLE a (\n  x\n);\n--> statement-breakpoint\nSELECT 1;');
  write(
    'b',
    'CREATE TABLE a (\r\n  x\r\n);\r\n--> statement-breakpoint\r\nSELECT 1;',
  );
  const [lf, crlf] = readMigrationFolder(dir);
  expect(crlf?.statements).toEqual(lf?.statements);
});

test('readMigrationFolder skips a folder without migration.sql', () => {
  mkdirSync(join(dir, 'empty'));
  expect(readMigrationFolder(dir)).toEqual([]);
});

test('readMigrationFolder reads a missing folder as no migrations', () => {
  expect(readMigrationFolder(join(dir, 'missing'))).toEqual([]);
});

// A migration.sql edited or added without running the migration script.
test('migration.gen.ts holds the migration folder as rendered', () => {
  expect(migrations).toEqual(
    readMigrationFolder(join(import.meta.dirname, '..', 'migration')),
  );
});
