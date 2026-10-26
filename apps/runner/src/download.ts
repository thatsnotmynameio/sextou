import { execFile, spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';

export interface DownloadOptions {
  // Where repositories are downloaded from: GitHub, or a server that answers
  // its archive URLs.
  githubUrl: string;
  // The repository, owner/name, and the commit to download it at.
  repo: string;
  sha: string;
  // The folder the repository's files are extracted into, which must exist.
  dir: string;
  // How long the download and the extraction may take together.
  timeoutMs: number;
  // Stops the download once it aborts.
  signal: AbortSignal;
}

// Downloads a repository at a commit, as GitHub's gzipped tarball of it,
// <githubUrl>/<repo>/archive/<sha>.tar.gz, and extracts it into `dir` with the
// system's tar, without the tarball's one top folder (<name>-<sha>/). It
// resolves with why it failed, or undefined once it's extracted: HTTP and the
// status, timeout, aborted, why the request or tar didn't start, or tar's exit
// code, or the signal that ended it, and what it wrote on stderr. A stop ends
// the download and kills tar, even one still extracting a tarball that arrived
// whole, and waits for tar to exit, so nothing writes to `dir` afterwards; the
// runner's exit kills it too.
export async function download({
  githubUrl,
  repo,
  sha,
  dir,
  timeoutMs,
  signal,
}: DownloadOptions): Promise<string | undefined> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const stop = AbortSignal.any([signal, timeout]);
  const stopped = () => (timeout.aborted ? 'timeout' : 'aborted');
  let response: Response;
  try {
    response = await fetch(`${githubUrl}/${repo}/archive/${sha}.tar.gz`, {
      signal: stop,
    });
  } catch (error) {
    return stop.aborted ? stopped() : (error as Error).message;
  }
  // A 204, say, is ok and has no body: there's nothing to extract.
  if (!response.ok || response.body === null) {
    // Stryker disable next-line OptionalChaining,MethodExpression: frees the connection only
    await response.body?.cancel();
    return `HTTP ${response.status}`;
  }

  // tar -x writes nothing to stdout: only stdin and stderr are read. -f -
  // reads the archive from stdin even when TAPE names another one. The stop
  // kills it with SIGTERM.
  const tar = spawn(
    'tar',
    ['-xz', '-f', '-', '--strip-components=1', '-C', dir],
    { signal: stop },
  );
  // tar outlives the runner unless the runner kills it: on exit, as through
  // process.exit, which runs only what is synchronous.
  const killOnExit = () => tar.kill('SIGKILL');
  process.on('exit', killOnExit);
  let stderr = '';
  tar.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  // A body cut short reaches tar as an archive cut short, and tar exiting
  // early, as on a body that isn't gzip, ends the copy with EPIPE: tar's exit
  // tells either way.
  const copied = pipeline(
    Readable.fromWeb(response.body as ReadableStream),
    tar.stdin,
  ).catch(() => undefined);
  const exited = new Promise<{
    code: number | null;
    signalName: NodeJS.Signals | null;
    error?: Error;
  }>((resolve) => {
    let error: Error | undefined;
    // A tar that doesn't start emits error, then close.
    tar.on('error', (spawnError) => {
      error = spawnError;
    });
    tar.on('close', (code, signalName) => resolve({ code, signalName, error }));
  });
  const [{ code, signalName, error }] = await Promise.all([exited, copied]);
  process.off('exit', killOnExit);
  if (stop.aborted) {
    return stopped();
  }
  if (error) {
    return error.message;
  }
  if (code === null) {
    return `tar signal ${signalName}`;
  }
  if (code !== 0) {
    return `tar exit code ${code}: ${stderr.trim()}`;
  }
  return undefined;
}

// Resolves with why the system's tar doesn't run, or undefined when it does:
// it doesn't start, it fails, or it takes longer than `timeoutMs` to print its
// version.
export function checkTar(timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('tar', ['--version'], { timeout: timeoutMs }, (error) => {
      if (error === null) {
        resolve(undefined);
      } else if (error.killed) {
        resolve('timeout');
      } else {
        resolve(error.message);
      }
    });
  });
}
