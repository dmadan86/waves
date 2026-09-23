/**
 * A ticked bank message dressed as the capture the group planner reads — and
 * the message body never goes with it.
 */

import { describe, expect, it } from 'vitest';

import { SmsKind } from '@waves/core';

import type { StoredSms } from '@/lib/smsMessageTypes';
import { smsRowAsCapture, splitPlaceable } from '@/lib/smsPlacement';

function row(over: Partial<StoredSms> = {}): StoredSms {
  return {
    dedupeKey: 'ref-1',
    body: 'Rs 450.00 debited from a/c XX1234 at SWIGGY on 10-03-26',
    sender: 'AX-HDFCBK',
    kind: SmsKind.Expense,
    reason: null,
    merchant: 'SWIGGY',
    accountTail: '1234',
    currency: 'INR',
    amount: '45000',
    occurredOn: '2026-03-10',
    at: '2026-03-10T09:00:00.000Z',
    confidence: 0.9,
    dateInferred: false,
    settledAs: null,
    captureId: null,
    readAt: '2026-03-10T10:00:00.000Z',
    ...over,
  };
}

describe('smsRowAsCapture', () => {
  it('carries the facts of the message and never the message itself', () => {
    const capture = smsRowAsCapture(row(), 'alice', 'cap-1');

    expect(capture).toMatchObject({
      id: 'cap-1',
      owner_user_id: 'alice',
      description: 'SWIGGY',
      expense_date: '2026-03-10',
      currency: 'INR',
      amount: '45000',
      raw_text: null,
      status: 'open',
      created_at: '2026-03-10T10:00:00.000Z',
      parsed: {
        source: 'sms',
        channel: 'inbox',
        sender: 'AX-HDFCBK',
        dedupeKey: 'ref-1',
        confidence: 0.9,
        accountTail: '1234',
        dateInferred: false,
      },
    });
    expect(capture.category).not.toBeNull();
    expect(JSON.stringify(capture)).not.toContain('debited');
  });

  it('refuses a phone number as a name, leaving the description and category blank', () => {
    const capture = smsRowAsCapture(row({ merchant: '9215676766' }), 'alice', 'cap-2');

    expect(capture.description).toBe('');
    expect(capture.category).toBeNull();
  });
});

describe('splitPlaceable', () => {
  it('keeps positive whole minor-unit amounts and reports the rest instead of dropping them', () => {
    const good = row({ dedupeKey: 'good', amount: ' 45000 ' });
    const zero = row({ dedupeKey: 'zero', amount: '0' });
    const fraction = row({ dedupeKey: 'fraction', amount: '450.00' });
    const junk = row({ dedupeKey: 'junk', amount: 'abc' });

    const { placeable, unusable } = splitPlaceable([good, zero, fraction, junk]);

    expect(placeable.map((r) => r.dedupeKey)).toEqual(['good']);
    expect(unusable.map((r) => r.dedupeKey)).toEqual(['zero', 'fraction', 'junk']);
  });
});
