import { describe, expect, it } from 'vitest';
import { linkAction } from './link-policy';

describe('linkAction', () => {
  const webApp = 'https://app.example';

  it('allows pages on the web app origin', () => {
    expect(linkAction(webApp, 'https://app.example/inbox?x=1#y')).toBe('allow');
    expect(
      linkAction('http://localhost:5173', 'http://localhost:5173/settings'),
    ).toBe('allow');
  });

  it('opens other origins externally', () => {
    expect(linkAction('http://localhost:5173', 'http://localhost:3000/')).toBe(
      'external',
    );
    expect(linkAction(webApp, 'http://app.example/')).toBe('external');
    expect(linkAction(webApp, 'https://app.example.evil.com/')).toBe(
      'external',
    );
    expect(linkAction(webApp, 'https://user@app.example.evil.com/')).toBe(
      'external',
    );
  });

  it('opens mailto links externally', () => {
    expect(linkAction(webApp, 'mailto:someone@example.com')).toBe('external');
  });

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,x',
    'about:blank',
    'otherapp://open',
    'blob:https://app.example/uuid',
    'not a url',
  ])('blocks %s', (target) => {
    expect(linkAction(webApp, target)).toBe('block');
  });

  it.each(['', 'not a url'])(
    'allows nothing when the web app URL is %j',
    (url) => {
      expect(linkAction(url, 'https://example.com')).toBe('external');
      expect(linkAction(url, 'data:text/html,x')).toBe('block');
      expect(linkAction(url, 'about:blank')).toBe('block');
    },
  );
});
