/** Small pure timer owner, separated so replacement and cancellation are testable. */
export function createUndoScheduler() {
  const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; commit: () => void }>();
  return {
    schedule(key: string, commit: () => void, delayMs: number, onExpire?: () => void) {
      const previous = pending.get(key);
      if (previous) clearTimeout(previous.timer);
      const timer = setTimeout(() => {
        if (pending.get(key)?.timer !== timer) return;
        pending.delete(key);
        commit();
        onExpire?.();
      }, delayMs);
      pending.set(key, { timer, commit });
    },
    cancel(key: string) {
      const item = pending.get(key);
      if (!item) return false;
      clearTimeout(item.timer);
      pending.delete(key);
      return true;
    },
    flush() {
      const actions = [...pending.values()];
      pending.clear();
      for (const action of actions) {
        clearTimeout(action.timer);
        action.commit();
      }
    },
    has(key: string) {
      return pending.has(key);
    },
    clear() {
      for (const action of pending.values()) clearTimeout(action.timer);
      pending.clear();
    },
  };
}
