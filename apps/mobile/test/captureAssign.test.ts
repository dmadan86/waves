import { describe, expect, it } from 'vitest';

import { CaptureStatus, type CaptureRow } from '../src/data/types';
import { assignCaptureHref, matchesAssignGroupQuery } from '../src/lib/captureAssign';

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
