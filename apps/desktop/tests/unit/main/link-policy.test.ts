import { expect, test } from 'vitest';
import { linkAction } from '../../../src/main/link-policy';

const webApp = 'https://app.example';

test('linkAction allows pages on the web app origin', () => {
  expect(linkAction(webApp, 'https://app.example/inbox?x=1#y')).toBe('allow');
  expect(
    linkAction('http://localhost:5173', 'http://localhost:5173/settings'),
  ).toBe('allow');
});

test('linkAction opens other origins externally', () => {
  expect(linkAction('http://localhost:5173', 'http://localhost:3000/')).toBe(
    'external',
  );
  expect(linkAction(webApp, 'http://app.example/')).toBe('external');
  expect(linkAction(webApp, 'https://app.example.evil.com/')).toBe('external');
  expect(linkAction(webApp, 'https://user@app.example.evil.com/')).toBe(
    'external',
  );
});

test('linkAction opens mailto links externally', () => {
  expect(linkAction(webApp, 'mailto:someone@example.com')).toBe('external');
});

test.each([
  'file:///etc/passwd',
  'javascript:alert(1)',
  'data:text/html,x',
  'about:blank',
  'otherapp://open',
  'blob:https://app.example/uuid',
  'not a url',
])('linkAction blocks %s', (target) => {
  expect(linkAction(webApp, target)).toBe('block');
});

test.each(['', 'not a url'])(
  'linkAction allows nothing when the web app URL is %j',
  (url) => {
    expect(linkAction(url, 'https://example.com')).toBe('external');
    expect(linkAction(url, 'data:text/html,x')).toBe('block');
    expect(linkAction(url, 'about:blank')).toBe('block');
  },
);
