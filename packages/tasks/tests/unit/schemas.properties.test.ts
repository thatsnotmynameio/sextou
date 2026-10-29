import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';
import { splitUses } from '../../src/schemas';

// The experiment's properties of splitUses: any uses built from valid parts
// splits back into them, and one . , .. or empty part anywhere refuses it.

const repoPart = fc
  .stringMatching(/^[\w.-]{1,12}$/)
  .filter((part) => part !== '.' && part !== '..');
const pathPart = fc
  .string({ minLength: 1, maxLength: 12 })
  .filter((part) => !part.includes('/') && part !== '.' && part !== '..');
const sha = fc.stringMatching(/^[0-9a-f]{40}$/);
const parts = fc.record({
  owner: repoPart,
  name: repoPart,
  path: fc.array(pathPart, { minLength: 1, maxLength: 5 }),
  sha,
});

test.prop([parts], { numRuns: Number(process.env.USES_PROPERTY_RUNS ?? 100) })(
  'splitUses splits any uses of valid parts back into them',
  ({ owner, name, path, sha }) => {
    expect(splitUses(`${owner}/${name}/${path.join('/')}@${sha}`)).toEqual({
      repo: `${owner}/${name}`,
      sha,
      taskfile: path.join('/'),
    });
  },
);

test.prop([parts, fc.constantFrom('', '.', '..'), fc.nat()], {
  numRuns: Number(process.env.USES_PROPERTY_RUNS ?? 100),
})(
  'splitUses refuses a uses whose path holds an empty, . or .. part anywhere',
  ({ owner, name, path, sha }, bad, at) => {
    const broken = path.toSpliced(at % (path.length + 1), 0, bad);
    expect(splitUses(`${owner}/${name}/${broken.join('/')}@${sha}`)).toBeNull();
  },
);

test.prop([parts, fc.constantFrom('.', '..'), fc.boolean()], {
  numRuns: Number(process.env.USES_PROPERTY_RUNS ?? 100),
})(
  'splitUses refuses a uses whose owner or name is . or ..',
  ({ owner, name, path, sha }, bad, onOwner) => {
    const repo = onOwner ? `${bad}/${name}` : `${owner}/${bad}`;
    expect(splitUses(`${repo}/${path.join('/')}@${sha}`)).toBeNull();
  },
);
