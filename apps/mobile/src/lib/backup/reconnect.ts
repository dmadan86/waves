/** Bounded wait: foreground work must never wait indefinitely for connectivity. */
export async function waitForConnection(
  permits: () => Promise<boolean>,
  signal: AbortSignal,
  attempts = 60,
  subscribe?: (wake: () => void) => () => void,
): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (signal.aborted) throw new Error('Backup cancelled');
    if (await permits()) return;
    await new Promise<void>((resolve, reject) => {
      let unsubscribe: (() => void) | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        unsubscribe?.();
      };
      const wake = () => {
        cleanup();
        resolve();
      };
      const abort = () => {
        cleanup();
        reject(new Error('Backup cancelled'));
      };
      const timer = setTimeout(wake, 1000);
      unsubscribe = subscribe?.(wake);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw new Error('Backup connection unavailable');
}
