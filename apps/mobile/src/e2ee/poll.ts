/**
 * A short poll for the couple mailbox while the app is in the foreground.
 * The 5-minute sync cycle is too slow for a partner's edit on an open screen, and there is
 * no push for ordinary edits. No timer runs in the background (the caller stops it).
 */
export function createForegroundPoll(run: () => unknown, hasWork: () => boolean, ms: number) {
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    start(): void {
      timer ??= setInterval(() => {
        if (hasWork()) void run();
      }, ms);
    },
    stop(): void {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
