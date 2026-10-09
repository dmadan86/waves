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
 *      anything that may still change or be bettered);
 *   2. `fx_daily_rates`, our own daily cache, shared by every isolate (after
 *      the rate limiter: only a memory hit is free);
 *   3. the provider chain, in rank order ECB > currency-api > ExchangeRate-API
 *      (providers.ts);
 *   4. if every provider fails, the cached rate nearest the asked-for day,
 *      flagged `stale: true` with its `day`. The app never applies one of
 *      those without asking.
 *
 * What goes in the daily cache, which is first-write-wins: only a rate that
 * really is the asked-for day's (for "latest": today's), and only from the
 * best source that publishes the pair —
 *
 *   * ECB's, always;
 *   * currency-api's only when the ECB answered that it does not publish the
 *     pair. When the ECB was merely down (or skipped by its breaker), the
 *     fallback is kept in memory for 15 minutes and never written, so a blip
 *     cannot pin a lower-ranked source as that day's rate for everyone;
 *   * ExchangeRate-API's never: it is latest-only, so it is not any dated
 *     day's rate. Memory only. (The table's CHECK refuses it too.)
 *
 * Older builds (no `stale=1`) are never sent an ExchangeRate-API rate: they do
 * not show its required credit, and for a past day they would put today's rate
 * on the bill as that day's. They get ECB or currency-api, or the old 502.
 *
 * It is behind auth so it cannot be used as an open currency proxy.
 */

import { HttpError, errorResponse, json, type SupabaseClient } from '../_shared/auth.ts';
import { CircuitBreaker } from '../_shared/resilience.ts';
import { fetchFromChain, type FxSource, type ProviderRate } from './providers.ts';

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
  /**
   * The row nearest `day`: the newest on or before it, else the oldest after
   * it. Never a newer row while an older one exists, so "Rate from {date}" is
   * the closest true thing to the bill's day.
   */
  nearest(from: string, to: string, day: string): Promise<CachedRate | null>;
}

/** How far from the bill's day a cached rate beats ExchangeRate-API's today. */
export const NEAR_DAYS = 7;

export interface FxRateDeps {
  /** The caller's profile id from their session, or null. */
  callerId: (request: Request) => Promise<string | null>;
  /** Throws (429) when the caller is going too fast. */
  rateLimit: (request: Request, userId: string) => Promise<void>;
  /** Built on first use; a throw here is a cache miss, like any store failure. */
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

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
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
    // Whether this client can be offered a rate from another day (`stale`): it
    // shows it as such, applies it only when the person says so, and credits
    // ExchangeRate-API. Older builds do none of that.
    const offersStale = url.searchParams.get('stale') === '1';
    // The day a rate must be *for* to be cached: the asked-for one, or today.
    const wantDay = date || today;

    // 1. Memory. Before the limiter: a hit costs nothing and reaches nobody.
    // Keyed by whether the client takes stale answers, so an older build is
    // never handed a body only a newer one knows how to show.
    const key = `${from}:${to}:${date}${offersStale ? ':s' : ''}`;
    const hit = memory.get(key);
    if (hit && now() - hit.at < hit.ttl) return json(hit.body);

    const remember = (payload: FxBody, ttl: number): Response => {
      memory.set(key, { at: now(), ttl, body: payload });
      return json(payload);
    };
    const staleBody = (rate: CachedRate): FxBody => ({
      ...body(from, to, rate),
      stale: true,
      day: rate.day,
    });

    // Built lazily and inside `quietly`: a store that cannot even be built is
    // a cache miss, not a 500.
    let built: FxStore | undefined;
    const withStore = <T>(label: string, work: (store: FxStore) => Promise<T>) =>
      quietly(() => work((built ??= deps.store())), label);

    // 2. The limiter, then our daily cache. Everything past memory is limited:
    // the memory cache is per-isolate, so this is what stops a script turning
    // every cold miss into a database read or an upstream request.
    await deps.rateLimit(request, userId);

    const cached = await withStore('get', (store) => store.get(from, to, wantDay));
    if (cached) return remember(body(from, to, cached), date ? DATED_TTL_MS : SHORT_TTL_MS);

    // 3. Upstream, in rank order.
    const result = await fetchFromChain(
      { from, to, date: date || null, today },
      { fetchFn: deps.fetchFn, breaker: deps.breaker ?? breakerDefault, timeoutMs: deps.timeoutMs },
    );
    // An older build never gets ExchangeRate-API: it would show it uncredited,
    // and for a past day as that day's rate. It gets what it always got.
    const usable = result.ok && (offersStale || result.rate.source !== 'exchangerate-api');
    if (result.ok && usable) {
      const rate: ProviderRate = result.rate;
      if (rate.stale) {
        // ExchangeRate-API's today, for a past bill. A cached rate from the
        // bill's own week is closer to the truth; either way it is offered
        // as a rate from another day, never applied as the bill's.
        const near = await withStore('nearest', (store) => store.nearest(from, to, wantDay));
        if (near && daysApart(near.day, wantDay) <= NEAR_DAYS) return json(staleBody(near));
        return remember(staleBody(rate), SHORT_TTL_MS);
      }
      // Only a rate that is really the asked-for day's goes in the daily
      // cache (ECB answers a weekend with Friday's rate), and only from the
      // best source that publishes the pair: currency-api only when the ECB
      // said it does not publish it, never when the ECB was merely down.
      const exact = rate.day === wantDay;
      const ecbSays = result.failures.find((failure) => failure.source === 'ecb')?.reason;
      const best =
        rate.source === 'ecb' || (rate.source === 'currency-api' && ecbSays === 'unsupported');
      const keep = exact && best;
      if (keep) {
        await withStore('put', (store) =>
          store.put(from, to, {
            day: rate.day,
            num: rate.num,
            den: rate.den,
            source: rate.source,
          }),
        );
      }
      return remember(body(from, to, rate), date && keep ? DATED_TTL_MS : SHORT_TTL_MS);
    }

    // 4. Every provider failed. The nearest rate we have, plainly marked as
    // from another day — but only to a client that asked (`stale=1`) and so
    // knows to ask the person first. An older build would put it on the bill
    // as if fresh. Never kept in memory: the next request tries upstream again.
    const unsupported = !result.ok && result.unsupported;
    const fallback =
      unsupported || !offersStale
        ? null
        : await withStore('nearest', (store) => store.nearest(from, to, wantDay));
    if (fallback) {
      console.warn(JSON.stringify({ event: 'fx_stale', from, to, day: fallback.day }));
      return json(staleBody(fallback));
    }

    if (unsupported) {
      throw new HttpError(
        404,
        'RATE_UNAVAILABLE',
        `No published rate for ${from} to ${to} — you can type one instead`,
      );
    }
    // `withheld`: only ExchangeRate-API had it, and this build cannot show it.
    console.warn(
      JSON.stringify({
        event: 'fx_all_down',
        from,
        to,
        withheld: result.ok,
        failures: result.failures,
      }),
    );
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
      // Never ExchangeRate-API: latest-only, so it is no dated day's rate.
      if (rate.source === 'exchangerate-api') return;
      const { error } = await table().upsert(
        {
          from_currency: from,
          to_currency: to,
          day: rate.day,
          num: rate.num,
          den: rate.den,
          source: rate.source as FxSource,
        },
        // First write wins: the handler writes only the best source that
        // publishes the pair, so a day's rate, once recorded, is that day's.
        { onConflict: 'from_currency,to_currency,day', ignoreDuplicates: true },
      );
      if (error) throw new Error(error.message);
    },
    async nearest(from, to, day) {
      const pair = () => table().select(columns).eq('from_currency', from).eq('to_currency', to);
      const before = await pair()
        .lte('day', day)
        .order('day', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (before.error) throw new Error(before.error.message);
      if (before.data) return read(before.data);
      const after = await pair()
        .gt('day', day)
        .order('day', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (after.error) throw new Error(after.error.message);
      return read(after.data);
    },
  };
}
