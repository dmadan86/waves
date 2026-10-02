/**
 * "Seen before" and "looks recurring" — a plain pass over whatever messages
 * are already on the device, with samples across the markets Waves ships in
 * first.
 */
import { describe, expect, it } from 'vitest';

import { SmsKind } from '@waves/core';

import { looksMonthly, seenBefore } from '@/lib/smsMerchantHistory';
import type { StoredSms } from '@/lib/smsMessageTypes';

let counter = 0;
function row(overrides: Partial<StoredSms> = {}): StoredSms {
  counter += 1;
  return {
    dedupeKey: `ref:${counter}`,
    body: 'a message',
    sender: null,
    kind: SmsKind.Expense,
    reason: null,
    merchant: 'SWIGGY',
    accountTail: null,
    currency: 'INR',
    amount: '25000',
    occurredOn: '2026-09-12',
    at: '2026-09-12T10:00:00.000Z',
    confidence: 0.95,
    dateInferred: false,
    settledAs: null,
    captureId: null,
    readAt: '2026-09-13T09:00:00.000Z',
    ...overrides,
  };
}

describe('seenBefore', () => {
  it('is null when nothing else has the same merchant', () => {
    const current = row({ merchant: 'SWIGGY' });
    expect(seenBefore([current], current)).toBeNull();
  });

  it('is null when the message carries no merchant at all', () => {
    const current = row({ merchant: null });
    const other = row({ merchant: null, occurredOn: '2026-08-12' });
    expect(seenBefore([other, current], current)).toBeNull();
  });

  it('counts earlier messages to the same merchant, case-insensitively, excluding itself', () => {
    const current = row({ merchant: 'Swiggy', occurredOn: '2026-09-12' });
    const earlier1 = row({ merchant: 'SWIGGY', occurredOn: '2026-08-12', amount: '50000' });
    const earlier2 = row({ merchant: 'swiggy', occurredOn: '2026-07-12', amount: '85000' });
    const unrelated = row({ merchant: 'ZOMATO', occurredOn: '2026-08-01' });
    const result = seenBefore([current, earlier1, earlier2, unrelated], current);
    expect(result).not.toBeNull();
    expect(result!.count).toBe(2);
    expect(result!.total).toBe(135000n);
    expect(result!.currency).toBe('INR');
  });

  it('totals only the earlier payments in the same currency as this one (AED sample)', () => {
    const current = row({
      merchant: 'CARREFOUR',
      currency: 'AED',
      amount: '35000',
      occurredOn: '2026-10-02',
    });
    const sameCurrency = row({
      merchant: 'CARREFOUR',
      currency: 'AED',
      amount: '20000',
      occurredOn: '2026-09-02',
    });
    const otherCurrency = row({
      merchant: 'CARREFOUR',
      currency: 'USD',
      amount: '9999',
      occurredOn: '2026-08-02',
    });
    const result = seenBefore([current, sameCurrency, otherCurrency], current);
    expect(result!.count).toBe(2);
    expect(result!.total).toBe(20000n);
    expect(result!.currency).toBe('AED');
  });

  it('says recurring when this payment and two earlier ones land about a month apart (UK, GBP)', () => {
    const current = row({ merchant: 'NETFLIX', currency: 'GBP', occurredOn: '2026-10-01' });
    const a = row({ merchant: 'NETFLIX', currency: 'GBP', occurredOn: '2026-09-01' });
    const b = row({ merchant: 'NETFLIX', currency: 'GBP', occurredOn: '2026-08-02' });
    const result = seenBefore([current, a, b], current);
    expect(result!.recurring).toBe(true);
  });

  it('does not call two payments in the same week recurring (US, USD)', () => {
    const current = row({ merchant: 'STARBUCKS', currency: 'USD', occurredOn: '2026-10-02' });
    const a = row({ merchant: 'STARBUCKS', currency: 'USD', occurredOn: '2026-09-28' });
    const result = seenBefore([current, a], current);
    // Only one earlier payment: not enough evidence either way.
    expect(result!.recurring).toBe(false);
  });

  it('is not fooled by three payments bunched in one week (AU, AUD)', () => {
    const current = row({ merchant: 'WOOLWORTHS', currency: 'AUD', occurredOn: '2026-10-02' });
    const a = row({ merchant: 'WOOLWORTHS', currency: 'AUD', occurredOn: '2026-09-29' });
    const b = row({ merchant: 'WOOLWORTHS', currency: 'AUD', occurredOn: '2026-09-26' });
    const result = seenBefore([current, a, b], current);
    expect(result!.recurring).toBe(false);
  });
});

describe('looksMonthly', () => {
  it('needs at least three dates', () => {
    expect(looksMonthly(['2026-08-01', '2026-09-01'])).toBe(false);
  });

  it('tolerates a bill that drifts around a weekend', () => {
    expect(looksMonthly(['2026-07-28', '2026-08-25', '2026-09-24'])).toBe(true);
  });

  it('rejects gaps outside the monthly window', () => {
    expect(looksMonthly(['2026-08-01', '2026-08-10', '2026-08-20'])).toBe(false);
  });
});
