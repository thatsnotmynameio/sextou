import { expect, test } from 'vitest';
import { errorPageURL } from '../../../src/main/error-page';

test('links "Try again" back to the web app', () => {
  const url = errorPageURL('https://app.example');
  const prefix = 'data:text/html;charset=utf-8,';

  expect(url.startsWith(prefix)).toBe(true);
  expect(decodeURIComponent(url.slice(prefix.length))).toContain(
    '<a href="https://app.example">Try again</a>',
  );
});
