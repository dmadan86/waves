/**
 * Time budgets and a circuit breaker for the voice functions' outbound calls
 * (Deepgram, the LLM providers). Nothing here knows about voice: it is a fetch
 * with a deadline, a promise race, and a per-key failure counter.
 *
 * The breaker lives per warm function instance (module state). After
 * `threshold` consecutive failures for a key it opens for `cooldownMs`: callers
 * skip that provider and go straight to the next one, or fail fast. The first
 * call after the cooldown is a trial; success closes the breaker, failure opens
 * it again for another cooldown. A cold instance starts closed — there is no
 * shared state to go wrong, and one instance's view is enough to stop a
 * stampede of 4-second timeouts against a provider that is down.
 */

/** An outbound call ran out of its budget (and was aborted). */
export class DeadlineExceeded extends Error {
  constructor(
    readonly label: string,
    readonly ms: number,
  ) {
    super(`${label} exceeded ${ms} ms`);
    this.name = 'DeadlineExceeded';
  }
}

/** A provider's answer, read whole within the deadline. */
export interface DeadlineResponse {
  readonly status: number;
  readonly ok: boolean;
  /** The parsed JSON body; null when it was not JSON (a malformed answer). */
  readonly body: unknown;
}

/**
 * `fetchFn(url, init)` and its JSON body, aborted after `ms`. The abort reaches
 * the socket (the provider stops working on an answer nobody will read), and
 * the promise rejects with {@link DeadlineExceeded} rather than a bare
 * AbortError so a timeout can be told from a refused connection. The body is
 * read under the same deadline: a provider that sends headers and then stalls
 * is cut off too.
 */
export async function fetchJsonWithDeadline(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  ms: number,
  label: string,
): Promise<DeadlineResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(0, ms),
  );
  try {
    const response = await fetchFn(url, { ...init, signal: controller.signal });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (error) {
      if (timedOut) throw error;
      body = null;
    }
    return { status: response.status, ok: response.ok, body };
  } catch (error) {
    if (timedOut) throw new DeadlineExceeded(label, ms);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `promise`, or `onTimeout()` thrown after `ms`. The work itself is not
 * cancelled (a Supabase query cannot be); use for reads whose late answer is
 * harmless, and see `voice-agent` for the one write (the quota reservation)
 * whose late answer is handled.
 */
export function raceDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => Error,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), Math.max(0, ms));
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export interface BreakerOptions {
  /** Consecutive failures that open the breaker. */
  readonly threshold?: number;
  /** How long an open breaker skips the key. */
  readonly cooldownMs?: number;
  readonly now?: () => number;
}

export const BREAKER_THRESHOLD = 3;
export const BREAKER_COOLDOWN_MS = 60_000;

/** Consecutive-failure circuit breaker keyed by provider. */
export class CircuitBreaker {
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly state = new Map<string, { failures: number; openUntil: number }>();

  constructor(options: BreakerOptions = {}) {
    this.threshold = options.threshold ?? BREAKER_THRESHOLD;
    this.cooldownMs = options.cooldownMs ?? BREAKER_COOLDOWN_MS;
    this.now = options.now ?? (() => Date.now());
  }

  /** True while `key` should be skipped. */
  isOpen(key: string): boolean {
    const entry = this.state.get(key);
    return !!entry && entry.openUntil > this.now();
  }

  success(key: string): void {
    this.state.delete(key);
  }

  failure(key: string): void {
    const entry = this.state.get(key) ?? { failures: 0, openUntil: 0 };
    entry.failures += 1;
    if (entry.failures >= this.threshold) {
      entry.openUntil = this.now() + this.cooldownMs;
      // Half-open after the cooldown: one more failure re-opens at once.
      entry.failures = this.threshold - 1;
      console.warn(JSON.stringify({ event: 'breaker_open', key, cooldownMs: this.cooldownMs }));
    }
    this.state.set(key, entry);
  }

  reset(): void {
    this.state.clear();
  }
}
