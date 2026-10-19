import type { Plugin } from 'vite';

// The page loads scripts, styles, fonts, images and connections only from its
// own origin, in browsers and in the desktop window, which loads this same
// page. A meta tag can't set frame-ancestors; that waits for hosting headers.
const policy = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

// Adds the policy to the built index.html, first in <head> so it covers every
// resource. Only at build: the dev server injects an inline script and inline
// styles, and talks to its WebSocket, which the policy would block.
export function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
