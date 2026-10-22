import { join } from 'node:path';
import { generate } from 'drizzle-kit/cli';
import { expect, test } from 'vitest';

// A change to schema.ts needs its migration, as schema.ts says. explain
// writes nothing and answers what generate would do.
test('schema.ts has no change without a migration', async () => {
  const result = await generate({
    config: join(import.meta.dirname, '..', 'drizzle.config.ts'),
    explain: true,
  });
  expect(result).toMatchObject({ status: 'no_changes' });
});
