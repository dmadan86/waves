/**
 * fx-rate — a mid-market rate, as an exact rational (ADR-003).
 *
 * Two things this deliberately is not:
 *
 * It is not the only way to get a rate into an expense. Typing one, or deriving
 * it from a card statement, works offline and is often *more* accurate — a bank
 * charges its own rate with its own markup, and a mid-market number will never
 * match anybody's statement. This endpoint is the convenience, not the truth.
 *
 * It is not a float. The upstreams publish decimals; we turn them into num/den
 * at the boundary (providers.ts) and never let a double past it, because the
 * rate stored on an expense has to reproduce the same minor units a year from
 * now.
 *
 * Where a rate is looked for, in order:
 *
 *   1. this isolate's memory (24 h for a day's own published rate, 15 min for
 *      anything that may still change);
 *   2. `fx_daily_rates`, our own daily cache, shared by every isolate;
 *   3. the provider chain (ECB → currency-api → ExchangeRate-API), whose answer
 *      is written to the daily cache only when it really is the asked-for
 *      day's rate (for "latest": today's);
 *   4. if every provider fails, the most recent cached rate for the pair,
 *      flagged `stale: true` with its `day`. The app never applies one of those
 *      without asking.
 *
 * It is behind auth so it cannot be used as an open currency proxy.
 */

import { HttpError, errorResponse, json, type SupabaseClient } from '../_shared/auth.ts';
import { CircuitBreaker } from '../_shared/resilience.ts';
import { fetchFromChain, type FxSource } from './providers.ts';

/** A dated rate that really is that day's never changes. */
export const DATED_TTL_MS = 24 * 60 * 60 * 1000;
/** Anything that might still be revised or republished: short, like the latest. */
export const SHORT_TTL_MS = 15 * 60 * 1000;

/** One row of `fx_daily_rates`. */
export interface CachedRate {
  readonly day: string;
  readonly num: string;
  readonly den: string;
  readonly source: string;
}

/** The daily cache. Every method may fail; the handler treats a failure as a miss. */
export interface FxStore {
  get(from: string, to: string, day: string): Promise<CachedRate | null>;
  put(from: string, to: string, rate: CachedRate): Promise<void>;
  /** The newest row on or before `day`, else the newest row at all. */
  latest(from: string, to: string, day: string): Promise<CachedRate | null>;
}

export interface FxRateDeps {
  /** The caller's profile id from their session, or null. */
  callerId: (request: Request) => Promise<string | null>;
  /** Throws (429) when the caller is going too fast. */
  rateLimit: (request: Request, userId: string) => Promise<void>;
  store: () => FxStore;
  fetchFn: typeof fetch;
  now?: () => number;
  /** Per-isolate; injected so tests start empty. */
  memory?: Map<string, { at: number; ttl: number; body: unknown }>;
  breaker?: CircuitBreaker;
  timeoutMs?: number;
}

/** The response: the `expense_versions.fx` shape, plus `stale`/`day` on a fallback. */
export interface FxBody {
  num: string;
  den: string;
  from: string;
  to: string;
  ts: string;
  source: string;
  stale?: true;
  day?: string;
}

const memoryDefault = new Map<string, { at: number; ttl: number; body: unknown }>();
const breakerDefault = new CircuitBreaker({ threshold: 3, cooldownMs: 60_000 });

function body(from: string, to: string, rate: CachedRate): FxBody {
  return {
    // Exactly the shape stored in `expense_versions.fx`, so the client can hand
    // it straight back on the write with nothing in between to get wrong.
    num: rate.num,
    den: rate.den,
    from,
    to,
    // The rate's own day, not now(): reference rates are for a day, and saying
    // otherwise would misreport when the number was true.
    ts: `${rate.day}T00:00:00.000Z`,
    source: rate.source,
  };
}

async function quietly<T>(work: () => Promise<T>, label: string): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    // The cache is an optimisation: a failing read is a miss, a failing write
    // is a skipped write. Neither may fail the request.
    console.warn(
      JSON.stringify({ event: 'fx_cache_error', label, message: (error as Error)?.message }),
    );
    return null;
  }
}

export async function handleFxRate(request: Request, deps: FxRateDeps): Promise<Response> {
  try {
    const now = deps.now ?? Date.now;
    const memory = deps.memory ?? memoryDefault;
    const url = new URL(request.url);
    const from = (url.searchParams.get('from') ?? '').toUpperCase();
    const to = (url.searchParams.get('to') ?? '').toUpperCase();

    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) {
      throw new HttpError(400, 'BAD_CURRENCY', 'Pass two ISO-4217 codes, e.g. ?from=EUR&to=INR');
    }
    if (from === to) {
      throw new HttpError(400, 'SAME_CURRENCY', 'Those are the same currency');
    }

    // Signed in, so this is not an open proxy. No membership check: a rate is
    // not group data, and asking for one reveals nothing about any ledger.
    const userId = await deps.callerId(request);
    if (!userId) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in first');

    const today = new Date(now()).toISOString().slice(0, 10);
    // Optional day, for a bill dated in the past. Omitted means the latest.
    const date = url.searchParams.get('date') ?? '';
    if (date) {
      const real = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date));
      if (!real) throw new HttpError(400, 'BAD_DATE', 'Pass the date as YYYY-MM-DD');
      if (date > today) {
        throw new HttpError(400, 'BAD_DATE', 'There is no published rate for a future day');
      }
    }
    // The day a rate must be *for* to be cached: the asked-for one, or today.
    const wantDay = date || today;

    // 1. Memory. Before the limiter: a hit costs nothing and reaches nobody.
    const key = `${from}:${to}:${date}`;
    const hit = memory.get(key);
    if (hit && now() - hit.at < hit.ttl) return json(hit.body);

    const remember = (payload: FxBody, ttl: number): Response => {
      memory.set(key, { at: now(), ttl, body: payload });
      return json(payload);
    };

    // 2. Our daily cache.
    const store = deps.store();
    const cached = await quietly(() => store.get(from, to, wantDay), 'get');
    if (cached) return remember(body(from, to, cached), date ? DATED_TTL_MS : SHORT_TTL_MS);

    // 3. Upstream. Only the calls that leave the building are limited; the
    // memory cache is per-isolate, so this is what stops a script turning every
    // cold miss into an upstream request.
    await deps.rateLimit(request, userId);

    const result = await fetchFromChain(
      { from, to, date: date || null, today },
      { fetchFn: deps.fetchFn, breaker: deps.breaker ?? breakerDefault, timeoutMs: deps.timeoutMs },
    );
    if (result.ok) {
      const rate = result.rate;
      // Only a rate that is really the asked-for day's goes in the daily cache:
      // ECB answers a weekend with Friday's rate and an unpublished day with an
      // older one, and ExchangeRate-API only ever has today's. Caching those
      // under the asked-for day would pin a stand-in as that day's rate.
      const exact = rate.day === wantDay;
      if (exact) {
        await quietly(
          () =>
            store.put(from, to, {
              day: rate.day,
              num: rate.num,
              den: rate.den,
              source: rate.source,
            }),
          'put',
        );
      }
      return remember(body(from, to, rate), date && exact ? DATED_TTL_MS : SHORT_TTL_MS);
    }

    // 4. Every provider failed. The last rate we saw, plainly marked as old.
    // Never kept in memory: the next request should try upstream again.
    const fallback = result.unsupported
      ? null
      : await quietly(() => store.latest(from, to, wantDay), 'latest');
    if (fallback) {
      console.warn(JSON.stringify({ event: 'fx_stale', from, to, day: fallback.day }));
      return json({ ...body(from, to, fallback), stale: true, day: fallback.day } satisfies FxBody);
    }

    if (result.unsupported) {
      throw new HttpError(
        404,
        'RATE_UNAVAILABLE',
        `No published rate for ${from} to ${to} — you can type one instead`,
      );
    }
    console.warn(JSON.stringify({ event: 'fx_all_down', from, to, failures: result.failures }));
    throw new HttpError(
      502,
      'RATE_UNAVAILABLE',
      'Could not reach the exchange just now — you can type the rate instead',
    );
  } catch (error) {
    return errorResponse(error, { fn: 'fx-rate' });
  }
}

/** `fx_daily_rates` through the service client (the table is service-role only). */
export function supabaseFxStore(service: SupabaseClient): FxStore {
  const table = () => service.from('fx_daily_rates');
  const columns = 'day, num, den, source';
  const read = (data: unknown): CachedRate | null => {
    const row = data as { day?: string; num?: string; den?: string; source?: string } | null;
    if (!row?.day || !row.num || !row.den || !row.source) return null;
    return { day: String(row.day).slice(0, 10), num: row.num, den: row.den, source: row.source };
  };
  return {
    async get(from, to, day) {
      const { data, error } = await table()
        .select(columns)
        .eq('from_currency', from)
        .eq('to_currency', to)
        .eq('day', day)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return read(data);
    },
    async put(from, to, rate) {
      const { error } = await table().upsert(
        {
          from_currency: from,
          to_currency: to,
          day: rate.day,
          num: rate.num,
          den: rate.den,
          source: rate.source as FxSource,
        },
        // First write wins: a day's rate, once recorded, is that day's rate.
        { onConflict: 'from_currency,to_currency,day', ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
    },
    async latest(from, to, day) {
      const newest = (onOrBefore: boolean) => {
        let query = table().select(columns).eq('from_currency', from).eq('to_currency', to);
        if (onOrBefore) query = query.lte('day', day);
        return query.order('day', { ascending: false }).limit(1).maybeSingle();
      };
      const before = await newest(true);
      if (before.error) throw new Error(before.error.message);
      if (before.data) return read(before.data);
      const any = await newest(false);
      if (any.error) throw new Error(any.error.message);
      return read(any.data);
    },
  };
}
