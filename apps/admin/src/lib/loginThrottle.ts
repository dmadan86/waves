import 'server-only';

import { createClient } from '@supabase/supabase-js';

/**
 * Slows a brute-force at the login form.
 *
 * The console is one shared password behind Cloudflare Access. Limit guesses
 * both per address and globally so rotating addresses cannot bypass the gate.
 *
 * The counting is done in Postgres by `waves_rate_limit` — the same limiter the
 * edge functions use (`supabase/functions/_shared/rateLimit.ts`) — and not in
 * memory, for the same reason it is written up there: Vercel runs the middleware
 * and server actions across many short-lived isolates, so an in-memory counter
 * would count almost nothing and look like it worked in a single-instance test.
 * Keyed on the client address, since there is no signed-in identity to blame at
 * a login. The bucket carries its own limit here rather than relying on a
 * `rate_limit_rules` row, so it works whether or not one has been configured.
 *
 * Fails closed when the database check fails, and when service configuration
 * is missing in production. Local development may run without Supabase.
 */

const BUCKET = 'admin-login';

/** Ten tries per quarter hour, per address. Far more than a person fat-fingering
 * a password, far less than a script needs to be worth running. */
const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 15 * 60;

export interface ThrottleDecision {
  allowed: boolean;
  /** Seconds until the window reopens. Zero when allowed. */
  retryAfter: number;
}

function service() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Prefer Cloudflare's injected address: proxy.ts requires its origin secret,
 * so callers cannot bypass Cloudflare Access and forge this header. Fall back
 * to x-real-ip, then the last (nearest proxy) x-forwarded-for entry.
 */
export function clientAddress(headers: { get(name: string): string | null }): string {
  return (
    headers.get('cf-connecting-ip')?.trim() ||
    headers.get('x-real-ip')?.trim() ||
    headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ||
    'unknown'
  );
}

/** Count submits per address, then globally only if the address is not blocked. */
export async function recordLoginAttempt(address: string): Promise<ThrottleDecision> {
  const closed = { allowed: false, retryAfter: 60 };
  try {
    const svc = service();
    if (!svc)
      return process.env.NODE_ENV === 'production' ? closed : { allowed: true, retryAfter: 0 };

    let retryAfter = 0;
    for (const [subject, bucket, limit] of [
      [`ip:${address}`, BUCKET, MAX_ATTEMPTS],
      ['global', 'admin-login-global', 100],
    ] as const) {
      const { data, error } = await svc.rpc('waves_rate_limit', {
        p_subject: subject,
        p_bucket: bucket,
        p_limit: limit,
        p_window_seconds: WINDOW_SECONDS,
      });
      if (error || !data || typeof data.allowed !== 'boolean') {
        console.error('admin login throttle check failed, refusing attempt:', error);
        retryAfter = Math.max(retryAfter, 60);
        continue;
      }
      if (!data.allowed) {
        const delay = Math.max(Number(data.retryAfter) || 1, 1);
        retryAfter = Math.max(retryAfter, delay);
        console.warn(
          `[ALERT] admin-login lockout: address=${address} bucket=${bucket} retryAfterSeconds=${delay}`,
        );
        break;
      }
    }
    return { allowed: retryAfter === 0, retryAfter };
  } catch (error) {
    console.error('admin login throttle check failed, refusing attempt:', error);
    return closed;
  }
}
