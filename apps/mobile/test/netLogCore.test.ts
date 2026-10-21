/**
 * The network log's pure core: what a URL is reduced to before it is kept, which
 * purpose a connection is filed under, how the list is capped, and that the
 * fetch wrapper hands back exactly what the real fetch did.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  appendEntry,
  CALL_KEYS,
  callLabel,
  callName,
  countSync,
  dayId,
  EMPTY_SYNC_STATS,
  NET_FILTER_PURPOSES,
  parseSyncStats,
  pruneSyncStats,
  syncTotal,
  displayAddress,
  isLocalHost,
  NET_LOG_MAX_AGE_MS,
  NET_LOG_MAX_ENTRIES,
  parseStoredLog,
  purposeFor,
  redactUrl,
  toEntry,
  trimLog,
  UNREADABLE_URL,
  wrapFetch,
  type NetLogEntry,
  type RawCall,
} from '../src/lib/netLogCore';

vi.mock('expo-localization', () => ({ getLocales: () => [{ languageCode: 'en' }] }));

const { STRINGS_BY_LANGUAGE } = await import('../src/i18n');

const UUID = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';

describe('redactUrl', () => {
  it('keeps scheme, host and path, and drops the query string and fragment', () => {
    expect(redactUrl('https://abc.supabase.co/rest/v1/expenses?select=*&token=secret#frag')).toBe(
      'https://abc.supabase.co/rest/v1/expenses',
    );
  });

  it('removes userinfo', () => {
    expect(redactUrl('https://user:pass@example.com/a/b')).toBe('https://example.com/a/b');
    expect(redactUrl('https://me@example.com@evil.test/x')).toBe('https://evil.test/x');
  });

  it('masks UUIDs and long digit runs but leaves short numbers', () => {
    expect(redactUrl(`https://x.test/storage/v1/object/receipts/${UUID}/1.jpg`)).toBe(
      'https://x.test/storage/v1/object/receipts/…/1.jpg',
    );
    expect(redactUrl('https://x.test/users/1234567/items/12345')).toBe(
      'https://x.test/users/…/items/12345',
    );
    expect(redactUrl('https://x.test/rest/v1/rpc/thing')).toBe('https://x.test/rest/v1/rpc/thing');
  });

  it('never lets a phone number through, however it is written', () => {
    for (const phone of [
      '919876543210',
      '%2B919876543210',
      '+919876543210',
      '98765-43210',
      '98765%2043210',
      '(987) 654-3210',
    ]) {
      const out = redactUrl(`https://x.test/lookup/${phone}`);
      expect(out).not.toMatch(/\d{4}/);
      expect(out).toContain('…');
    }
  });

  it('lowercases the scheme and host and keeps a port', () => {
    expect(redactUrl('HTTPS://API.Example.COM:8443/V1/Ping')).toBe(
      'https://api.example.com:8443/V1/Ping',
    );
  });

  it('gives a bare host a root path', () => {
    expect(redactUrl('https://example.com?x=1')).toBe('https://example.com/');
  });

  it('falls back safely, without echoing the input, when it cannot be read', () => {
    for (const bad of [
      '',
      'not a url',
      '/relative/path?token=abc',
      'data:text/plain,secret',
      'https://',
    ]) {
      expect(redactUrl(bad)).toBe(UNREADABLE_URL);
    }
    expect(redactUrl(undefined as unknown as string)).toBe(UNREADABLE_URL);
  });

  it('cuts an absurdly long path', () => {
    expect(redactUrl(`https://x.test/${'a'.repeat(5000)}`).length).toBeLessThan(260);
  });

  it('shows host and path without the scheme', () => {
    expect(displayAddress('https://x.test/a')).toBe('x.test/a');
  });
});

describe('purposeFor', () => {
  const cases: [string, string, string][] = [
    ['abc.supabase.co', '/rest/v1/expenses', 'sync'],
    ['abc.supabase.co', '/rest/v1/rpc/get_balances', 'sync'],
    ['abc.supabase.co', '/rest/v1/rpc/waves_track_event', 'analytics'],
    ['abc.supabase.co', '/auth/v1/token', 'sign-in'],
    ['abc.supabase.co', '/auth/v1/otp', 'sign-in'],
    ['abc.supabase.co', '/storage/v1/object/x', 'files'],
    ['abc.supabase.co', '/functions/v1/fx-rate', 'exchange-rates'],
    ['abc.supabase.co', '/functions/v1/r2-sign', 'files'],
    ['abc.supabase.co', '/functions/v1/sync', 'sync'],
    ['abc.supabase.co', '/functions/v1/phone-verify', 'sign-in'],
    ['abc.supabase.co', '/functions/v1/receipt-parse', 'server-task'],
    ['abc.supabase.co', '/functions/v1/parse-statement', 'server-task'],
    ['abc.supabase.co', '/functions/v1/anything-new', 'server-task'],
    ['db.example.com', '/rest/v1/groups', 'sync'],
    ['api.revenuecat.com', '/v1/subscribers/…', 'purchases'],
    ['o123.ingest.sentry.io', '/api/1/envelope/', 'crash-reports'],
    ['sentry.io', '/api/1/store/', 'crash-reports'],
    ['www.clarity.ms', '/collect', 'session-replay'],
    ['identitytoolkit.googleapis.com', '/v1/accounts:sendVerificationCode', 'google'],
    ['firebaseappcheck.googleapis.com', '/v1/projects', 'google'],
    ['www.googleapis.com', '/drive/v3/files', 'google'],
    ['tile.openstreetmap.org', '/15/1/2.png', 'maps'],
    ['maps.googleapis.com', '/maps/api/staticmap', 'maps'],
    ['acct.r2.cloudflarestorage.com', '/bucket/…/a.jpg', 'files'],
    ['itunes.apple.com', '/lookup', 'other'],
    ['example.com', '/anything', 'other'],
  ];
  it.each(cases)('%s%s -> %s', (host, path, purpose) => {
    expect(purposeFor(host, path)).toBe(purpose);
  });

  it('does not file a lookalike host under a known service', () => {
    expect(purposeFor('evilsentry.io', '/x')).toBe('other');
    expect(purposeFor('notgoogleapis.com', '/x')).toBe('other');
    expect(purposeFor('o1.ingest.sentry.io', '/api/1/envelope/')).toBe('crash-reports');
    expect(purposeFor('firebaseinstallations.googleapis.com', '/v1/x')).toBe('google');
  });

  it('ignores a port, and recognises a configured map provider', () => {
    expect(purposeFor('abc.supabase.co:443', '/rest/v1/x')).toBe('sync');
    expect(purposeFor('tiles.example.com', '/1/2/3.png')).toBe('other');
    expect(purposeFor('tiles.example.com', '/1/2/3.png', { mapHosts: ['Tiles.Example.com'] })).toBe(
      'maps',
    );
  });
});

const entry = (t: number, extra: Partial<NetLogEntry> = {}): NetLogEntry => ({
  t,
  m: 'GET',
  u: 'https://x.test/a',
  s: 200,
  d: 10,
  p: 'other',
  ...extra,
});

describe('log cap', () => {
  const now = 1_000_000_000_000;

  it('keeps only the newest 1000 entries', () => {
    let list: NetLogEntry[] = [];
    for (let i = 0; i < NET_LOG_MAX_ENTRIES + 25; i++)
      list = appendEntry(list, entry(now - 1000 + i), now);
    expect(list).toHaveLength(NET_LOG_MAX_ENTRIES);
    expect(list[0].t).toBe(now - 1000 + 25);
    expect(list.at(-1)?.t).toBe(now - 1000 + NET_LOG_MAX_ENTRIES + 24);
  });

  it('drops entries older than 7 days, keeping the boundary', () => {
    const list = trimLog(
      [entry(now - NET_LOG_MAX_AGE_MS - 1), entry(now - NET_LOG_MAX_AGE_MS), entry(now)],
      now,
    );
    expect(list.map((e) => e.t)).toEqual([now - NET_LOG_MAX_AGE_MS, now]);
  });

  it('does not mutate its input', () => {
    const input = [entry(now - NET_LOG_MAX_AGE_MS - 5)];
    trimLog(input, now);
    expect(input).toHaveLength(1);
  });

  it('reads a stored list back, dropping anything malformed', () => {
    const good = entry(now, { s: 'offline' });
    const raw = JSON.stringify([
      good,
      { t: 'x' },
      null,
      { ...good, p: 'bogus' },
      { ...good, s: 'weird' },
    ]);
    expect(parseStoredLog(raw)).toEqual([good]);
    expect(parseStoredLog('{nope')).toEqual([]);
    expect(parseStoredLog(null)).toEqual([]);
    expect(parseStoredLog('{"a":1}')).toEqual([]);
  });
});

describe('toEntry', () => {
  const call: RawCall = {
    method: 'post',
    url: `https://abc.supabase.co/rest/v1/rpc/waves_track_event?apikey=k#x`,
    startedAt: 5,
    durationMs: 12.6,
    status: 204,
  };

  it('builds a redacted entry with the purpose', () => {
    expect(toEntry(call)).toEqual({
      t: 5,
      m: 'POST',
      u: 'https://abc.supabase.co/rest/v1/rpc/waves_track_event',
      s: 204,
      d: 13,
      p: 'analytics',
    });
  });

  it('records a thrown call as failed, or offline when the phone was', () => {
    expect(toEntry({ ...call, status: null })?.s).toBe('failed');
    expect(toEntry({ ...call, status: null }, { offline: true })?.s).toBe('offline');
  });

  it('skips unreadable addresses, and local dev servers only when asked', () => {
    expect(toEntry({ ...call, url: 'nonsense' })).toBeNull();
    const dev = { ...call, url: 'http://192.168.1.5:8081/index.bundle?platform=ios' };
    expect(toEntry(dev, { skipLocal: true })).toBeNull();
    expect(toEntry(dev)?.u).toBe('http://192.168.1.5:8081/index.bundle');
  });

  it('knows local hosts', () => {
    for (const h of [
      'localhost:8081',
      '127.0.0.1',
      '10.0.0.4:8081',
      '192.168.0.9',
      '172.20.1.1',
      'mac.local',
    ]) {
      expect(isLocalHost(h)).toBe(true);
    }
    for (const h of ['example.com', '11.0.0.1', '172.32.0.1', '192.169.0.1']) {
      expect(isLocalHost(h)).toBe(false);
    }
  });
});

describe('wrapFetch', () => {
  it('returns the very same response promise and reports status, method and address only', async () => {
    const response = { status: 201, ok: true, body: 'secret-body' };
    const original = vi.fn(() => Promise.resolve(response));
    const report = vi.fn();
    const wrapped = wrapFetch(original as never, report, () => 100);

    const promise = (wrapped as (...a: unknown[]) => Promise<unknown>)('https://x.test/a?q=1', {
      method: 'post',
      headers: { Authorization: 'Bearer secret' },
      body: 'payload',
    });
    expect(await promise).toBe(response);
    expect(original).toHaveBeenCalledWith('https://x.test/a?q=1', expect.anything());
    await Promise.resolve();
    expect(report).toHaveBeenCalledTimes(1);
    const reported = report.mock.calls[0][0];
    expect(reported).toEqual({
      method: 'POST',
      url: 'https://x.test/a?q=1',
      startedAt: 100,
      durationMs: 0,
      status: 201,
    });
    expect(JSON.stringify(reported)).not.toMatch(/secret|payload/);
  });

  it('passes an error through unchanged and reports it as a failed call', async () => {
    const error = new TypeError('Network request failed');
    const original = vi.fn(() => Promise.reject(error));
    const report = vi.fn();
    const wrapped = wrapFetch(original as never, report) as (...a: unknown[]) => Promise<unknown>;
    await expect(wrapped('https://x.test/a')).rejects.toBe(error);
    await Promise.resolve();
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ status: null, method: 'GET' }));
  });

  it('rethrows a synchronous throw as it was', () => {
    const error = new Error('boom');
    const wrapped = wrapFetch(
      (() => {
        throw error;
      }) as never,
      vi.fn(),
    ) as (...a: unknown[]) => Promise<unknown>;
    expect(() => wrapped('https://x.test')).toThrow(error);
  });

  it('is unaffected by a reporter that throws, and reads a Request-like input', async () => {
    const response = { status: 200 };
    const original = vi.fn(() => Promise.resolve(response));
    const report = vi.fn(() => {
      throw new Error('reporter broke');
    });
    const wrapped = wrapFetch(original as never, report) as (...a: unknown[]) => Promise<unknown>;
    await expect(wrapped({ url: 'https://x.test/r', method: 'put' })).resolves.toBe(response);
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PUT', url: 'https://x.test/r' }),
    );
  });

  it('does not wait for the report: the caller settles first', async () => {
    const order: string[] = [];
    const wrapped = wrapFetch((() => Promise.resolve({ status: 200 })) as never, () =>
      order.push('report'),
    ) as (...a: unknown[]) => Promise<unknown>;
    await wrapped('https://x.test/').then(() => order.push('caller'));
    expect(order).toContain('caller');
  });
});

describe('call names', () => {
  const entry = (host: string, path: string, p: NetLogEntry['p']) => ({
    u: `https://${host}${path}`,
    p,
  });
  const en = STRINGS_BY_LANGUAGE.en.netlog.calls;
  const cases: [string, string, NetLogEntry['p'], string][] = [
    ['abc.supabase.co', '/functions/v1/fx-rate', 'exchange-rates', 'Exchange rate'],
    ['abc.supabase.co', '/functions/v1/parse-statement', 'server-task', 'Read a statement'],
    ['abc.supabase.co', '/functions/v1/receipt-parse', 'server-task', 'Read a receipt'],
    ['abc.supabase.co', '/functions/v1/voice-stream-token', 'server-task', 'Voice'],
    ['abc.supabase.co', '/functions/v1/r2-sign', 'files', 'Upload a file'],
    ['abc.supabase.co', '/functions/v1/phone-verify', 'sign-in', 'Sign in'],
    ['abc.supabase.co', '/auth/v1/token', 'sign-in', 'Sign in'],
    ['abc.supabase.co', '/storage/v1/object/x', 'files', 'Upload a file'],
    ['abc.supabase.co', '/functions/v1/brand-new', 'server-task', 'Waves server'],
    ['abc.supabase.co', '/rest/v1/rpc/waves_track_event', 'analytics', 'Usage event'],
    ['api.revenuecat.com', '/v1/subscribers/…', 'purchases', 'Purchases'],
    ['o1.ingest.sentry.io', '/api/1/envelope/', 'crash-reports', 'Crash report'],
    ['tile.openstreetmap.org', '/15/1/2.png', 'maps', 'Map tiles'],
    ['itunes.apple.com', '/lookup', 'other', 'Check for update'],
  ];
  it.each(cases)('%s%s is named', (host, path, p, label) => {
    expect(callLabel(entry(host, path, p), en)).toBe(label);
  });

  it('shows only the host for an unknown address', () => {
    expect(callName({ u: 'https://api.example.com:8443/v2/things', p: 'other' })).toEqual({
      host: 'api.example.com',
    });
    expect(callLabel(entry('api.example.com', '/v2/things', 'other'), en)).toBe('api.example.com');
  });

  it('has a non-empty name for every call in every language, with no URL or method', () => {
    for (const strings of Object.values(STRINGS_BY_LANGUAGE)) {
      for (const key of CALL_KEYS) {
        const label = strings.netlog.calls[key];
        expect(label.trim().length).toBeGreaterThan(0);
        expect(label).not.toMatch(/https?:|\/|\b(GET|POST|PUT|DELETE)\b/);
      }
    }
  });

  it('never renders a path, scheme or method for any case', () => {
    for (const [host, path, p] of cases) {
      expect(callLabel(entry(host, path, p), en)).not.toMatch(/\/|:|POST|GET/);
    }
  });

  it('keeps sync out of the filter chips', () => {
    expect(NET_FILTER_PURPOSES).not.toContain('sync');
    expect(NET_FILTER_PURPOSES).toContain('sign-in');
  });
});

describe('sync counting', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = new Date(2026, 9, 21, 12).getTime();

  it('counts per day and sums them', () => {
    let stats = EMPTY_SYNC_STATS;
    stats = countSync(stats, now - 1000, now);
    stats = countSync(stats, now, now);
    stats = countSync(stats, now - DAY, now);
    expect(stats.days[dayId(now)]).toBe(2);
    expect(syncTotal(stats, now)).toBe(3);
    expect(stats.last).toBe(now);
  });

  it('does not mutate its input', () => {
    const stats = countSync(EMPTY_SYNC_STATS, now, now);
    countSync(stats, now, now);
    expect(stats.days[dayId(now)]).toBe(1);
  });

  it('prunes to 7 days, keeping the boundary day', () => {
    const stats = {
      days: { [dayId(now - 8 * DAY)]: 5, [dayId(now - 7 * DAY)]: 3, [dayId(now)]: 1 },
      last: now,
    };
    const kept = pruneSyncStats(stats, now);
    expect(Object.keys(kept.days).sort()).toEqual([dayId(now - 7 * DAY), dayId(now)].sort());
    expect(syncTotal(stats, now)).toBe(4);
  });

  it('prunes while counting', () => {
    const old = { days: { [dayId(now - 30 * DAY)]: 9 }, last: 0 };
    expect(syncTotal(countSync(old, now, now), now)).toBe(1);
  });

  it('reads stored counts back, dropping anything malformed', () => {
    expect(parseSyncStats(null)).toEqual(EMPTY_SYNC_STATS);
    expect(parseSyncStats('nope')).toEqual(EMPTY_SYNC_STATS);
    const raw = JSON.stringify({ days: { '2026-10-21': 4, bad: 2, '2026-10-20': 'x' }, last: 7 });
    expect(parseSyncStats(raw)).toEqual({ days: { '2026-10-21': 4 }, last: 7 });
  });

  it('files sync calls under the sync purpose, so they are counted not listed', () => {
    const call = (url: string): RawCall => ({
      method: 'POST',
      url,
      startedAt: 1,
      durationMs: 1,
      status: 200,
    });
    expect(toEntry(call('https://a.supabase.co/functions/v1/sync'))?.p).toBe('sync');
    expect(toEntry(call('https://a.supabase.co/rest/v1/groups'))?.p).toBe('sync');
  });
});

describe('Network activity screen', () => {
  const source = readFileSync(
    new URL('../src/app/settings/network-activity.tsx', import.meta.url),
    'utf8',
  );
  it('draws rows from the standard ListRow, with no address or method', () => {
    expect(source).toContain("from '@/components/standard'");
    expect(source).not.toMatch(/displayAddress|entry\.m\b|entry\.u\b|\{entry\.m\}/);
  });
  it('shows one sync summary and no Sync filter', () => {
    expect(source).toContain('syncSummary');
    expect(source).toContain('NET_FILTER_PURPOSES');
  });
});
