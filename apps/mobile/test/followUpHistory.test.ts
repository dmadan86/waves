import { describe, expect, it } from 'vitest';

import { buildFollowUpHistory, type HistoryGroup } from '@/lib/followUpHistory';

const NOW = Date.UTC(2026, 9, 19, 12);
const members = [
  { id: 'me', name: 'Me', isMe: true },
  { id: 'ravi', name: 'Ravi', isMe: false },
  { id: 'priya', name: 'Priya', isMe: false },
];
const exp = (over = {}) => ({
  id: 'x',
  authorMemberId: 'ravi',
  createdMs: NOW - 3600_000,
  amountMinor: 120000n,
  currency: 'INR',
  category: 'food',
  description: 'Dinner',
  date: '2026-10-19',
  place: null,
  coords: null,
  participantIds: ['me', 'ravi'],
  ...over,
});
const grp = (over: Partial<HistoryGroup> = {}): HistoryGroup => ({
  id: 'g1',
  name: 'Goa trip',
  type: 'trip',
  startDate: '2026-10-01',
  endDate: '2026-10-25',
  archived: false,
  members,
  expenses: [exp()],
  ...over,
});
const build = (groups: HistoryGroup[], excludeExpenseId = 'saved') =>
  buildFollowUpHistory({ groups, personal: [], recurringNotes: [], nowMs: NOW, excludeExpenseId });

describe('buildFollowUpHistory', () => {
  it('lists what others added in the last two days, and who', () => {
    const { stats } = build([grp()]);
    expect(stats.recentGroupExpenses).toHaveLength(1);
    expect(stats.recentGroupExpenses[0]).toMatchObject({ byOther: true, authorName: 'Ravi' });
  });
  it('marks my own as not byOther, and leaves out the just-saved expense', () => {
    const mine = grp({
      expenses: [
        exp({ id: 'saved', authorMemberId: 'me' }),
        exp({ id: 'y', authorMemberId: 'me' }),
      ],
    });
    const { stats } = build([mine]);
    expect(stats.recentGroupExpenses.map((e) => [e.expenseId, e.byOther])).toEqual([['y', false]]);
  });
  it('partners come from shared expenses, never me', () => {
    const many = grp({ expenses: [exp({ id: 'a' }), exp({ id: 'b' })] });
    const partners = build([many]).stats.partnersByCategory.food;
    expect(partners?.map((p) => [p.name, p.count])).toEqual([['Ravi', 2]]);
  });
  it('trips carry how long they were quiet before this add', () => {
    const quiet = grp({ expenses: [exp({ id: 'old', createdMs: NOW - 6 * 86_400_000 })] });
    expect(build([quiet]).stats.trips[0]?.quietDays).toBe(6);
    expect(build([grp({ type: 'home' })]).stats.trips).toHaveLength(0);
    expect(build([grp({ archived: true })]).stats.trips).toHaveLength(0);
  });
  it('remembers pins for reuse', () => {
    const pinned = grp({ expenses: [exp({ place: 'Taj', coords: { lat: 1, lng: 2 } })] });
    expect(build([pinned]).placeCoords).toEqual({ Taj: { lat: 1, lng: 2 } });
    expect(build([pinned]).stats.recentPlaces).toEqual(['Taj']);
  });
  it('personal entries feed medians, places, and recurring rules are normalised', () => {
    const h = buildFollowUpHistory({
      groups: [],
      personal: [
        {
          amountMinor: 100n,
          currency: 'INR',
          category: 'food',
          note: 'x',
          date: '2026-10-01',
          place: 'Cafe',
        },
      ],
      recurringNotes: ['Netflix 2026'],
      nowMs: NOW,
      excludeExpenseId: 'z',
    });
    expect(h.stats.byCurrency.INR).toEqual({ median: 100n, count: 1 });
    expect(h.stats.recentPlaces).toEqual(['Cafe']);
    expect(h.stats.recurringRules).toEqual(['netflix']);
  });
});
