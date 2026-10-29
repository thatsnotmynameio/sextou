import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';
import { readArgs } from '../../../../harness/claude-headless/settings';

// The experiment's properties of claude's arguments.

const runs = { numRuns: Number(process.env.PROPERTY_RUNS ?? 100) };

// Some of the options settings.ts lists, one of each kind.
const known = [
  'model',
  'fallbackModel',
  'maxBudgetUsd',
  'allowedTools',
  'settings',
  'mcpConfig',
  'verbose',
  'worktree',
];

test.prop(
  [
    fc.dictionary(
      fc.constantFrom(...known),
      fc.anything({ withNullPrototype: false }),
    ),
  ],
  runs,
)(
  'readArgs hands claude -p, then only --options, none with a NUL',
  (fields) => {
    const result = readArgs(fields);
    if (!result.ok) {
      return;
    }
    const [first, ...rest] = result.args;
    expect(first).toBe('-p');
    for (const arg of rest) {
      expect(typeof arg === 'string' || typeof arg === 'number').toBe(true);
      expect(String(arg).startsWith('--')).toBe(true);
      expect(String(arg).includes('\0')).toBe(false);
    }
  },
);

test.prop(
  [
    fc.dictionary(
      // No option of claude's starts with x.
      fc.string().map((key) => `x${key}`),
      fc.anything(),
    ),
  ],
  runs,
)('readArgs ignores any key that is not an option', (fields) => {
  expect(readArgs(fields)).toEqual({ ok: true, args: ['-p'] });
});

const item = fc
  .string({ unit: 'binary' })
  .filter((text) => !text.includes('\0'));

test.prop([fc.array(item, { minLength: 1, maxLength: 6 })], runs)(
  'readArgs passes each item of a list as its own --allowed-tools=item, in order',
  (tools) => {
    expect(readArgs({ allowedTools: tools })).toEqual({
      ok: true,
      args: ['-p', ...tools.map((tool) => `--allowed-tools=${tool}`)],
    });
  },
);

test.prop([fc.array(item, { maxLength: 6 })], runs)(
  'readArgs joins the items of a joined option with commas, in one argument',
  (models) => {
    expect(readArgs({ fallbackModel: models })).toEqual({
      ok: true,
      args: ['-p', `--fallback-model=${models.join(',')}`],
    });
  },
);
