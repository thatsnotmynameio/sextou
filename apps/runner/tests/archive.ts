import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// A commit the tests' sources name.
export const sha = '0123456789abcdef0123456789abcdef01234567';

// A gzipped tarball as GitHub serves a repository at a commit: each file,
// by its path in the repository, under one top folder.
export function archive(files: Record<string, string>): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'sextou-archive-'));
  try {
    for (const [path, text] of Object.entries(files)) {
      const file = join(dir, `sextou-${sha}`, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    return execFileSync('tar', ['-cz', '-C', dir, `sextou-${sha}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The text of a Taskfile whose default task runs `cmds` with no echo of each
// command.
export function plaintext(cmds: string[]) {
  return [
    'version: "3"',
    'silent: true',
    'tasks:',
    '  default:',
    '    cmds:',
    ...cmds.map((cmd) => `      - ${JSON.stringify(cmd)}`),
  ].join('\n');
}

// Answers every request with `body`.
export function answer(body: Buffer): RequestListener {
  return (_request, response) => {
    response.end(body);
  };
}

export interface Served {
  // The server's URL, with no trailing slash.
  url: string;
  // The path of each request it got, in order.
  paths: string[];
  // Closes the server and every connection it holds, a hanging one included.
  close: () => Promise<void>;
}

// An HTTP server on localhost, on a port the system picks, that answers
// each request with `listener`.
export async function serve(listener: RequestListener): Promise<Served> {
  const paths: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url as string);
    listener(request, response);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    paths,
    close: async () => {
      const closed = once(server, 'close');
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
