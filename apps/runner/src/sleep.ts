// Resolves once `ms` pass, or at once when the signal aborts.
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      // Each sleep adds a listener to a signal that may outlive it, such as
      // the runner's one: without this, they pile up for as long as the
      // signal lives, which no test sees.
      // Stryker disable next-line StringLiteral,CallExpression: a leak only
      signal.removeEventListener('abort', wake);
      resolve();
    };
    const timer = setTimeout(wake, ms);
    signal.addEventListener('abort', wake);
    if (signal.aborted) {
      wake();
    }
  });
}
