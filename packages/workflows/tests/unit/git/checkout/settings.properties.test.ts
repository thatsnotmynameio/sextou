import { fc, test } from '@fast-check/vitest';
import { sep } from 'node:path';
import { expect } from 'vitest';
import { readSettings } from '../../../../git/checkout/settings';

// The experiment's properties of the checkout's settings: whatever the
// context, an accepted one names an https repository owner/name, a ref git
// can't read as an option or a refspec, and a path inside the workspace.

const runs = { numRuns: Number(process.env.PROPERTY_RUNS ?? 100) };
const workspace = '/work/space';

const anyText = fc.string({ unit: 'binary', maxLength: 20 });
const piece = fc.oneof(
  anyText,
  fc.constantFrom('.', '..', '-', '/', ':', '*', ' ', '\0', 'a', 'B_1'),
);
// Text glued from pieces that matter to the checks, and anything else.
const glued = fc.array(piece, { maxLength: 6 }).map((parts) => parts.join(''));
const value = fc.oneof(
  glued,
  fc.constantFrom('https://github.com', 'http://x', 'file:///r', 'ext::sh'),
  fc.webUrl(),
  fc.anything(),
);
const context = fc.record(
  { repo: value, ref: value, path: value, server: value },
  { requiredKeys: [] },
);

test.prop([context], runs)(
  'readSettings accepts only an https owner/name, a ref that is neither an option nor a refspec, and a path inside the workspace',
  (fields) => {
    const result = readSettings(JSON.stringify(fields), workspace);
    if (!result.ok) {
      return;
    }
    const { url, ref, path } = result.settings;
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('https:');
    expect(parsed.pathname.split('/')).toHaveLength(3);
    expect(
      parsed.pathname
        .split('/')
        .slice(1)
        .every(
          (part) => /^[\w.-]+$/.test(part) && part !== '.' && part !== '..',
        ),
    ).toBe(true);
    expect(ref.startsWith('-') || /[:*\s\0]/.test(ref) || ref === '').toBe(
      false,
    );
    expect(path === workspace || path.startsWith(workspace + sep)).toBe(true);
  },
);

const part = fc
  .stringMatching(/^[\w.-]{1,10}$/)
  .filter((name) => name !== '.' && name !== '..');
const ref = fc
  .string({ minLength: 1, maxLength: 20 })
  .filter((text) => !text.startsWith('-') && !/[:*\s\0]/.test(text));

test.prop([part, part, ref, fc.domain()], runs)(
  'readSettings clones owner/name at the ref from the server it names',
  (owner, name, at, host) => {
    expect(
      readSettings(
        JSON.stringify({
          repo: `${owner}/${name}`,
          ref: at,
          server: `https://${host}/any/path`,
        }),
        workspace,
      ),
    ).toEqual({
      ok: true,
      settings: {
        url: `${new URL(`https://${host}`).origin}/${owner}/${name}`,
        ref: at,
        path: workspace,
      },
    });
  },
);
