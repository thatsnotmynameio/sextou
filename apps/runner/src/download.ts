import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';

export interface DownloadOptions {
  // A gzipped tarball whose entries sit in one top folder, as GitHub's
  // archive of a repository at a commit, <name>-<sha>/.
  url: string;
  // The folder the tarball's top folder is extracted into, which must exist.
  dir: string;
  // How long the download and the extraction may take together.
  timeoutMs: number;
  // Stops the download once it aborts.
  signal: AbortSignal;
}

// Downloads a gzipped tarball and extracts it into `dir` with the system's
// tar, without its top folder, and resolves with why it failed, or undefined
// once it's extracted: HTTP and the status, timeout, aborted, why the request
// or tar didn't start, or tar's exit code and what it wrote on stderr. A stop
// ends the download, which ends tar's input, and waits for tar to exit, so
// nothing writes to `dir` afterwards.
export async function download({
  url,
  dir,
  timeoutMs,
  signal,
}: DownloadOptions): Promise<string | undefined> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const stop = AbortSignal.any([signal, timeout]);
  const stopped = () => (timeout.aborted ? 'timeout' : 'aborted');
  let response: Response;
  try {
    response = await fetch(url, { signal: stop });
  } catch (error) {
    return stop.aborted ? stopped() : (error as Error).message;
  }
  // A 204, say, is ok and has no body: there's nothing to extract.
  if (!response.ok || response.body === null) {
    // Stryker disable next-line OptionalChaining,MethodExpression: frees the connection only
    await response.body?.cancel();
    return `HTTP ${response.status}`;
  }

  // tar -x writes nothing to stdout: only stdin and stderr are read.
  const tar = spawn('tar', ['-xz', '--strip-components=1', '-C', dir]);
  let stderr = '';
  tar.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  // A body cut short reaches tar as an archive cut short, and tar exiting
  // early, as on a body that isn't gzip, ends the copy with EPIPE: tar's exit
  // tells either way.
  // Stryker disable next-line ArrowFunction: tar's exit tells either way
  const copied = pipeline(
    Readable.fromWeb(response.body as ReadableStream),
    tar.stdin,
  ).catch(() => undefined);
  const exited = new Promise<{ code: number | null; error?: Error }>(
    (resolve) => {
      let error: Error | undefined;
      // A tar that doesn't start emits error, then close.
      tar.on('error', (spawnError) => {
        error = spawnError;
      });
      tar.on('close', (code) => resolve({ code, error }));
    },
  );
  const [{ code, error }] = await Promise.all([exited, copied]);
  if (stop.aborted) {
    return stopped();
  }
  if (error) {
    return error.message;
  }
  if (code !== 0) {
    return `tar exit code ${code}: ${stderr.trim()}`;
  }
  return undefined;
}
