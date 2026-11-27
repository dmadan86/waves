/**
 * A short poll for the couple mailbox while the app is in the foreground.
 * The 5-minute sync cycle is too slow for a partner's edit on an open screen, and there is
 * no push for ordinary edits. No timer runs in the background (the caller stops it).
 * It backs off while nothing arrives (10s, then 30s after 2 quiet minutes, then 60s) and
 * returns to 10s as soon as mail is applied.
 */
export function createForegroundPoll(
  run: () => Promise<number | void>,
  hasWork: () => boolean,
  ms: number,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let quiet = 0;
  const delay = () => (quiet < 12 ? ms : quiet < 36 ? ms * 3 : ms * 6);
  const tick = (): void => {
    timer = setTimeout(async () => {
      if (hasWork()) {
        const applied = await run().catch(() => 0);
        quiet = applied ? 0 : quiet + 1;
      }
      if (timer) tick();
    }, delay());
  };
  return {
    start(): void {
      if (timer) return;
      quiet = 0;
      tick();
    },
    stop(): void {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
