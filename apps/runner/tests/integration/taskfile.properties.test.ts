import { spawnSync } from 'node:child_process';
import { fc, test } from '@fast-check/vitest';
import { memory } from '@sextou/logger/testing';
import { createLogger } from '@sextou/logger';
import { afterAll, beforeAll, expect } from 'vitest';
import { taskfileExecute } from '../../src/taskfile';
import {
  answer,
  archive,
  plaintext,
  serve,
  sha,
  type Served,
} from '../archive';
import { bin } from '../go-task';

// The experiment's properties of the context a run gets: any context reaches
// the Taskfile as written, through CONTEXT and through fromJson, and never
// runs as a template or a command. Each run downloads, extracts and runs
// go-task, so the suite runs few of them; the mutation config fewer.
const numRuns = Number(process.env.CONTEXT_PROPERTY_RUNS ?? 20);
const path = 'tasks/test/Taskfile.yml';

// A Taskfile that prints CONTEXT as it got it, and one that prints the
// context's value through fromJson. printf, not echo, which would read a
// value such as -n as its option.
const raw = plaintext([`printf '%s\\n' {{.CONTEXT | q}}`]);
const parsed = [
  'version: "3"',
  'silent: true',
  'tasks:',
  '  default:',
  '    vars:',
  '      INPUT:',
  '        ref: fromJson .CONTEXT',
  '    cmds:',
  `      - ${JSON.stringify(`printf '%s\\n' {{.INPUT.value | q}}`)}`,
].join('\n');

let rawServer: Served;
let parsedServer: Served;

beforeAll(async () => {
  rawServer = await serve(answer(archive({ [path]: raw })));
  parsedServer = await serve(answer(archive({ [path]: parsed })));
});

afterAll(async () => {
  await rawServer.close();
  await parsedServer.close();
});

// Runs the task with `context` against the repository `server` serves, and
// returns what it printed, line by line, with how it ended.
async function execute(server: Served, context: Record<string, unknown>) {
  const output = memory();
  const result = await taskfileExecute({
    githubUrl: server.url,
    downloadTimeoutMs: 5000,
    tarBin: 'tar',
    bin,
    maxTasksFileBytes: 1048576,
    timeoutMs: 20000,
    killGraceMs: 5000,
  })(
    { id: 'tsk_1', uses: { repo: 'org/app', sha, taskfile: path }, context },
    {
      signal: new AbortController().signal,
      logger: createLogger(
        { level: 'info', pretty: false },
        output.destination,
      ),
    },
  );
  const lines = output
    .records()
    .map((record) => record as { msg: string; stream: string; line: string })
    .filter((record) => record.msg === 'output' && record.stream === 'stdout')
    .map(({ line }) => line);
  return { result, lines };
}

// Text with the characters go-task and a shell read: braces, dots, quotes,
// dollars, pipes, backslashes, and any other.
const text = fc.oneof(
  fc.string({
    unit: fc.constantFrom(...'{}.$|\\"\'` ;&()<>*?~#!-'),
    maxLength: 30,
  }),
  fc.string({ unit: 'grapheme', maxLength: 30 }),
);
// A value printf writes on one line of its own.
const line = text.filter((value) => !/[\n\r\0]/.test(value));
const context = fc.dictionary(
  text,
  fc.jsonValue({
    maxDepth: 3,
    stringUnit: fc.oneof(
      fc.constantFrom(...'{}'),
      fc.string({ minLength: 1, maxLength: 1, unit: 'grapheme' }),
    ),
  }),
  { maxKeys: 5 },
) as fc.Arbitrary<Record<string, unknown>>;

// go-task.ts's check, on fast-check's test: its skipIf(...) loses .prop.
const help = spawnSync(bin, ['--help'], { encoding: 'utf8' });
const goTaskProp = `${help.stdout}${help.stderr}`.includes('--taskfile')
  ? test.prop
  : test.skip.prop;

goTaskProp([context], { numRuns })(
  'taskfileExecute hands any context to CONTEXT as JSON that reads back as the context',
  async (value) => {
    const { result, lines } = await execute(rawServer, value);

    expect(result).toEqual({ outcome: 'succeeded' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('{{');
    expect(JSON.parse(lines[0])).toEqual(JSON.parse(JSON.stringify(value)));
  },
  900_000,
);

goTaskProp([line], { numRuns })(
  'taskfileExecute hands any context value through fromJson as written, never as a template or a command',
  async (value) => {
    const { result, lines } = await execute(parsedServer, { value });

    expect(result).toEqual({ outcome: 'succeeded' });
    expect(lines).toEqual([value]);
  },
  900_000,
);
