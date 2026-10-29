import { fc, test } from '@fast-check/vitest';
import { expect } from 'vitest';
import { errorPageURL } from '../../../src/main/error-page';

// The experiment's property of the error page: "Try again" links back to the
// web app, for any web app URL.

const prefix = 'data:text/html;charset=utf-8,';
const runs = { numRuns: Number(process.env.ERROR_PAGE_PROPERTY_RUNS ?? 100) };

test.prop(
  [
    fc.webUrl({
      validSchemes: ['http', 'https'],
      authoritySettings: { withPort: true, withUserInfo: true },
      withQueryParameters: true,
      withFragments: true,
    }),
  ],
  runs,
)('errorPageURL links "Try again" back to any web app URL', (webApp) => {
  const url = errorPageURL(webApp);
  expect(url.startsWith(prefix)).toBe(true);
  const html = decodeURIComponent(url.slice(prefix.length));
  expect(html.match(/<a href="([^"]*)">Try again<\/a>/)?.[1]).toBe(webApp);
});
