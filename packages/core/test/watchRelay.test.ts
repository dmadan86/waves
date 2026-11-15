import { describe, expect, it } from 'vitest';

import {
  coerceRecentCount,
  DEFAULT_RECENT_COUNT,
  encodePhoneToWatch,
  parseWatchToPhone,
  WATCH_RELAY_VERSION,
} from '../src/watch/relay';

describe('coerceRecentCount', () => {
  it('accepts the offered sizes and defaults everything else', () => {
    expect(coerceRecentCount(3)).toBe(3);
    expect(coerceRecentCount(5)).toBe(5);
    expect(coerceRecentCount(10)).toBe(10);
    expect(coerceRecentCount(7)).toBe(DEFAULT_RECENT_COUNT);
    expect(coerceRecentCount('5')).toBe(5);
    expect(coerceRecentCount(undefined)).toBe(DEFAULT_RECENT_COUNT);
    expect(coerceRecentCount(null)).toBe(DEFAULT_RECENT_COUNT);
  });
});

describe('parseWatchToPhone', () => {
  it('accepts a well-formed quickAdd', () => {
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'w1',
        amountMinor: '1200',
        currency: 'INR',
        note: 'Lunch',
      }),
    ).toEqual({ t: 'quickAdd', id: 'w1', amountMinor: '1200', currency: 'INR', note: 'Lunch' });
  });

  it('rejects a quickAdd with a non-integer, zero, negative, or empty-currency amount', () => {
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'w1',
        amountMinor: '12.5',
        currency: 'INR',
        note: '',
      }),
    ).toBeNull();
    expect(
      parseWatchToPhone({ t: 'quickAdd', id: 'w1', amountMinor: '0', currency: 'INR', note: '' }),
    ).toBeNull();
    // Leading-zero zero: BigInt('00') is 0n, so this must be rejected too.
    expect(
      parseWatchToPhone({ t: 'quickAdd', id: 'w1', amountMinor: '00', currency: 'INR', note: '' }),
    ).toBeNull();
    expect(
      parseWatchToPhone({ t: 'quickAdd', id: 'w1', amountMinor: '-5', currency: 'INR', note: '' }),
    ).toBeNull();
    expect(
      parseWatchToPhone({ t: 'quickAdd', id: 'w1', amountMinor: '100', currency: '', note: '' }),
    ).toBeNull();
  });

  it('accepts a versionless (v1) message and rejects an explicit version mismatch', () => {
    expect(
      parseWatchToPhone({ t: 'requestRecent', count: 5, version: WATCH_RELAY_VERSION }),
    ).not.toBeNull();
    expect(parseWatchToPhone({ t: 'requestRecent', count: 5, version: 999 })).toBeNull();
    // No version field at all = a v1 watch, still accepted.
    expect(parseWatchToPhone({ t: 'requestRecent', count: 5 })).not.toBeNull();
  });

  it('accepts an empty note (money is enough for a capture)', () => {
    expect(
      parseWatchToPhone({ t: 'quickAdd', id: 'w1', amountMinor: '100', currency: 'INR', note: '' }),
    ).not.toBeNull();
  });

  it('accepts a non-empty voiceAdd and rejects a blank one', () => {
    expect(parseWatchToPhone({ t: 'voiceAdd', id: 'w1', transcript: 'add 500 to goa' })).toEqual({
      t: 'voiceAdd',
      id: 'w1',
      transcript: 'add 500 to goa',
    });
    expect(parseWatchToPhone({ t: 'voiceAdd', id: 'w1', transcript: '   ' })).toBeNull();
  });

  it('rejects a quickAdd or voiceAdd with no idempotency id', () => {
    expect(
      parseWatchToPhone({ t: 'quickAdd', amountMinor: '100', currency: 'INR', note: '' }),
    ).toBeNull();
    expect(parseWatchToPhone({ t: 'voiceAdd', transcript: 'add 500' })).toBeNull();
  });

  it('clamps requestRecent count to an offered size', () => {
    expect(parseWatchToPhone({ t: 'requestRecent', count: 99 })).toEqual({
      t: 'requestRecent',
      count: DEFAULT_RECENT_COUNT,
    });
    expect(parseWatchToPhone({ t: 'requestRecent', count: 10 })).toEqual({
      t: 'requestRecent',
      count: 10,
    });
  });

  it('requires both ids on a notifAction', () => {
    expect(parseWatchToPhone({ t: 'notifAction', actionId: 'remind', objectId: 'x' })).toEqual({
      t: 'notifAction',
      actionId: 'remind',
      objectId: 'x',
    });
    expect(parseWatchToPhone({ t: 'notifAction', actionId: 'remind', objectId: '' })).toBeNull();
  });

  it('rejects unknown types and non-objects', () => {
    expect(parseWatchToPhone({ t: 'nope' })).toBeNull();
    expect(parseWatchToPhone(null)).toBeNull();
    expect(parseWatchToPhone('quickAdd')).toBeNull();
    expect(parseWatchToPhone(42)).toBeNull();
  });
});

describe('encodePhoneToWatch', () => {
  it('stamps the relay version onto every outbound message', () => {
    expect(encodePhoneToWatch({ t: 'settings', recentCount: 5, currency: 'INR' })).toEqual({
      version: WATCH_RELAY_VERSION,
      t: 'settings',
      recentCount: 5,
      currency: 'INR',
    });
    expect(encodePhoneToWatch({ t: 'ack', ok: true })).toEqual({
      version: WATCH_RELAY_VERSION,
      t: 'ack',
      ok: true,
    });
  });
});

describe('parseWatchToPhone input-length and format guards', () => {
  // -- id (all message types) ------------------------------------------------
  it('rejects a quickAdd whose id exceeds 64 chars', () => {
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'a'.repeat(65),
        amountMinor: '100',
        currency: 'INR',
        note: '',
      }),
    ).toBeNull();
  });

  it('accepts a quickAdd whose id is exactly 64 chars', () => {
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'a'.repeat(64),
        amountMinor: '100',
        currency: 'INR',
        note: '',
      }),
    ).not.toBeNull();
  });

  it('rejects a voiceAdd whose id exceeds 64 chars', () => {
    expect(
      parseWatchToPhone({ t: 'voiceAdd', id: 'a'.repeat(65), transcript: 'hello' }),
    ).toBeNull();
  });

  it('rejects a voiceClip whose id exceeds 64 chars', () => {
    expect(parseWatchToPhone({ t: 'voiceClip', id: 'a'.repeat(65), durationMs: 1000 })).toBeNull();
  });

  // -- quickAdd.amountMinor max 12 digits ------------------------------------
  it('rejects a quickAdd with an amountMinor longer than 12 digits', () => {
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'w1',
        amountMinor: '1'.repeat(13),
        currency: 'INR',
        note: '',
      }),
    ).toBeNull();
  });

  it('accepts a quickAdd with exactly 12 digits', () => {
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'w1',
        amountMinor: '1'.repeat(12),
        currency: 'INR',
        note: '',
      }),
    ).not.toBeNull();
  });

  // -- quickAdd.currency must match /^[A-Za-z]{3}$/ -------------------------
  it('rejects a quickAdd with a currency that is not exactly 3 ASCII letters', () => {
    // Too short
    expect(
      parseWatchToPhone({ t: 'quickAdd', id: 'w1', amountMinor: '100', currency: 'IN', note: '' }),
    ).toBeNull();
    // Too long
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'w1',
        amountMinor: '100',
        currency: 'INRX',
        note: '',
      }),
    ).toBeNull();
    // Contains digits
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'w1',
        amountMinor: '100',
        currency: 'IN3',
        note: '',
      }),
    ).toBeNull();
    // Empty string (previously accepted)
    expect(
      parseWatchToPhone({ t: 'quickAdd', id: 'w1', amountMinor: '100', currency: '', note: '' }),
    ).toBeNull();
  });

  it('accepts a quickAdd with a lowercase 3-letter currency', () => {
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'w1',
        amountMinor: '100',
        currency: 'usd',
        note: '',
      }),
    ).not.toBeNull();
  });

  // -- quickAdd.note max 500 chars -------------------------------------------
  it('rejects a quickAdd with a note longer than 500 chars', () => {
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'w1',
        amountMinor: '100',
        currency: 'INR',
        note: 'a'.repeat(501),
      }),
    ).toBeNull();
  });

  it('accepts a quickAdd with a note of exactly 500 chars', () => {
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'w1',
        amountMinor: '100',
        currency: 'INR',
        note: 'a'.repeat(500),
      }),
    ).not.toBeNull();
  });

  // -- voiceAdd.transcript max 2000 chars ------------------------------------
  it('rejects a voiceAdd with a transcript longer than 2000 chars', () => {
    expect(parseWatchToPhone({ t: 'voiceAdd', id: 'w1', transcript: 'a'.repeat(2001) })).toBeNull();
  });

  it('accepts a voiceAdd with a transcript of exactly 2000 chars', () => {
    expect(
      parseWatchToPhone({ t: 'voiceAdd', id: 'w1', transcript: 'a'.repeat(2000) }),
    ).not.toBeNull();
  });

  // -- notifAction ids max 128 chars -----------------------------------------
  it('rejects a notifAction with an actionId longer than 128 chars', () => {
    expect(
      parseWatchToPhone({
        t: 'notifAction',
        actionId: 'a'.repeat(129),
        objectId: 'x',
      }),
    ).toBeNull();
  });

  it('rejects a notifAction with an objectId longer than 128 chars', () => {
    expect(
      parseWatchToPhone({
        t: 'notifAction',
        actionId: 'remind',
        objectId: 'a'.repeat(129),
      }),
    ).toBeNull();
  });

  it('accepts a notifAction with ids at the 128-char limit', () => {
    expect(
      parseWatchToPhone({
        t: 'notifAction',
        actionId: 'a'.repeat(128),
        objectId: 'b'.repeat(128),
      }),
    ).not.toBeNull();
  });

  // -- Confirm existing well-formed fixtures still pass ----------------------
  it('existing well-formed quickAdd fixture still passes all new guards', () => {
    expect(
      parseWatchToPhone({
        t: 'quickAdd',
        id: 'intent-1',
        amountMinor: '25000',
        currency: 'INR',
        note: 'Chai',
      }),
    ).not.toBeNull();
  });

  it('existing well-formed voiceAdd fixture still passes all new guards', () => {
    expect(
      parseWatchToPhone({ t: 'voiceAdd', id: 'intent-2', transcript: '500 rupees tea' }),
    ).not.toBeNull();
  });
});

describe('parseWatchToPhone voiceClip', () => {
  it('accepts the clip metadata the watch attaches to a file transfer', () => {
    expect(parseWatchToPhone({ t: 'voiceClip', id: 'c1', durationMs: 4200, version: 1 })).toEqual({
      t: 'voiceClip',
      id: 'c1',
      durationMs: 4200,
    });
  });

  it('takes a Double or numeric-string duration and caps it at 30 s', () => {
    expect(parseWatchToPhone({ t: 'voiceClip', id: 'c1', durationMs: 1500.4 })).toMatchObject({
      durationMs: 1500,
    });
    expect(parseWatchToPhone({ t: 'voiceClip', id: 'c1', durationMs: '900' })).toMatchObject({
      durationMs: 900,
    });
    expect(parseWatchToPhone({ t: 'voiceClip', id: 'c1', durationMs: 90_000 })).toMatchObject({
      durationMs: 30_000,
    });
  });

  it('rejects a clip with no id or no usable duration', () => {
    expect(parseWatchToPhone({ t: 'voiceClip', durationMs: 1000 })).toBeNull();
    expect(parseWatchToPhone({ t: 'voiceClip', id: 'c1' })).toBeNull();
    expect(parseWatchToPhone({ t: 'voiceClip', id: 'c1', durationMs: 0 })).toBeNull();
    expect(parseWatchToPhone({ t: 'voiceClip', id: 'c1', durationMs: -5 })).toBeNull();
  });
});
