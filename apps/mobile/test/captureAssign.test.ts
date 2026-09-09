import { describe, expect, it } from 'vitest';

import { CaptureStatus, type CaptureRow } from '../src/data/types';
import {
  assignCaptureHref,
  capturePaymentMethod,
  matchesAssignGroupQuery,
} from '../src/lib/captureAssign';

function capture(overrides: Partial<CaptureRow> = {}): CaptureRow {
  const base: CaptureRow = {
    id: 'capture-1',
    owner_user_id: 'user-1',
    description: 'taxi to airport',
    amount: '125000',
    currency: 'INR',
    expense_date: '2026-09-08',
    category: 'travel',
    category_meta: null,
    payment_method: null,
    target_group_id: null,
    location: { name: 'Terminal 2', lat: 19.0896, lng: 72.8656 },
    status: CaptureStatus.Open,
    assigned_expense_id: null,
    assigned_group_id: null,
    created_at: '2026-09-08T08:00:00Z',
    pending: false,
    notes: null,
    photo_path: null,
    raw_text: null,
    parsed: null,
  };
  return { ...base, ...overrides };
}

describe('assignCaptureHref', () => {
  it('carries the capture fields a traveller needs into the add-expense form', () => {
    expect(assignCaptureHref(capture(), 'group-1')).toMatchObject({
      pathname: '/group/[id]/add-expense',
      params: {
        id: 'group-1',
        captureId: 'capture-1',
        description: 'taxi to airport',
        amount: '125000',
        category: 'travel',
        location: JSON.stringify({ name: 'Terminal 2', lat: 19.0896, lng: 72.8656 }),
        expenseDate: '2026-09-08',
      },
    });
  });

  it('carries how the draft was paid, so assigning does not turn a card into cash', () => {
    const href = assignCaptureHref(capture({ payment_method: 'credit' }), 'group-1');
    expect(href.params).toMatchObject({ paymentMethod: 'credit' });
  });

  it('says nothing about payment when the draft named none', () => {
    const href = assignCaptureHref(capture({ payment_method: null }), 'group-1');
    expect(href.params).not.toHaveProperty('paymentMethod');
  });
});

describe('capturePaymentMethod', () => {
  it('keeps every method the ledger knows', () => {
    for (const method of ['cash', 'upi', 'credit', 'debit', 'forex'] as const) {
      expect(capturePaymentMethod(method)).toBe(method);
    }
  });

  it('falls back to the form default for anything it does not know', () => {
    // A draft's column is plain text, so an older build's value — or none at
    // all — must land on something the ledger accepts rather than be cast.
    expect(capturePaymentMethod(null)).toBe('cash');
    expect(capturePaymentMethod(undefined)).toBe('cash');
    expect(capturePaymentMethod('crypto')).toBe('cash');
  });
});

describe('matchesAssignGroupQuery', () => {
  it('matches rider and traveller group names without requiring accents', () => {
    expect(matchesAssignGroupQuery('São Paulo Riders', 'sao')).toBe(true);
    expect(matchesAssignGroupQuery('Café Paris Trip', 'cafe')).toBe(true);
  });

  it('keeps ordinary financer group searches precise', () => {
    expect(matchesAssignGroupQuery('Flat finances', 'finance')).toBe(true);
    expect(matchesAssignGroupQuery('Flat finances', 'rider')).toBe(false);
  });

  it('treats an empty query as all groups for the user', () => {
    expect(matchesAssignGroupQuery('Goa trip', '   ')).toBe(true);
  });
});
