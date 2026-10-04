/**
 * The signal that opens the "this is a demo" sheet, from wherever a write got
 * blocked.
 *
 * The block itself happens inside `useSync().mutate` (`@/sync/provider`),
 * which is mounted above `DialogProvider` in `_layout.tsx` and so has no way
 * to call `useDialog()` itself — a provider cannot reach a context that is
 * its own descendant. Rather than restructure the provider tree around one
 * sheet, the guard fires this plain module-level signal — the same
 * subscribe/emit shape `lib/favorites.ts` uses for a cross-screen star — and
 * `DemoGateHost`, mounted once *inside* `DialogProvider`, is the one listener
 * that turns it into the actual `confirm()` the person sees.
 */

const listeners = new Set<() => void>();

/** Ask whatever is listening to open the demo-write sheet. Safe to call with
 *  nobody mounted yet (startup, or a test with no host) — it is simply a
 *  no-op, the same as a toast fired before `ToastProvider` exists. */
export function requestDemoGate(): void {
  for (const listener of listeners) listener();
}

export function subscribeDemoGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: drop every listener, as if nothing had ever mounted. */
export function __resetDemoGateForTest(): void {
  listeners.clear();
}
