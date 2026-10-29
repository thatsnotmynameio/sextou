import { fc, test } from '@fast-check/vitest';
import { sep } from 'node:path';
import { expect } from 'vitest';
import { readInput } from '../../../../harness/agnostic-cli/settings';

// The experiment's properties of the core's input.

const runs = { numRuns: Number(process.env.PROPERTY_RUNS ?? 100) };
const workspace = '/work/space';

const path = fc.oneof(
  fc
    .array(fc.oneof(fc.string(), fc.constantFrom('.', '..', '', '\0')), {
      maxLength: 6,
    })
    .map((parts) => parts.join('/')),
  fc.anything(),
);

test.prop([fc.oneof(fc.string(), fc.anything()), path], runs)(
  'readInput accepts only a prompt with text and a cwd inside the workspace, keeping every field',
  (prompt, where) => {
    const fields = { prompt, path: where };
    const result = readInput(JSON.stringify(fields), workspace);
    if (!result.ok) {
      return;
    }
    const { input } = result;
    expect(typeof input.prompt === 'string' && input.prompt.trim() !== '').toBe(
      true,
    );
    expect(
      input.cwd === workspace || input.cwd.startsWith(workspace + sep),
    ).toBe(true);
    expect(input.fields).toEqual(JSON.parse(JSON.stringify(fields)));
  },
);
