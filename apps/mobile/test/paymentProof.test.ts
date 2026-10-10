import { describe, expect, it } from 'vitest';

import {
  canAddProof,
  classifyProofAddFailure,
  clampPaidDay,
  fillReminder,
  formatPaidDay,
  localDay,
  MAX_PROOFS,
  paidDay,
  phoneDigits,
  ProofAddFailure,
  REMIND_COOLDOWN_MS,
  remindState,
  RemindUnit,
  reminderUrls,
} from '@/lib/paymentProof';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe('proof count limit', () => {
  it('allows up to five proofs', () => {
    expect(MAX_PROOFS).toBe(5);
    expect([0, 1, 4].map(canAddProof)).toEqual([true, true, true]);
    expect([5, 6].map(canAddProof)).toEqual([false, false]);
  });
});

describe('storage-full on adding a proof', () => {
  it('sends a free account that is out of storage to the upgrade prompt', () => {
    const full = new Error('You have reached your free storage limit');
    full.name = 'StorageCapError';
    expect(classifyProofAddFailure(full)).toBe(ProofAddFailure.StorageFull);
  });

  it('treats every other failure as an ordinary error', () => {
    expect(classifyProofAddFailure(new Error('PROOF_LIMIT: at most 5'))).toBe(
      ProofAddFailure.Other,
    );
    expect(classifyProofAddFailure('offline')).toBe(ProofAddFailure.Other);
    expect(classifyProofAddFailure(null)).toBe(ProofAddFailure.Other);
  });
});

describe('reminder cooldown', () => {
  it('is available when nobody has been reminded', () => {
    expect(remindState(null, NOW)).toEqual({ available: true, ago: null });
    expect(remindState(undefined, NOW)).toEqual({ available: true, ago: null });
    expect(remindState('not a date', NOW)).toEqual({ available: true, ago: null });
  });

  it('counts minutes, then hours, then days since the last reminder', () => {
    expect(remindState(ago(5 * MIN), NOW).ago).toEqual({ unit: RemindUnit.Minutes, n: 5 });
    expect(remindState(ago(2 * HOUR + 10 * MIN), NOW).ago).toEqual({
      unit: RemindUnit.Hours,
      n: 2,
    });
    expect(remindState(ago(49 * HOUR), NOW).ago).toEqual({ unit: RemindUnit.Days, n: 2 });
  });

  it('says 1 minute, never 0, for a reminder just sent', () => {
    expect(remindState(ago(5_000), NOW).ago).toEqual({ unit: RemindUnit.Minutes, n: 1 });
  });

  it('holds Remind back for 24 hours and releases it exactly then', () => {
    expect(REMIND_COOLDOWN_MS).toBe(24 * HOUR);
    expect(remindState(ago(2 * HOUR), NOW).available).toBe(false);
    expect(remindState(ago(24 * HOUR - 1), NOW).available).toBe(false);
    expect(remindState(ago(24 * HOUR), NOW).available).toBe(true);
    expect(remindState(ago(30 * HOUR), NOW).available).toBe(true);
  });

  it('reads a timestamp from the future (clock skew) as just now, not as available', () => {
    const future = new Date(NOW + 5 * MIN).toISOString();
    expect(remindState(future, NOW)).toEqual({
      available: false,
      ago: { unit: RemindUnit.Minutes, n: 1 },
    });
  });
});

describe('paid date', () => {
  it('formats a local day with zero padding', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    expect(localDay(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31');
  });

  it('prefers the stored paid_at', () => {
    expect(paidDay({ paid_at: '2026-10-08', initiated_at: '2026-10-10T08:00:00Z' })).toBe(
      '2026-10-08',
    );
  });

  it('falls back to the day it was recorded for rows without one', () => {
    const initiated = new Date(2026, 9, 9, 15, 30).toISOString();
    expect(paidDay({ paid_at: null, initiated_at: initiated })).toBe('2026-10-09');
    expect(paidDay({ initiated_at: initiated })).toBe('2026-10-09');
    expect(paidDay({ paid_at: 'garbage', initiated_at: initiated })).toBe('2026-10-09');
  });

  it('is empty rather than wrong when nothing parses', () => {
    expect(paidDay({ paid_at: null, initiated_at: 'nope' })).toBe('');
  });

  it('never lets a picked day run past today', () => {
    const today = new Date(2026, 9, 10, 9, 0);
    expect(clampPaidDay('2026-10-08', today)).toBe('2026-10-08');
    expect(clampPaidDay('2026-10-10', today)).toBe('2026-10-10');
    expect(clampPaidDay('2026-10-11', today)).toBe('2026-10-10');
    expect(clampPaidDay('bad', today)).toBe('2026-10-10');
  });

  it('formats short within the year and with the year outside it', () => {
    const now = new Date(2026, 9, 10);
    expect(formatPaidDay('2026-10-08', 'en-IN', now)).toMatch(/8/);
    expect(formatPaidDay('2026-10-08', 'en-IN', now)).not.toMatch(/2026/);
    expect(formatPaidDay('2025-03-02', 'en-IN', now)).toMatch(/2025/);
    expect(formatPaidDay('', 'en-IN', now)).toBe('');
    expect(formatPaidDay('2026-13-45', 'en-IN', now)).toBe('');
  });
});

describe('the message to someone not on Waves', () => {
  it('fills every placeholder, more than once', () => {
    expect(
      fillReminder('Hi {name}, {amount} for {group} on {date}. {name}?', {
        name: 'Renny',
        amount: '₹26,328.00',
        group: 'Goa',
        date: '8 Oct',
      }),
    ).toBe('Hi Renny, ₹26,328.00 for Goa on 8 Oct. Renny?');
  });

  it('strips a phone to digits and builds the WhatsApp doors in order', () => {
    expect(phoneDigits('+91 98765-43210')).toBe('919876543210');
    expect(phoneDigits(null)).toBe('');
    const urls = reminderUrls('+91 98765 43210', 'hi & bye');
    expect(urls).toEqual([
      'whatsapp://send?phone=919876543210&text=hi%20%26%20bye',
      'https://wa.me/919876543210?text=hi%20%26%20bye',
    ]);
  });

  it('has no WhatsApp door without a phone, so the caller shares instead', () => {
    expect(reminderUrls(null, 'x')).toEqual([]);
    expect(reminderUrls('', 'x')).toEqual([]);
  });
});
