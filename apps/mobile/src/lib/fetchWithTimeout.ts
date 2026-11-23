/** How long a database call may take before it fails, matching the sync engine's limit. */
export const API_TIMEOUT_MS = 20_000;

/**
 * `fetch` that gives up on database calls (`/rest/v1/`, which covers tables and
 * RPCs) after `ms`, so a dead network surfaces as an error instead of a spinner
 * that never stops. Storage uploads, edge functions and auth keep the plain
 * fetch: a receipt upload or a voice reply can legitimately run longer.
 * A caller's own abort signal still works alongside the timer.
 */
export function fetchWithTimeout(
  ms: number = API_TIMEOUT_MS,
  base: typeof fetch = fetch,
): typeof fetch {
  return (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('/rest/v1/')) return base(input, init);
    const controller = new AbortController();
    const outer = init?.signal;
    if (outer?.aborted) controller.abort(outer.reason);
    const onAbort = () => controller.abort(outer?.reason);
    outer?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => controller.abort(new Error('Request timed out')), ms);
    return base(input, { ...init, signal: controller.signal }).finally(() => {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    });
  };
}
