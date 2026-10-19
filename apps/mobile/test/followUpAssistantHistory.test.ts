import { describe, expect, it } from 'vitest';

import {
  buildFollowUpHistory,
  type HistoryExpense,
  type HistoryGroup,
} from '@/lib/followUpHistory';

const NOW = Date.UTC(2026, 9, 21, 12);
const DAY = 86_400_000;
const exp = (over: Partial<HistoryExpense> = {}): HistoryExpense => ({
  id: 'old',
  authorMemberId: 'm-ravi',
  createdMs: NOW - DAY,
  amountMinor: 100n,
  currency: 'INR',
  category: 'food',
  description: 'Dinner',
  date: '2026-10-20',
  place: null,
  coords: null,
  participantIds: ['m-me', 'm-ravi'],
  ...over,
});
const group = (over: Partial<HistoryGroup> = {}): HistoryGroup => ({
  id: 'g-goa',
  name: 'Goa trip',
  type: 'trip',
  archived: false,
  startDate: '2026-10-01',
  endDate: '2026-10-25',
  members: [
    { id: 'm-me', name: 'Madan', isMe: true },
    { id: 'm-anu', name: 'Anu', isMe: false },
    { id: 'm-ravi', name: 'Ravi', isMe: false },
  ],
  expenses: [exp()],
  ...over,
});
const build = (groups: HistoryGroup[]) =>
  buildFollowUpHistory({
    groups,
    personal: [],
    recurringNotes: [],
    nowMs: NOW,
    excludeExpenseId: 'saved',
  });

const anu = { memberId: 'm-anu', groupId: 'g-goa', name: 'Anu' };

describe('assistant history adapter', () => {
  it('HS-08 filters groups and saved rows, bounds recent history, floors quiet days and caps each source', () => {
    const { stats, placeCoords } = build([
      group({
        expenses: [
          exp({ id: 'saved', createdMs: NOW, place: 'Excluded', coords: { lat: 9, lng: 9 } }),
          exp({
            id: 'mine',
            authorMemberId: 'm-me',
            createdMs: NOW - 1000,
            place: 'Cafe',
            coords: { lat: 1, lng: 2 },
          }),
          exp({
            id: 'boundary',
            createdMs: NOW - 2 * DAY,
            place: 'Cafe',
            coords: { lat: 3, lng: 4 },
          }),
          exp({ id: 'too-old', createdMs: NOW - 2 * DAY - 1 }),
        ],
      }),
      group({
        id: 'archived',
        archived: true,
        expenses: [exp({ currency: 'USD', place: 'Hidden', coords: { lat: 5, lng: 6 } })],
      }),
      group({ id: 'g-flat', name: 'Flat 4B', type: 'home', expenses: [] }),
      group({
        id: 'g-london',
        name: 'London',
        expenses: [exp({ id: 'quiet', currency: 'GBP', createdMs: NOW - 5.9 * DAY })],
      }),
    ]);
    expect(stats.recentGroupExpenses.map((e) => [e.expenseId, e.byOther])).toEqual([
      ['mine', false],
      ['boundary', true],
    ]);
    expect(stats.byCurrency).toEqual({
      INR: { median: 100n, count: 3 },
      GBP: { median: 100n, count: 1 },
    });
    expect(stats.trips.map((t) => [t.groupId, t.quietDays])).toEqual([
      ['g-goa', 0],
      ['g-london', 5],
    ]);
    expect(placeCoords).toEqual({ Cafe: { lat: 1, lng: 2 } });
    expect(stats.recentPlaces).toEqual(['Cafe']);

    const many = Array.from({ length: 301 }, (_, i) =>
      exp({ id: `e-${i}`, createdMs: NOW - i, place: i === 300 ? 'Beyond cap' : null }),
    );
    const capped = buildFollowUpHistory({
      groups: [
        group({ expenses: [...many].reverse() }),
        group({ id: 'second-source', type: 'home', expenses: many }),
      ],
      personal: Array.from({ length: 301 }, (_, i) => ({
        amountMinor: 200n,
        currency: 'GBP',
        category: 'home',
        note: `Personal ${i}`,
        date: '2026-10-21',
        place: null,
      })),
      recurringNotes: [],
      nowMs: NOW,
      excludeExpenseId: 'saved',
    });
    expect(capped.stats.byCurrency).toEqual({
      INR: { median: 100n, count: 600 },
      GBP: { median: 200n, count: 300 },
    });
    expect(capped.stats.recentGroupExpenses).toHaveLength(600);
    expect(
      capped.stats.recentGroupExpenses.filter((e) => e.groupId === 'g-goa').map((e) => e.expenseId),
    ).toEqual(Array.from({ length: 300 }, (_, i) => `e-${i}`));
    expect(capped.stats.pastPersonal).toHaveLength(300);
    expect(capped.stats.pastPersonal.at(-1)?.description).toBe('Personal 299');
    expect(capped.stats.recentPlaces).not.toContain('Beyond cap');
  });

  it('HS-10 personal null notes become empty descriptions before core aggregation', () => {
    const { stats } = buildFollowUpHistory({
      groups: [],
      personal: [
        {
          note: null,
          amountMinor: 100n,
          currency: 'INR',
          category: null,
          date: '2026-10-21',
          place: null,
        },
      ],
      recurringNotes: [],
      nowMs: Date.UTC(2026, 9, 21, 12),
      excludeExpenseId: 'saved',
    });
    expect(stats.pastPersonal).toEqual([
      { description: '', amountMinor: 100n, currency: 'INR', date: '2026-10-21' },
    ]);
  });

  it('HS-09 the history adapter drops participants missing from the member map', () => {
    // Member lookup belongs to the adapter; core receives already-resolved partners.
    const { stats } = buildFollowUpHistory({
      nowMs: Date.UTC(2026, 9, 21, 12),
      excludeExpenseId: 'saved',
      personal: [],
      recurringNotes: [],
      groups: [
        {
          id: 'g-goa',
          name: 'Goa trip',
          type: 'trip',
          archived: false,
          startDate: null,
          endDate: null,
          members: [
            { id: 'm-me', name: 'Madan', isMe: true },
            { id: 'm-anu', name: 'Anu', isMe: false },
          ],
          expenses: [
            {
              id: 'old',
              authorMemberId: 'm-me',
              createdMs: Date.UTC(2026, 9, 20),
              amountMinor: 100n,
              currency: 'INR',
              category: 'food',
              description: 'Dinner',
              date: '2026-10-20',
              place: null,
              coords: null,
              participantIds: ['m-me', 'm-anu', 'unknown'],
            },
          ],
        },
      ],
    });
    expect(stats.partnersByCategory.food).toEqual([{ ...anu, count: 1 }]);
  });
});
