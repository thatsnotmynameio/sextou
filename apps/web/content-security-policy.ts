import type { Plugin } from 'vite';

// The page loads scripts, styles, fonts and images only from its own origin,
// and connects only to it and to the server, in browsers and in the desktop
// window, which loads this same page. A meta tag can't set frame-ancestors;
// that waits for hosting headers.
export function policy(serverUrl: string) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self'",
    "font-src 'self'",
    `connect-src 'self' ${new URL(serverUrl).origin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

// Adds the policy to the built index.html, first in <head> so it covers every
// resource. Only at build: the dev server injects an inline script and inline
// styles, and talks to its WebSocket, which the policy would block.
export function contentSecurityPolicy(serverUrl: string): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: policy(serverUrl),
          },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}
