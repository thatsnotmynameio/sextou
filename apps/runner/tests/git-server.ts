import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface GitServer {
  // The server's URL, https://127.0.0.1:<port>, with no trailing slash.
  url: string;
  // The certificate git trusts the server by, for GIT_SSL_CAINFO.
  ca: string;
  close: () => Promise<void>;
}

// An HTTPS server on localhost that serves the git repositories under `root`
// as GitHub does, <url>/<owner>/<name>, through git's own http-backend, with a
// certificate openssl makes for it.
export async function serveGit(root: string): Promise<GitServer> {
  const dir = mkdtempSync(join(tmpdir(), 'sextou-git-server-'));
  const key = join(dir, 'key.pem');
  const ca = join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'ec',
      '-pkeyopt',
      'ec_paramgen_curve:prime256v1',
      '-nodes',
      '-keyout',
      key,
      '-out',
      ca,
      '-days',
      '1',
      '-subj',
      '/CN=127.0.0.1',
      '-addext',
      'subjectAltName=IP:127.0.0.1',
    ],
    { stdio: 'ignore' },
  );
  const server = createServer(
    { key: readFileSync(key), cert: readFileSync(ca) },
    (request, response) => backend(root, request, response),
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `https://127.0.0.1:${port}`,
    ca,
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, 'close');
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Answers a request through git http-backend, a CGI program: the request
// goes in as environment variables and its body, and the answer comes out as
// headers, a blank line, then the body.
function backend(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? '/', 'https://127.0.0.1');
  const header = (name: string) => {
    const value = request.headers[name];
    return typeof value === 'string' ? value : '';
  };
  const cgi = spawn('git', ['http-backend'], {
    env: {
      ...process.env,
      GIT_PROJECT_ROOT: root,
      GIT_HTTP_EXPORT_ALL: '1',
      GIT_PROTOCOL: header('git-protocol'),
      PATH_INFO: url.pathname,
      QUERY_STRING: url.search.slice(1),
      REQUEST_METHOD: request.method ?? 'GET',
      CONTENT_TYPE: header('content-type'),
      HTTP_CONTENT_ENCODING: header('content-encoding'),
      REMOTE_ADDR: '127.0.0.1',
    },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  request.pipe(cgi.stdin);
  let head = Buffer.alloc(0);
  let started = false;
  cgi.stdout.on('data', (chunk: Buffer) => {
    if (started) {
      response.write(chunk);
      return;
    }
    head = Buffer.concat([head, chunk]);
    const end = head.indexOf('\r\n\r\n');
    if (end === -1) {
      return;
    }
    started = true;
    let status = 200;
    const headers: Record<string, string> = {};
    for (const line of head.subarray(0, end).toString().split('\r\n')) {
      const colon = line.indexOf(':');
      const name = line.slice(0, colon);
      const value = line.slice(colon + 1).trim();
      if (name.toLowerCase() === 'status') {
        status = Number.parseInt(value, 10);
      } else {
        headers[name] = value;
      }
    }
    response.writeHead(status, headers);
    response.write(head.subarray(end + 4));
  });
  cgi.stdout.on('end', () => response.end());
}
