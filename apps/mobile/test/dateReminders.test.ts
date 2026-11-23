import { describe, expect, it } from 'vitest';

import type { UpcomingItem } from '@waves/core';

import { actionFor } from '../src/lib/dateReminders/actions';
import { fireTimeFor, pickReminderCard, planDateNotification } from '../src/lib/dateReminders/plan';

const item = (over: Partial<UpcomingItem>): UpcomingItem => ({
  key: 'a:2026-11-26',
  source: 'date',
  kind: 'family_birthday',
  id: 'a',
  name: 'Asha',
  date: '2026-11-26',
  inDays: 5,
  years: null,
  ...over,
});

describe('pickReminderCard', () => {
  it('shows a birthday 5 days out, not 6, and not once dismissed', () => {
    expect(pickReminderCard([item({})], new Set())).not.toBeNull();
    expect(pickReminderCard([item({ inDays: 6 })], new Set())).toBeNull();
    expect(pickReminderCard([item({})], new Set(['a:2026-11-26']))).toBeNull();
  });
  it('uses 21 days for festivals and never reminds about my own birthday', () => {
    const fest = item({ source: 'festival', kind: 'festival', key: 'diwali:x', inDays: 21 });
    expect(pickReminderCard([fest], new Set())).toBe(fest);
    expect(pickReminderCard([item({ kind: 'my_birthday' })], new Set())).toBeNull();
  });
  it('takes the soonest eligible one', () => {
    const a = item({ key: 'a', inDays: 4 });
    const b = item({ key: 'b', inDays: 2 });
    expect(pickReminderCard([b, a], new Set(['b']))).toBe(a);
  });
});

describe('planDateNotification', () => {
  it('fires at local 10:00, five days before', () => {
    const at = new Date(fireTimeFor(item({})));
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours()]).toEqual([
      2026, 10, 21, 10,
    ]);
  });
  it('wraps across month and year ends', () => {
    const at = new Date(fireTimeFor(item({ date: '2027-01-02' })));
    expect([at.getFullYear(), at.getMonth(), at.getDate()]).toEqual([2026, 11, 28]);
  });
  it('holds only the earliest future reminder, skipping past and dismissed ones', () => {
    const now = new Date(2026, 10, 21, 11).getTime(); // 21 Nov, after 10:00
    const past = item({ key: 'p', date: '2026-11-26' }); // 10:00 today already gone
    const soon = item({ key: 's', date: '2026-11-28' });
    const later = item({ key: 'l', date: '2026-12-10' });
    expect(planDateNotification([past, later, soon], new Set(), now)?.item.key).toBe('s');
    expect(planDateNotification([past, later, soon], new Set(['s']), now)?.item.key).toBe('l');
    expect(planDateNotification([past], new Set(), now)).toBeNull();
  });
});

describe('actionFor', () => {
  it('maps each kind to its one action', () => {
    expect(actionFor(item({ kind: 'my_birthday' }))).toBeNull();
    expect(actionFor(item({}))).toBe('giftCollection');
    expect(actionFor(item({ kind: 'anniversary' }))).toBe('setBudget');
    expect(actionFor(item({ kind: 'work_anniversary' }))).toBe('updatePay');
    expect(actionFor(item({ kind: 'festival' }))).toBe('planBudget');
  });
});
