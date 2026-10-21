import { expect, test } from 'vitest';
import { contentSecurityPolicy, policy } from './content-security-policy';

test('policy lets the page connect to the server’s origin, without its path', () => {
  expect(policy('https://api.example:8443/v1')).toContain(
    "connect-src 'self' https://api.example:8443;",
  );
});

test('policy loads everything else only from the page’s own origin', () => {
  expect(policy('http://127.0.0.1:4310').split('; ')).toEqual([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    "connect-src 'self' http://127.0.0.1:4310",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ]);
});

test('contentSecurityPolicy applies only to the build', () => {
  expect(contentSecurityPolicy('http://127.0.0.1:4310').apply).toBe('build');
});

test('contentSecurityPolicy puts the policy first in the built page’s head', () => {
  const plugin = contentSecurityPolicy('http://127.0.0.1:4310');
  const transform = plugin.transformIndexHtml as () => unknown;

  expect(transform()).toEqual([
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content: policy('http://127.0.0.1:4310'),
      },
      injectTo: 'head-prepend',
    },
  ]);
});
