import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// How a script runs a program.
export interface Run {
  cwd: string;
  env: NodeJS.ProcessEnv;
  // Aborting it stops the program: SIGTERM, then SIGKILL once killGraceMs
  // went by.
  signal: AbortSignal;
  killGraceMs: number;
  // What the program reads on its stdin, which closes after it.
  stdin?: string;
  // Where each line it writes goes, by the stream it wrote it to; with none,
  // they go nowhere.
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
}

// Runs `bin` with `args` until the signal aborts, and resolves with its exit
// code: `notRun` when it doesn't start, 1 when a signal ended it.
export function run(
  bin: string,
  args: string[],
  { cwd, env, signal, killGraceMs, stdin, stdout, stderr }: Run,
  notRun: number,
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env });
    let kill: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      child.kill('SIGTERM');
      kill = setTimeout(() => child.kill('SIGKILL'), killGraceMs);
    };
    if (signal.aborted) {
      stop();
    } else {
      signal.addEventListener('abort', stop, { once: true });
    }
    // A program it stopped is done once it exits, even when a child of it,
    // such as git's git-remote-https, still holds its output open.
    child.on('exit', () => {
      if (signal.aborted) {
        child.stdout.destroy();
        child.stderr.destroy();
      }
    });
    createInterface({ input: child.stdout, crlfDelay: Infinity }).on(
      'line',
      (line) => stdout?.(line),
    );
    createInterface({ input: child.stderr, crlfDelay: Infinity }).on(
      'line',
      (line) => stderr?.(line),
    );
    // A program that ends before it reads its stdin closes it: the write
    // fails, and its exit code says why.
    // Stryker disable next-line ArrowFunction: a handler that returns undefined ignores it the same
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
    // Stryker disable next-line ArrowFunction: close follows, with a negative code, which ends the same
    child.on('error', () => resolve(notRun));
    child.on('close', (code) => {
      clearTimeout(kill);
      signal.removeEventListener('abort', stop);
      resolve(code ?? 1);
    });
  });
}
