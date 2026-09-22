/**
 * Which drafts belong at the top of a group.
 *
 * A draft (A34) belongs to the person, not to the group, so the group screen
 * reads every open draft this account holds and has to pick out the ones
 * addressed to it. Getting that wrong in either direction is bad in a
 * particular way: too loose and somebody's private draft — or one meant for
 * another group — appears inside a shared ledger; too tight and money that was
 * deliberately kept for this group is invisible in the one place its owner
 * will look for it.
 */
import { describe, expect, it } from 'vitest';

import { draftsForGroup } from '../src/lib/groupDrafts';
import type { CaptureRow } from '../src/data/types';

function capture(overrides: Partial<CaptureRow> = {}): CaptureRow {
  return {
    id: 'cap-1',
    owner_user_id: 'me',
    description: '',
    category: null,
    category_meta: null,
    expense_date: '2026-09-22',
    currency: 'USD',
    amount: '100000',
    notes: null,
    photo_path: null,
    raw_text: null,
    parsed: null,
    payment_method: null,
    target_group_id: null,
    location: null,
    assigned_expense_id: null,
    assigned_group_id: null,
    deleted_at: null,
    created_at: '2026-09-22T00:00:00Z',
    updated_at: '2026-09-22T00:00:00Z',
    ...overrides,
  } as CaptureRow;
}

describe('the drafts shown on a group', () => {
  it('takes the ones addressed to it', () => {
    const mine = capture({ id: 'a', target_group_id: 'flat' });
    expect(draftsForGroup([mine], 'flat')).toEqual([mine]);
  });

  it("leaves another group's drafts alone", () => {
    expect(draftsForGroup([capture({ id: 'a', target_group_id: 'goa' })], 'flat')).toEqual([]);
  });

  it('leaves an unaddressed draft in Review, where it belongs', () => {
    // A draft with no destination is exactly the case the inbox exists for:
    // it has not been decided yet, and deciding it inside one group's ledger
    // would be deciding it by accident.
    expect(draftsForGroup([capture({ id: 'a', target_group_id: null })], 'flat')).toEqual([]);
  });

  it('keeps the order it was given', () => {
    const first = capture({ id: 'a', target_group_id: 'flat' });
    const second = capture({ id: 'b', target_group_id: 'flat' });
    expect(draftsForGroup([first, second], 'flat').map((row) => row.id)).toEqual(['a', 'b']);
  });

  it('is empty when there is nothing waiting', () => {
    expect(draftsForGroup([], 'flat')).toEqual([]);
  });
});
