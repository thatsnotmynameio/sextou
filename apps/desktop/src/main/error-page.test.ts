import { expect, it } from 'vitest';
import { errorPageURL } from './error-page';

it('links "Try again" back to the web app', () => {
  const url = errorPageURL('https://app.example');
  const prefix = 'data:text/html;charset=utf-8,';

  expect(url.startsWith(prefix)).toBe(true);
  expect(decodeURIComponent(url.slice(prefix.length))).toContain(
    '<a href="https://app.example">Try again</a>',
  );
});
