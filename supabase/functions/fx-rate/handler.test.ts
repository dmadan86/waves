/**
 * fx-rate's lookup order: memory, then the daily cache, then the providers,
 * then — only when every provider fails — the last cached rate, flagged stale.
 *
 * Pinned: a memory hit spends no rate limit, and the limiter runs before the
 * daily cache is read; a provider's answer is cached only under the day it is
 * really for and only from the best source that publishes the pair (an ECB
 * blip never pins currency-api; ExchangeRate-API is never written); a
 * latest-only rate for a past bill is flagged stale with today's day; all
 * providers down falls back to the nearest cached rate with `stale: true` and
 * its day, never silently; older builds never get ExchangeRate-API; and a
 * broken (or unbuildable) cache never fails the request.
 */

import { describe, expect, it, vi } from 'vitest';

import { CircuitBreaker } from '../_shared/resilience.ts';
import { handleFxRate, type CachedRate, type FxRateDeps, type FxStore } from './handler.ts';

const NOW = Date.parse('2026-10-09T10:00:00Z');

function memoryStore(rows: Record<string, CachedRate> = {}) {
  const data = new Map(Object.entries(rows));
  const store: FxStore & { data: Map<string, CachedRate> } = {
    data,
    get: vi.fn(async (from, to, day) => data.get(`${from}:${to}:${day}`) ?? null),
    put: vi.fn(async (from, to, rate) => {
      data.set(`${from}:${to}:${rate.day}`, rate);
    }),
    nearest: vi.fn(async (from, to, day) => {
      const mine = [...data.entries()]
        .filter(([key]) => key.startsWith(`${from}:${to}:`))
        .map(([, row]) => row)
        .sort((a, b) => (a.day < b.day ? -1 : 1));
      // Newest on or before the day, else the oldest after it.
      return (
        mine.filter((row) => row.day <= day).at(-1) ?? mine.find((row) => row.day > day) ?? null
      );
    }),
  };
  return store;
}

function fetchBy(routes: Record<string, unknown | 'throw'>) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    for (const [prefix, answer] of Object.entries(routes)) {
      if (!url.startsWith(prefix)) continue;
      if (answer === 'throw') throw new TypeError('connection refused');
      if (answer instanceof Response) return answer.clone();
      return new Response(JSON.stringify(answer), { status: 200 });
    }
    throw new TypeError(`no route for ${url}`);
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const allDown = () => fetchBy({ 'https://': 'throw' });

function deps(over: Partial<FxRateDeps> & { store?: () => FxStore } = {}) {
  const rateLimit = vi.fn(async () => undefined);
  return {
    callerId: async () => 'user-1',
    rateLimit,
    store: () => memoryStore(),
    fetchFn: allDown(),
    now: () => NOW,
    memory: new Map(),
    // A fresh breaker per test: one test's outage must not skip a provider in the next.
    breaker: new CircuitBreaker(),
    timeoutMs: 50,
    ...over,
  } satisfies FxRateDeps;
}

// Every request opts in to a stale fallback, as the current app does; the one
// test that does not says so.
const get = (query: string) => new Request(`https://edge.test/fx-rate?${query}&stale=1`);

async function call(query: string, d: FxRateDeps) {
  const response = await handleFxRate(get(query), d);
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('validation', () => {
  it('refuses a bad pair, the same currency, a bad or future date, and no session', async () => {
    expect((await call('from=EU&to=INR', deps())).status).toBe(400);
    expect((await call('from=INR&to=INR', deps())).status).toBe(400);
    expect((await call('from=EUR&to=INR&date=2026-13-40', deps())).status).toBe(400);
    expect((await call('from=EUR&to=INR&date=2026-10-10', deps())).status).toBe(400);
    expect((await call('from=EUR&to=INR', deps({ callerId: async () => null }))).status).toBe(401);
  });
});

describe('lookup order', () => {
  it('a daily-cache hit reaches no provider, but is rate limited like any memory miss', async () => {
    const store = memoryStore({
      'VND:INR:2026-09-20': {
        day: '2026-09-20',
        num: '33647',
        den: '10000000',
        source: 'currency-api',
      },
    });
    const d = deps({ store: () => store });
    const { status, body } = await call('from=VND&to=INR&date=2026-09-20', d);
    expect(status).toBe(200);
    expect(body).toEqual({
      num: '33647',
      den: '10000000',
      from: 'VND',
      to: 'INR',
      ts: '2026-09-20T00:00:00.000Z',
      source: 'currency-api',
    });
    expect(d.fetchFn).not.toHaveBeenCalled();
    expect(d.rateLimit).toHaveBeenCalledTimes(1);
  });

  it('the limiter runs before the daily cache is read', async () => {
    const store = memoryStore();
    const d = deps({
      store: () => store,
      rateLimit: vi.fn(async () => {
        throw Object.assign(new Error('slow down'), { status: 429 });
      }),
    });
    await handleFxRate(get('from=EUR&to=INR'), d);
    expect(store.get).not.toHaveBeenCalled();
  });

  it('a memory hit spends no rate limit', async () => {
    const d = deps({
      fetchFn: fetchBy({
        'https://api.frankfurter.dev/': { date: '2026-10-09', rates: { INR: 98.12 } },
      }),
    });
    await call('from=EUR&to=INR', d);
    await call('from=EUR&to=INR', d);
    expect(d.rateLimit).toHaveBeenCalledTimes(1);
  });

  it('"latest" is looked up and cached under today', async () => {
    const store = memoryStore();
    const d = deps({
      store: () => store,
      fetchFn: fetchBy({
        'https://api.frankfurter.dev/': new Response('{}', { status: 404 }),
        'https://cdn.jsdelivr.net/': { date: '2026-10-09', aed: { inr: 24.1983 } },
      }),
    });
    const { body } = await call('from=AED&to=INR', d);
    expect(body).toMatchObject({ source: 'currency-api', ts: '2026-10-09T00:00:00.000Z' });
    expect(store.get).toHaveBeenCalledWith('AED', 'INR', '2026-10-09');
    expect(store.data.get('AED:INR:2026-10-09')).toEqual({
      day: '2026-10-09',
      num: '241983',
      den: '10000',
      source: 'currency-api',
    });
    expect(d.rateLimit).toHaveBeenCalledTimes(1);
  });

  it('a provider answer is kept in memory, so the next ask reaches nobody', async () => {
    const d = deps({
      fetchFn: fetchBy({
        'https://api.frankfurter.dev/': { date: '2026-10-09', rates: { INR: 98.12 } },
      }),
    });
    await call('from=EUR&to=INR', d);
    await call('from=EUR&to=INR', d);
    expect(d.fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('date mismatch is never cached under the asked-for day', () => {
  it('ECB answering a Sunday with Friday’s rate is returned, not stored', async () => {
    const store = memoryStore();
    const d = deps({
      store: () => store,
      fetchFn: fetchBy({
        'https://api.frankfurter.dev/': { date: '2026-10-02', rates: { INR: 98.12 } },
      }),
    });
    const { body } = await call('from=EUR&to=INR&date=2026-10-04', d);
    expect(body).toMatchObject({ source: 'ecb', ts: '2026-10-02T00:00:00.000Z' });
    expect(store.put).not.toHaveBeenCalled();
    // And only briefly in memory: 15 minutes later it is asked for again.
    expect(d.memory.get('EUR:INR:2026-10-04:s')?.ttl).toBe(15 * 60 * 1000);
  });

  it('ExchangeRate-API for a past day is dated today and not stored under that day', async () => {
    const store = memoryStore();
    const d = deps({
      store: () => store,
      fetchFn: fetchBy({
        'https://api.frankfurter.dev/': new Response('{}', { status: 404 }),
        'https://cdn.jsdelivr.net/': new Response('{}', { status: 404 }),
        'https://open.er-api.com/': { result: 'success', rates: { INR: 24.2 } },
        'https://2026-09-20.currency-api.pages.dev/': new Response('{}', { status: 404 }),
      }),
    });
    const { body } = await call('from=AED&to=INR&date=2026-09-20', d);
    expect(body).toMatchObject({ source: 'exchangerate-api', ts: '2026-10-09T00:00:00.000Z' });
    expect(store.put).not.toHaveBeenCalled();
  });

  it('a dated rate that is that day’s own is stored and kept a day in memory', async () => {
    const store = memoryStore();
    const d = deps({
      store: () => store,
      fetchFn: fetchBy({
        'https://api.frankfurter.dev/': { date: '2026-10-01', rates: { INR: 98.12 } },
      }),
    });
    await call('from=EUR&to=INR&date=2026-10-01', d);
    expect(store.put).toHaveBeenCalledWith('EUR', 'INR', {
      day: '2026-10-01',
      num: '9812',
      den: '100',
      source: 'ecb',
    });
    expect(d.memory.get('EUR:INR:2026-10-01:s')?.ttl).toBe(24 * 60 * 60 * 1000);
  });
});

describe('every provider down', () => {
  it('falls back to the newest cached rate, flagged stale with its day', async () => {
    const store = memoryStore({
      'VND:INR:2026-10-05': {
        day: '2026-10-05',
        num: '33647',
        den: '10000000',
        source: 'currency-api',
      },
      'VND:INR:2026-09-01': {
        day: '2026-09-01',
        num: '33000',
        den: '10000000',
        source: 'currency-api',
      },
    });
    const d = deps({ store: () => store });
    const { status, body } = await call('from=VND&to=INR', d);
    expect(status).toBe(200);
    expect(body).toEqual({
      num: '33647',
      den: '10000000',
      from: 'VND',
      to: 'INR',
      ts: '2026-10-05T00:00:00.000Z',
      source: 'currency-api',
      stale: true,
      day: '2026-10-05',
    });
    // Not remembered: the next request tries the providers again.
    expect(d.memory.size).toBe(0);
  });

  it('for a past day, prefers the newest rate on or before it', async () => {
    const store = memoryStore({
      'VND:INR:2026-10-05': { day: '2026-10-05', num: '2', den: '1000', source: 'currency-api' },
      'VND:INR:2026-09-01': { day: '2026-09-01', num: '1', den: '1000', source: 'currency-api' },
    });
    const { body } = await call('from=VND&to=INR&date=2026-09-20', deps({ store: () => store }));
    expect(body).toMatchObject({ stale: true, day: '2026-09-01' });
  });

  it('offers no stale rate to a client that did not ask (an older build would apply it)', async () => {
    const store = memoryStore({
      'VND:INR:2026-10-05': {
        day: '2026-10-05',
        num: '33647',
        den: '10000000',
        source: 'currency-api',
      },
    });
    const response = await handleFxRate(
      new Request('https://edge.test/fx-rate?from=VND&to=INR'),
      deps({ store: () => store }),
    );
    expect(response.status).toBe(502);
  });

  it('with nothing cached, says the exchange could not be reached (502)', async () => {
    const { status, body } = await call('from=VND&to=INR', deps());
    expect(status).toBe(502);
    expect(body).toMatchObject({ code: 'RATE_UNAVAILABLE' });
  });

  it('a broken cache is a miss, never a failure', async () => {
    const broken: FxStore = {
      get: async () => {
        throw new Error('db down');
      },
      put: async () => {
        throw new Error('db down');
      },
      nearest: async () => {
        throw new Error('db down');
      },
    };
    const ok = deps({
      store: () => broken,
      fetchFn: fetchBy({
        'https://api.frankfurter.dev/': { date: '2026-10-09', rates: { INR: 98.12 } },
      }),
    });
    expect((await call('from=EUR&to=INR', ok)).status).toBe(200);
    expect((await call('from=EUR&to=INR', deps({ store: () => broken }))).status).toBe(502);
  });
});

it('a pair nobody publishes is a 404, not a stale rate', async () => {
  const store = memoryStore({
    'XAU:INR:2026-10-05': { day: '2026-10-05', num: '1', den: '1', source: 'currency-api' },
  });
  const d = deps({
    store: () => store,
    fetchFn: fetchBy({
      'https://api.frankfurter.dev/': new Response('{}', { status: 404 }),
      'https://cdn.jsdelivr.net/': { date: '2026-10-09', xau: {} },
      'https://open.er-api.com/': { result: 'error', 'error-type': 'unsupported-code' },
    }),
  });
  expect((await call('from=XAU&to=INR', d)).status).toBe(404);
});

describe('what the daily cache may hold (rank: ecb > currency-api > exchangerate-api)', () => {
  const vnd = { date: '2026-09-20', vnd: { inr: 0.0033647 } };

  it('currency-api is cached for the day when the ECB does not publish the pair', async () => {
    const store = memoryStore();
    const d = deps({
      store: () => store,
      fetchFn: fetchBy({
        'https://api.frankfurter.dev/': new Response('{}', { status: 404 }),
        'https://cdn.jsdelivr.net/': vnd,
      }),
    });
    const { body } = await call('from=VND&to=INR&date=2026-09-20', d);
    expect(body).toMatchObject({ source: 'currency-api', ts: '2026-09-20T00:00:00.000Z' });
    expect(store.put).toHaveBeenCalledTimes(1);
    expect(d.memory.get('VND:INR:2026-09-20:s')?.ttl).toBe(24 * 60 * 60 * 1000);
  });

  it('an ECB blip: the fallback is served, kept 15 minutes in memory, and never written', async () => {
    const store = memoryStore();
    const d = deps({
      store: () => store,
      fetchFn: fetchBy({
        'https://api.frankfurter.dev/': new Response('{}', { status: 503 }),
        'https://cdn.jsdelivr.net/': { date: '2026-09-20', eur: { inr: 98.1 } },
      }),
    });
    const { body } = await call('from=EUR&to=INR&date=2026-09-20', d);
    expect(body).toMatchObject({ source: 'currency-api', ts: '2026-09-20T00:00:00.000Z' });
    expect(store.put).not.toHaveBeenCalled();
    expect(d.memory.get('EUR:INR:2026-09-20:s')?.ttl).toBe(15 * 60 * 1000);
  });

  it('an ECB the breaker skipped counts as down, not as "does not publish"', async () => {
    const store = memoryStore();
    const breaker = new CircuitBreaker({ threshold: 1, cooldownMs: 60_000 });
    breaker.failure('fx:ecb');
    const d = deps({
      store: () => store,
      breaker,
      fetchFn: fetchBy({ 'https://cdn.jsdelivr.net/': { date: '2026-10-09', eur: { inr: 98.1 } } }),
    });
    await call('from=EUR&to=INR', d);
    expect(store.put).not.toHaveBeenCalled();
  });

  it('ExchangeRate-API for today is served (credited by the app) but never written', async () => {
    const store = memoryStore();
    const d = deps({
      store: () => store,
      fetchFn: fetchBy({
        'https://api.frankfurter.dev/': new Response('{}', { status: 404 }),
        'https://cdn.jsdelivr.net/': new Response('{}', { status: 404 }),
        'https://latest.currency-api.pages.dev/': new Response('{}', { status: 404 }),
        'https://open.er-api.com/': { result: 'success', rates: { INR: 24.2, AED: 0.0413 } },
      }),
    });
    const { body } = await call('from=AED&to=INR', d);
    expect(body).toMatchObject({ source: 'exchangerate-api', ts: '2026-10-09T00:00:00.000Z' });
    expect(body.stale).toBeUndefined();
    expect(store.put).not.toHaveBeenCalled();
    expect(d.memory.get('AED:INR::s')?.ttl).toBe(15 * 60 * 1000);
  });
});

describe('ExchangeRate-API for a past bill is a rate from another day', () => {
  const routes = {
    'https://api.frankfurter.dev/': new Response('{}', { status: 404 }),
    'https://cdn.jsdelivr.net/': new Response('{}', { status: 404 }),
    'https://2026-09-20.currency-api.pages.dev/': new Response('{}', { status: 404 }),
    'https://latest.currency-api.pages.dev/': new Response('{}', { status: 404 }),
    'https://open.er-api.com/': { result: 'success', rates: { INR: 24.2, AED: 0.0413 } },
  };

  it('is flagged stale with its own day (today), so the app asks first', async () => {
    const { status, body } = await call(
      'from=AED&to=INR&date=2026-09-20',
      deps({ fetchFn: fetchBy(routes) }),
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      source: 'exchangerate-api',
      stale: true,
      day: '2026-10-09',
      ts: '2026-10-09T00:00:00.000Z',
    });
  });

  it('a cached rate from the bill’s own week is preferred', async () => {
    const store = memoryStore({
      'AED:INR:2026-09-18': { day: '2026-09-18', num: '24', den: '1', source: 'currency-api' },
    });
    const { body } = await call(
      'from=AED&to=INR&date=2026-09-20',
      deps({ store: () => store, fetchFn: fetchBy(routes) }),
    );
    expect(body).toMatchObject({ source: 'currency-api', stale: true, day: '2026-09-18' });
  });

  it('a cached rate further away than a week is not', async () => {
    const store = memoryStore({
      'AED:INR:2026-08-01': { day: '2026-08-01', num: '24', den: '1', source: 'currency-api' },
    });
    const { body } = await call(
      'from=AED&to=INR&date=2026-09-20',
      deps({ store: () => store, fetchFn: fetchBy(routes) }),
    );
    expect(body).toMatchObject({ source: 'exchangerate-api', stale: true, day: '2026-10-09' });
  });

  it('an older build (no stale=1) is never sent ExchangeRate-API: the old 502', async () => {
    for (const query of ['from=AED&to=INR&date=2026-09-20', 'from=AED&to=INR']) {
      const response = await handleFxRate(
        new Request(`https://edge.test/fx-rate?${query}`),
        deps({ fetchFn: fetchBy(routes) }),
      );
      expect(response.status).toBe(502);
    }
  });

  it('an older build still gets ECB', async () => {
    const response = await handleFxRate(
      new Request('https://edge.test/fx-rate?from=EUR&to=INR'),
      deps({
        fetchFn: fetchBy({
          'https://api.frankfurter.dev/': { date: '2026-10-09', rates: { INR: 98.12 } },
        }),
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe('the nearest cached rate, never a newer one while an older exists', () => {
  it('serves a rate after the bill’s day only when none is on or before it', async () => {
    const store = memoryStore({
      'VND:INR:2026-10-05': { day: '2026-10-05', num: '2', den: '1000', source: 'currency-api' },
      'VND:INR:2026-10-01': { day: '2026-10-01', num: '1', den: '1000', source: 'currency-api' },
    });
    const { body } = await call('from=VND&to=INR&date=2026-09-20', deps({ store: () => store }));
    // Nothing on or before the 20th: the closest after it, with its own day.
    expect(body).toMatchObject({ stale: true, day: '2026-10-01' });
  });
});

describe('a store that cannot be built', () => {
  it('is a cache miss, not a 500', async () => {
    const d = deps({
      store: () => {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
      },
      fetchFn: fetchBy({
        'https://api.frankfurter.dev/': { date: '2026-10-09', rates: { INR: 98.12 } },
      }),
    });
    const { status, body } = await call('from=EUR&to=INR', d);
    expect(status).toBe(200);
    expect(body).toMatchObject({ source: 'ecb' });
    const down = { ...d, fetchFn: allDown(), memory: new Map() };
    expect((await call('from=EUR&to=INR', down)).status).toBe(502);
  });
});
