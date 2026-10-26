export interface Settings {
  // Where the server answers: the client calls `${serverUrl}/trpc`, and the
  // Content Security Policy lets the page connect to its origin.
  serverUrl: string;
  // How long a request to the server may take before the page says the
  // server can't be reached.
  requestTimeoutMs: number;
  // The dev server's port. The desktop's SEXTOU_WEB_URL and the server's
  // SEXTOU_SERVER_WEB_ORIGIN name the origin it makes.
  port: number;
}

// The web app's settings, from the environment vite.config.ts loads: each
// variable has a default, and apps/web/.env.example lists them. Throws
// naming the variable on an invalid value.
export function readSettings(env: Record<string, string | undefined>) {
  const read = <T>(
    name: string,
    parse: (value: string, name: string) => T,
    fallback: T,
  ): T => {
    const value = env[name];
    return value === undefined ? fallback : parse(value, name);
  };

  return {
    serverUrl: read('SEXTOU_WEB_SERVER_URL', parseUrl, 'http://127.0.0.1:4310'),
    requestTimeoutMs: read(
      'SEXTOU_WEB_REQUEST_TIMEOUT_MS',
      parseTimeout,
      30000,
    ),
    port: read('SEXTOU_WEB_PORT', parsePort, 5173),
  } satisfies Settings;
}

function invalid(name: string, value: string, expected: string) {
  return new Error(
    `Invalid ${name}: ${JSON.stringify(value)} (expected ${expected})`,
  );
}

function parseUrl(value: string, name: string): string {
  const url = URL.parse(value);
  if (url?.protocol !== 'http:' && url?.protocol !== 'https:') {
    throw invalid(name, value, 'an http or https URL');
  }
  // A loop rather than /\/+$/, which backtracks over every run of slashes
  // that isn't at the end.
  let href = url.href;
  while (href.endsWith('/')) {
    href = href.slice(0, -1);
  }
  return href;
}

// Only digits, from 1 millisecond to the longest delay a timer takes, the
// same bound as the server's database timeout.
function parseTimeout(value: string, name: string): number {
  const ms = Number(value);
  if (!/^\d+$/.test(value) || ms === 0 || ms > 2147483647) {
    throw invalid(
      name,
      value,
      'a whole number of milliseconds from 1 to 2147483647',
    );
  }
  return ms;
}

// Only digits, from 1 to 65535.
function parsePort(value: string, name: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port === 0 || port > 65535) {
    throw invalid(name, value, 'a port from 1 to 65535');
  }
  return port;
}
