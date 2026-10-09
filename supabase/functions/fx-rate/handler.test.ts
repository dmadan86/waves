/**
 * fx-rate's lookup order: memory, then the daily cache, then the providers,
 * then — only when every provider fails — the last cached rate, flagged stale.
 *
 * Pinned: a cache hit reaches no provider and spends no rate limit; a
 * provider's answer is cached only under the day it is really for (a weekend's
 * stand-in or ExchangeRate-API's "today" is never stored as a past day's
 * rate); all providers down falls back to the newest cached rate with
 * `stale: true` and its day, never silently; and a broken cache never fails
 * the request.
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
    latest: vi.fn(async (from, to, day) => {
      const mine = [...data.entries()]
        .filter(([key]) => key.startsWith(`${from}:${to}:`))
        .map(([, row]) => row)
        .sort((a, b) => (a.day < b.day ? 1 : -1));
      return mine.find((row) => row.day <= day) ?? mine[0] ?? null;
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

const get = (query: string) => new Request(`https://edge.test/fx-rate?${query}`);

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
  it('a daily-cache hit reaches no provider and spends no rate limit', async () => {
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
    expect(d.rateLimit).not.toHaveBeenCalled();
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
    expect(d.memory.get('EUR:INR:2026-10-04')?.ttl).toBe(15 * 60 * 1000);
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
    expect(d.memory.get('EUR:INR:2026-10-01')?.ttl).toBe(24 * 60 * 60 * 1000);
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
      latest: async () => {
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
