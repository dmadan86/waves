/**
 * The recurring-service catalog and the detector that reads repetition out of a
 * ledger's own history. Both are pure, so what the "Me" tab will offer to set
 * up — and, more importantly, what it will refuse to offer — is pinned here
 * without a device, a clock or a single stored record.
 */

import { describe, expect, it } from 'vitest';

import { normaliseMerchantName } from '../src/category/merchant.js';
import {
  detectRecurring,
  matchService,
  serviceById,
  SERVICES,
  type RecurringCandidate,
  type RecurringEntry,
} from '../src/personal/index.js';

let seq = 0;
const entry = (over: Partial<RecurringEntry>): RecurringEntry => ({
  id: over.id ?? `e${(seq += 1)}`,
  merchant: over.merchant ?? null,
  amount: over.amount ?? 10000n,
  kind: over.kind ?? 'expense',
  date: over.date ?? '2026-08-15',
  currency: over.currency ?? 'INR',
});

/** The same charge on a run of dates — the shape almost every case here wants. */
const series = (
  merchant: string,
  dates: readonly string[],
  over: Partial<RecurringEntry> = {},
): RecurringEntry[] => dates.map((date) => entry({ ...over, merchant, date }));

const only = (candidates: readonly RecurringCandidate[]): RecurringCandidate => {
  expect(candidates).toHaveLength(1);
  return candidates[0]!;
};

describe('matchService', () => {
  it('prefers the more specific pattern', () => {
    // The whole reason matching is by pattern length: "airtel broadband"
    // matches `airtel` too, and the shorter answer is the wrong one.
    expect(matchService('AIRTEL BROADBAND BILL')?.id).toBe('airtel-broadband');
    expect(matchService('AIRTEL PREPAID RECHARGE')?.id).toBe('airtel');
    expect(matchService('JIOHOTSTAR')?.id).toBe('hotstar');
    expect(matchService('JIOFIBER')?.id).toBe('jiofiber');
    expect(matchService('JIO PREPAID')?.id).toBe('jio');
  });

  it('strips gateway noise before matching', () => {
    expect(matchService('POS UPI NETFLIX*ORDER 8842')?.id).toBe('netflix');
    expect(matchService('APPLE.COM/BILL')?.id).toBe('apple');
    expect(matchService('ACT FIBERNET PVT LTD')?.id).toBe('act-fibernet');
  });

  it('keeps short ids from matching inside longer words', () => {
    // "emi" is inside "premium"; "sip" is inside "gossip"; "lic" is inside
    // "police". Each of those is a real merchant string somebody has.
    expect(matchService('LIC PREMIUM DEBIT')?.id).toBe('insurance');
    expect(matchService('GOSSIP MAGAZINE')).toBeNull();
    expect(matchService('POLICE FINE')).toBeNull();
    expect(matchService('HDFC EMI DEBIT')?.id).toBe('loan-emi');
    expect(matchService('HDFC SIP FOLIO')?.id).toBe('sip');
  });

  it('has no opinion about an unknown merchant', () => {
    expect(matchService('BIG BAZAAR')).toBeNull();
    expect(matchService('')).toBeNull();
    expect(matchService('12345')).toBeNull();
  });

  it('keeps its ids unique and resolvable', () => {
    const ids = SERVICES.map((service) => service.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(serviceById('netflix')?.name).toBe('Netflix');
    expect(serviceById('gone')).toBeNull();
    expect(serviceById(null)).toBeNull();
  });

  it('carries only patterns that survive normalisation', () => {
    // A pattern holding a digit, punctuation or a gateway word ("payment",
    // "india", "ltd") is matched against strings those have been stripped out
    // of, so it can never fire — dead coverage that reads as live coverage.
    for (const service of SERVICES) {
      for (const pattern of service.patterns) {
        expect(normaliseMerchantName(pattern)).toBe(pattern);
      }
    }
  });
});

describe('detectRecurring', () => {
  it('finds a monthly subscription and names it from the catalog', () => {
    const found = only(
      detectRecurring(
        series('NETFLIX', ['2026-06-22', '2026-07-22', '2026-08-22'], { amount: 64900n }),
      ),
    );
    expect(found.name).toBe('Netflix');
    expect(found.serviceId).toBe('netflix');
    expect(found.kind).toBe('subscription');
    expect(found.cadence).toBe('monthly');
    expect(found.interval).toBe(1);
    expect(found.amount).toBe(64900n);
    expect(found.amountVaries).toBe(false);
    expect(found.confidence).toBe('high');
    expect(found.fromCatalogOnly).toBe(false);
    expect(found.lastDate).toBe('2026-08-22');
    expect(found.nextDate).toBe('2026-09-22');
    expect(found.evidence.map((row) => row.date)).toEqual([
      '2026-06-22',
      '2026-07-22',
      '2026-08-22',
    ]);
  });

  it('detects a bill whose amount is never the same twice', () => {
    const found = only(
      detectRecurring([
        entry({ merchant: 'TNEB', date: '2026-06-05', amount: 52000n }),
        entry({ merchant: 'TNEB', date: '2026-07-05', amount: 61000n }),
        entry({ merchant: 'TNEB', date: '2026-08-05', amount: 55000n }),
      ]),
    );
    expect(found.kind).toBe('bill');
    expect(found.amountVaries).toBe(true);
    // The median, not the mean: a number that was really charged.
    expect(found.amount).toBe(55000n);
    expect(found.confidence).toBe('high');
  });

  it('refuses a group whose amounts are not one payment', () => {
    expect(
      detectRecurring([
        entry({ merchant: 'SOME SHOP', date: '2026-06-01', amount: 10000n }),
        entry({ merchant: 'SOME SHOP', date: '2026-07-01', amount: 50000n }),
        entry({ merchant: 'SOME SHOP', date: '2026-08-01', amount: 12000n }),
      ]),
    ).toEqual([]);
  });

  it('turns a single catalogued charge into a low-confidence guess', () => {
    const found = only(
      detectRecurring([entry({ merchant: 'SPOTIFY INDIA', date: '2026-08-11', amount: 11900n })]),
    );
    expect(found.confidence).toBe('low');
    expect(found.fromCatalogOnly).toBe(true);
    expect(found.cadence).toBe('monthly');
    expect(found.evidence).toHaveLength(1);
    expect(found.nextDate).toBe('2026-09-11');
  });

  it('lets one gap stand when the catalog knows the merchant, and not otherwise', () => {
    const dates = ['2026-07-10', '2026-08-10'];
    const known = only(detectRecurring(series('SPOTIFY', dates)));
    expect(known.confidence).toBe('medium');
    expect(known.fromCatalogOnly).toBe(false);

    expect(detectRecurring(series('CORNER STORE', dates))).toEqual([]);
  });

  it('says nothing about one-off purchases', () => {
    expect(
      detectRecurring([
        entry({ merchant: 'BIG BAZAAR', date: '2026-06-03' }),
        entry({ merchant: 'PETROL PUMP', date: '2026-06-19' }),
        entry({ merchant: 'CORNER STORE', date: '2026-07-02' }),
        entry({ merchant: 'BOOK SHOP', date: '2026-08-14' }),
      ]),
    ).toEqual([]);
  });

  it('says nothing when the gaps agree on nothing', () => {
    expect(
      detectRecurring(series('CORNER STORE', ['2026-01-05', '2026-02-20', '2026-04-02'])),
    ).toEqual([]);
  });

  it('skips entries with no merchant to group by', () => {
    expect(
      detectRecurring([
        entry({ merchant: null, date: '2026-06-01' }),
        entry({ merchant: null, date: '2026-07-01' }),
        entry({ merchant: null, date: '2026-08-01' }),
        entry({ merchant: '  ', date: '2026-09-01' }),
      ]),
    ).toEqual([]);
  });

  it('reads a salary as income through the same path', () => {
    const found = only(
      detectRecurring(
        series('ACME CORP SALARY', ['2026-06-30', '2026-07-31', '2026-08-31'], {
          kind: 'income',
          amount: 8500000n,
        }),
      ),
    );
    expect(found.txnKind).toBe('income');
    expect(found.kind).toBe('income');
    expect(found.cadence).toBe('monthly');
    expect(found.confidence).toBe('high');
  });

  it('never calls a credit a subscription, whatever the merchant says', () => {
    const found = only(
      detectRecurring(
        series('NETFLIX', ['2026-06-22', '2026-07-22', '2026-08-22'], { kind: 'income' }),
      ),
    );
    expect(found.kind).toBe('income');
  });

  it('reads the other cadences off the gaps', () => {
    const cadenceOf = (dates: readonly string[]): [string, number] => {
      const found = only(detectRecurring(series('CORNER STORE', dates)));
      return [found.cadence, found.interval];
    };
    expect(cadenceOf(['2026-06-01', '2026-06-08', '2026-06-15'])).toEqual(['weekly', 1]);
    expect(cadenceOf(['2026-06-01', '2026-06-15', '2026-06-29'])).toEqual(['weekly', 2]);
    expect(cadenceOf(['2026-01-15', '2026-04-15', '2026-07-15'])).toEqual(['monthly', 3]);
    expect(cadenceOf(['2024-03-01', '2025-03-01', '2026-03-01'])).toEqual(['yearly', 1]);
  });

  it('keeps a one-off out of the evidence for the series it sits beside', () => {
    const found = only(
      detectRecurring([
        ...series('NETFLIX', ['2026-06-22', '2026-07-22', '2026-08-22'], { amount: 64900n }),
        // A gift card bought from the same merchant four days later.
        entry({ merchant: 'NETFLIX', date: '2026-08-26', amount: 200000n }),
      ]),
    );
    expect(found.evidence).toHaveLength(3);
    expect(found.lastDate).toBe('2026-08-22');
    expect(found.amountVaries).toBe(false);
  });

  it('separates the same merchant billed in two currencies', () => {
    const found = detectRecurring([
      ...series('SPOTIFY', ['2026-06-10', '2026-07-10', '2026-08-10'], { amount: 11900n }),
      ...series('SPOTIFY', ['2026-06-10', '2026-07-10', '2026-08-10'], {
        amount: 999n,
        currency: 'USD',
      }),
    ]);
    expect(found).toHaveLength(2);
    expect(found.map((row) => row.currency).sort()).toEqual(['INR', 'USD']);
  });

  it('drops a series that has stopped, and only when given a clock', () => {
    const cancelled = series('NETFLIX', ['2026-01-22', '2026-02-22', '2026-03-22']);
    expect(detectRecurring(cancelled)).toHaveLength(1);
    expect(detectRecurring(cancelled, { today: '2026-04-20' })).toHaveLength(1);
    expect(detectRecurring(cancelled, { today: '2026-09-21' })).toEqual([]);
  });

  it('orders confident candidates first, then by merchant, whatever the input order', () => {
    const entries = [
      ...series('NETFLIX', ['2026-06-22', '2026-07-22', '2026-08-22'], { amount: 64900n }),
      entry({ merchant: 'SPOTIFY', date: '2026-08-11', amount: 11900n }),
      ...series('TNEB', ['2026-06-05', '2026-07-05', '2026-08-05'], { amount: 52000n }),
    ];
    const expected = ['netflix', 'tneb', 'spotify'];
    expect(detectRecurring(entries).map((row) => row.merchant)).toEqual(expected);
    expect(detectRecurring([...entries].reverse()).map((row) => row.merchant)).toEqual(expected);
  });
});
