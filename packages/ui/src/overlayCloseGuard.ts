/** Reject stale close callbacks, including callbacks queued before a reopen. */
export function createOverlayCloseGuard() {
  let generation = 0;
  let visible = false;
  return {
    request(next: boolean) {
      if (visible !== next) ++generation;
      visible = next;
    },
    begin: () => ++generation,
    cancel: () => {
      ++generation;
    },
    canClose: (current: number) => current === generation && !visible,
  };
}
