/**
 * The provider chain and the exact-fraction conversion behind fx-rate.
 *
 * Pinned: every provider's decimal becomes num/den with no float arithmetic and
 * nothing outside sane bounds gets through; ECB is asked first and a currency
 * it does not publish (VND, AED) falls to currency-api; jsDelivr being down
 * falls to its mirror (the two are raced); ExchangeRate-API is the last
 * resort, is dated today (flagged stale for a past day), asks both bases at
 * once, and a rounded small rate is replaced by the inverse of the precise
 * side; and the whole chain stays inside one overall budget.
 */

import { describe, expect, it } from 'vitest';

import { CircuitBreaker } from '../_shared/resilience.ts';
import {
  currencyApiUrls,
  fetchFromChain,
  parseCurrencyApi,
  parseFrankfurter,
  preciseOf,
  significantDigits,
  toRational,
  type ChainRequest,
} from './providers.ts';

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | 'throw';

/** A fetch that answers by URL prefix and records what was asked. */
function fakeFetch(routes: Record<string, Route | Response>) {
  const calls: string[] = [];
  const fn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    for (const [prefix, route] of Object.entries(routes)) {
      if (!url.startsWith(prefix)) continue;
      const answer = typeof route === 'function' ? await route(url, init) : route.clone();
      if (answer === 'throw') throw new TypeError('connection refused');
      return answer;
    }
    throw new TypeError(`no route for ${url}`);
  }) as typeof fetch;
  return { fn, calls };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const status = (code: number, body: unknown = { message: 'nope' }) =>
  new Response(JSON.stringify(body), { status: code });

const FRANKFURTER = 'https://api.frankfurter.dev/';
const JSDELIVR = 'https://cdn.jsdelivr.net/';
const MIRROR = 'https://'; // matched last; see the per-test ordering
const ERAPI = 'https://open.er-api.com/';

const vndInr: ChainRequest = { from: 'VND', to: 'INR', date: '2026-09-20', today: '2026-10-09' };

describe('toRational', () => {
  it('turns a decimal into an exact fraction', () => {
    expect(toRational(91.2534)).toEqual({ num: '912534', den: '10000' });
    expect(toRational(1)).toEqual({ num: '1', den: '1' });
    expect(toRational('0.0038241')).toEqual({ num: '38241', den: '10000000' });
  });

  it('reads the exponent form a small double prints as, exactly', () => {
    // String(3.82417e-7) is "3.82417e-7": the digits are kept, not rounded.
    expect(toRational(3.82417e-7)).toEqual({ num: '382417', den: '1000000000000' });
    expect(toRational('2.5E+3')).toEqual({ num: '2500', den: '1' });
  });

  it('refuses anything that is not a finite, positive, sane rate', () => {
    for (const bad of [0, -1, NaN, Infinity, '', 'abc', '1,5', null, undefined, {}, 1e-12, 1e12]) {
      expect(toRational(bad)).toBeNull();
    }
  });
});

describe('precision', () => {
  it('counts the digits a provider actually stated', () => {
    expect(significantDigits(0.00375)).toBe(3);
    expect(significantDigits(266.67)).toBe(5);
    expect(significantDigits(25000)).toBe(2);
  });

  it('inverts the reverse rate when it carries more digits', () => {
    // VND→INR 0.00375 (3 digits) vs INR→VND 266.6667 (7 digits).
    expect(preciseOf(0.00375, 266.6667)).toEqual({
      num: '10000',
      den: '2666667',
      inverted: true,
    });
  });

  it('keeps the forward rate when it is as precise, or the inverse disagrees', () => {
    expect(preciseOf(91.2534, 0.010958)).toEqual({ num: '912534', den: '10000', inverted: false });
    // 1/0.00375 is 266.67; 300 is a different snapshot, not a better one.
    expect(preciseOf(0.00375, 300.12345)).toMatchObject({ num: '375', inverted: false });
    expect(preciseOf(0.00375, undefined)).toMatchObject({ num: '375', inverted: false });
  });
});

describe('parsers', () => {
  it('Frankfurter: a currency the ECB does not publish is unsupported, not down', () => {
    expect(parseFrankfurter(404, { message: 'not found' }, 'VND')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(parseFrankfurter(200, { date: '2026-10-08', rates: {} }, 'VND')).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(parseFrankfurter(503, null, 'INR')).toEqual({ ok: false, reason: 'unavailable' });
    expect(parseFrankfurter(200, { date: '2026-10-08', rates: { INR: 98.12 } }, 'INR')).toEqual({
      ok: true,
      rate: { num: '9812', den: '100', day: '2026-10-08', source: 'ecb' },
    });
  });

  it('currency-api: lower-case keys, and the day is the response’s own', () => {
    const body = { date: '2026-09-20', vnd: { inr: 0.0033647, usd: 0.000038 } };
    expect(parseCurrencyApi(body, 'VND', 'INR')).toEqual({
      ok: true,
      rate: { num: '33647', den: '10000000', day: '2026-09-20', source: 'currency-api' },
    });
    expect(parseCurrencyApi(body, 'VND', 'XYZ')).toEqual({ ok: false, reason: 'unsupported' });
    expect(parseCurrencyApi({ vnd: { inr: 0.003 } }, 'VND', 'INR')).toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('currency-api URLs: jsDelivr then the Pages mirror, dated or latest', () => {
    expect(currencyApiUrls(vndInr)).toEqual([
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2026-09-20/v1/currencies/vnd.json',
      'https://2026-09-20.currency-api.pages.dev/v1/currencies/vnd.json',
    ]);
    expect(currencyApiUrls({ ...vndInr, date: null })[1]).toBe(
      'https://latest.currency-api.pages.dev/v1/currencies/vnd.json',
    );
  });
});

describe('the chain', () => {
  it('asks ECB first and stops there when it has the pair', async () => {
    const { fn, calls } = fakeFetch({
      [FRANKFURTER]: ok({ date: '2026-09-18', rates: { INR: 98.12 } }),
    });
    const result = await fetchFromChain(
      { from: 'EUR', to: 'INR', date: '2026-09-20', today: '2026-10-09' },
      { fetchFn: fn },
    );
    expect(result).toEqual({
      ok: true,
      rate: { num: '9812', den: '100', day: '2026-09-18', source: 'ecb' },
      failures: [],
    });
    expect(calls).toEqual(['https://api.frankfurter.dev/v1/2026-09-20?base=EUR&symbols=INR']);
  });

  it('ECB missing VND → currency-api', async () => {
    const { fn, calls } = fakeFetch({
      [FRANKFURTER]: status(404),
      [JSDELIVR]: ok({ date: '2026-09-20', vnd: { inr: 0.0033647 } }),
    });
    const result = await fetchFromChain(vndInr, { fetchFn: fn });
    expect(result).toEqual({
      ok: true,
      rate: { num: '33647', den: '10000000', day: '2026-09-20', source: 'currency-api' },
      // The handler reads this: "does not publish" lets currency-api be cached.
      failures: [{ source: 'ecb', reason: 'unsupported' }],
    });
    // ECB, then both currency-api hosts at once; the first usable answer wins.
    expect(calls).toHaveLength(3);
  });

  it('AED, a target market, comes from currency-api too', async () => {
    const { fn } = fakeFetch({
      [FRANKFURTER]: ok({ date: '2026-10-08', rates: {} }),
      [JSDELIVR]: ok({ date: '2026-10-09', aed: { inr: 24.1983 } }),
    });
    const result = await fetchFromChain(
      { from: 'AED', to: 'INR', date: null, today: '2026-10-09' },
      { fetchFn: fn },
    );
    expect(result).toMatchObject({ ok: true, rate: { source: 'currency-api', num: '241983' } });
  });

  it('jsDelivr down → the mirror', async () => {
    const { fn, calls } = fakeFetch({
      [FRANKFURTER]: status(404),
      [JSDELIVR]: () => 'throw',
      [ERAPI]: () => {
        throw new Error('should not reach ExchangeRate-API');
      },
      [MIRROR]: ok({ date: '2026-09-20', vnd: { inr: 0.0033647 } }),
    });
    const result = await fetchFromChain(vndInr, { fetchFn: fn });
    expect(result).toMatchObject({ ok: true, rate: { source: 'currency-api', day: '2026-09-20' } });
    expect(calls[2]).toBe('https://2026-09-20.currency-api.pages.dev/v1/currencies/vnd.json');
  });

  it('a slow provider is cut off at its deadline and the next one asked', async () => {
    const { fn } = fakeFetch({
      // Never answers; like a real fetch, it gives up when aborted.
      [FRANKFURTER]: (_url, init) =>
        new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
        ),
      [JSDELIVR]: ok({ date: '2026-10-09', eur: { inr: 98.1 } }),
    });
    const result = await fetchFromChain(
      { from: 'EUR', to: 'INR', date: null, today: '2026-10-09' },
      { fetchFn: fn, timeoutMs: 20 },
    );
    expect(result).toMatchObject({ ok: true, rate: { source: 'currency-api' } });
  });

  it('ExchangeRate-API last: dated today, stale for a past day, the precise side', async () => {
    const { fn, calls } = fakeFetch({
      [FRANKFURTER]: status(404),
      [JSDELIVR]: status(503),
      [ERAPI + 'v6/latest/VND']: ok({ result: 'success', rates: { INR: 0.00375 } }),
      [ERAPI + 'v6/latest/INR']: ok({ result: 'success', rates: { VND: 266.6667 } }),
      [MIRROR]: status(503),
    });
    const result = await fetchFromChain(vndInr, { fetchFn: fn });
    expect(result).toEqual({
      ok: true,
      rate: {
        num: '10000',
        den: '2666667',
        // Today, not the bill's day: it only knows the latest.
        day: '2026-10-09',
        source: 'exchangerate-api',
        stale: true,
      },
      failures: [
        { source: 'ecb', reason: 'unsupported' },
        { source: 'currency-api', reason: 'unavailable' },
      ],
    });
    // Forward and reverse asked together, not one after the other.
    expect(calls.slice(-2)).toEqual([
      'https://open.er-api.com/v6/latest/VND',
      'https://open.er-api.com/v6/latest/INR',
    ]);
  });

  it('ExchangeRate-API: a large forward rate is used as is; "latest" is not stale', async () => {
    const { fn, calls } = fakeFetch({
      [FRANKFURTER]: () => 'throw',
      [JSDELIVR]: () => 'throw',
      [ERAPI]: ok({ result: 'success', rates: { VND: 266.67 } }),
      [MIRROR]: () => 'throw',
    });
    const result = await fetchFromChain(
      { from: 'INR', to: 'VND', date: null, today: '2026-10-09' },
      { fetchFn: fn },
    );
    expect(result).toMatchObject({ ok: true, rate: { num: '26667', den: '100' } });
    expect(result.ok && result.rate.stale).toBeFalsy();
    expect(calls.filter((url) => url.startsWith(ERAPI))).toHaveLength(2);
  });

  it('all down → unavailable (not unsupported), with each provider named', async () => {
    const { fn } = fakeFetch({ 'https://': () => 'throw' });
    const result = await fetchFromChain(vndInr, { fetchFn: fn });
    expect(result).toEqual({
      ok: false,
      unsupported: false,
      failures: [
        { source: 'ecb', reason: 'unavailable' },
        { source: 'currency-api', reason: 'unavailable' },
        { source: 'exchangerate-api', reason: 'unavailable' },
      ],
    });
  });

  it('nobody has the pair → unsupported', async () => {
    const { fn } = fakeFetch({
      [FRANKFURTER]: status(404),
      [JSDELIVR]: ok({ date: '2026-09-20', vnd: {} }),
      [ERAPI]: ok({ result: 'error', 'error-type': 'unsupported-code' }),
    });
    const result = await fetchFromChain(vndInr, { fetchFn: fn });
    expect(result).toMatchObject({ ok: false, unsupported: true });
  });

  it('a rate out of bounds is refused, not stored', async () => {
    const { fn } = fakeFetch({
      [FRANKFURTER]: ok({ date: '2026-09-20', rates: { INR: 1e15 } }),
      [JSDELIVR]: ok({ date: '2026-09-20', eur: { inr: -3 } }),
      [ERAPI]: ok({ result: 'success', rates: { INR: 0 } }),
      [MIRROR]: ok({ date: '2026-09-20', eur: { inr: 'NaN' } }),
    });
    const result = await fetchFromChain(
      { from: 'EUR', to: 'INR', date: '2026-09-20', today: '2026-10-09' },
      { fetchFn: fn },
    );
    expect(result.ok).toBe(false);
  });

  it('skips a provider whose breaker is open', async () => {
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 60_000 });
    breaker.failure('fx:ecb');
    const { fn, calls } = fakeFetch({
      [JSDELIVR]: ok({ date: '2026-10-09', eur: { inr: 98.1 } }),
    });
    await fetchFromChain(
      { from: 'EUR', to: 'INR', date: null, today: '2026-10-09' },
      { fetchFn: fn, breaker },
    );
    expect(calls.some((url) => url.startsWith(FRANKFURTER))).toBe(false);
  });
});

describe('latency', () => {
  /** Never answers; like a real fetch, it gives up when aborted. */
  const hang: Route = (_url, init) =>
    new Promise<Response>((_, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))),
    );
  const after =
    (ms: number, response: Response): Route =>
    () =>
      new Promise((resolve) => setTimeout(() => resolve(response.clone()), ms));

  it('the whole chain is capped by its budget, not the sum of every timeout', async () => {
    const { fn, calls } = fakeFetch({ 'https://': hang });
    const started = Date.now();
    const result = await fetchFromChain(vndInr, { fetchFn: fn, timeoutMs: 80, budgetMs: 100 });
    const took = Date.now() - started;
    expect(result).toMatchObject({ ok: false, unsupported: false });
    // ECB spends 80 of the 100, currency-api the last 20; ExchangeRate-API
    // is never reached (3 × 80 would be 240).
    expect(took).toBeLessThan(200);
    expect(calls.some((url) => url.startsWith(ERAPI))).toBe(false);
  });

  it('the two currency-api hosts are raced: a fast mirror beats a slow jsDelivr', async () => {
    const { fn } = fakeFetch({
      [FRANKFURTER]: status(404),
      [JSDELIVR]: hang,
      [MIRROR]: ok({ date: '2026-09-20', vnd: { inr: 0.0033647 } }),
    });
    const started = Date.now();
    const result = await fetchFromChain(vndInr, { fetchFn: fn, timeoutMs: 1000 });
    expect(result).toMatchObject({ ok: true, rate: { source: 'currency-api' } });
    expect(Date.now() - started).toBeLessThan(500);
  });

  it('ExchangeRate-API’s forward and reverse calls run in parallel', async () => {
    const { fn } = fakeFetch({
      [FRANKFURTER]: status(404),
      [JSDELIVR]: status(503),
      [ERAPI + 'v6/latest/VND']: after(150, ok({ result: 'success', rates: { INR: 0.00375 } })),
      [ERAPI + 'v6/latest/INR']: after(150, ok({ result: 'success', rates: { VND: 266.6667 } })),
      [MIRROR]: status(503),
    });
    const started = Date.now();
    const result = await fetchFromChain(vndInr, { fetchFn: fn, timeoutMs: 1000 });
    expect(result).toMatchObject({ ok: true, rate: { num: '10000', den: '2666667' } });
    // In sequence it would be 300ms or more.
    expect(Date.now() - started).toBeLessThan(280);
  });
});
