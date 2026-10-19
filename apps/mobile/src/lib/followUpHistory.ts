/**
 * The person's own history, reduced to what the follow-up scorer reads
 * (`buildHistoryStats` in core): medians, frequent split partners, recent
 * places, trips and who added what in the last day. Pure: the caller hands in
 * plain rows read from the local mirror.
 */

import {
  buildHistoryStats,
  type HistoryRecord,
  type HistoryStats,
  type RecentGroupExpense,
  type TripInfo,
} from '@waves/core';

export interface HistoryMember {
  readonly id: string;
  readonly name: string;
  readonly isMe: boolean;
}

export interface HistoryExpense {
  readonly id: string;
  readonly authorMemberId: string | null;
  readonly createdMs: number;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly category: string | null;
  readonly description: string;
  readonly date: string;
  readonly place: string | null;
  readonly coords: { lat: number; lng: number } | null;
  /** Members who owe a share of it. */
  readonly participantIds: readonly string[];
}

export interface HistoryGroup {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly archived: boolean;
  readonly members: readonly HistoryMember[];
  readonly expenses: readonly HistoryExpense[];
}

export interface HistoryPersonal {
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly category: string | null;
  readonly note: string | null;
  readonly date: string;
  readonly place: string | null;
}

export interface HistoryInput {
  readonly groups: readonly HistoryGroup[];
  readonly personal: readonly HistoryPersonal[];
  /** Descriptions of the person's recurring rules. */
  readonly recurringNotes: readonly string[];
  readonly nowMs: number;
  /** The expense just saved: left out of every pattern it would otherwise create. */
  readonly excludeExpenseId: string;
}

const DAY_MS = 86_400_000;
const MAX_PER_SOURCE = 300;

export interface FollowUpHistory {
  readonly stats: HistoryStats;
  /** Coordinates of places used on group expenses, so a pin can be reused. */
  readonly placeCoords: Readonly<Record<string, { lat: number; lng: number }>>;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[0-9]+/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildFollowUpHistory(input: HistoryInput): FollowUpHistory {
  const records: HistoryRecord[] = [];
  const recent: RecentGroupExpense[] = [];
  const trips: TripInfo[] = [];
  const placeCoords: Record<string, { lat: number; lng: number }> = {};
  const todayMs = input.nowMs;

  for (const group of input.groups) {
    if (group.archived) continue;
    const me = group.members.find((m) => m.isMe);
    const names = new Map(group.members.map((m) => [m.id, m.name] as const));
    const sorted = [...group.expenses].sort((a, b) => b.createdMs - a.createdMs);
    let lastBefore: number | null = null;
    for (const e of sorted.slice(0, MAX_PER_SOURCE)) {
      if (e.id === input.excludeExpenseId) continue;
      if (lastBefore === null) lastBefore = e.createdMs;
      const mine = me ? e.participantIds.includes(me.id) || e.authorMemberId === me.id : false;
      if (mine) {
        records.push({
          scope: 'group',
          amountMinor: e.amountMinor,
          currency: e.currency,
          category: e.category,
          description: e.description,
          date: e.date,
          partners: e.participantIds
            .filter((id) => id !== me?.id && names.has(id))
            .map((id) => ({ memberId: id, groupId: group.id, name: names.get(id) ?? '' })),
          place: e.place,
          at: e.date,
        });
      }
      if (e.place && e.coords && !placeCoords[e.place]) placeCoords[e.place] = e.coords;
      if (todayMs - e.createdMs <= 2 * DAY_MS) {
        recent.push({
          groupId: group.id,
          expenseId: e.id,
          byOther: e.authorMemberId !== null && e.authorMemberId !== me?.id,
          authorName: (e.authorMemberId && names.get(e.authorMemberId)) || '',
          amountMinor: e.amountMinor,
          currency: e.currency,
          description: e.description,
          createdMs: e.createdMs,
        });
      }
    }
    if (group.type === 'trip') {
      trips.push({
        groupId: group.id,
        name: group.name,
        startDate: group.startDate,
        endDate: group.endDate,
        quietDays:
          lastBefore === null ? null : Math.max(0, Math.floor((todayMs - lastBefore) / DAY_MS)),
      });
    }
  }

  for (const txn of input.personal.slice(0, MAX_PER_SOURCE)) {
    records.push({
      scope: 'personal',
      amountMinor: txn.amountMinor,
      currency: txn.currency,
      category: txn.category,
      description: txn.note ?? '',
      date: txn.date,
      partners: [],
      place: txn.place,
      at: txn.date,
    });
  }

  return {
    stats: buildHistoryStats(records, {
      recurringRules: input.recurringNotes.map(normalise).filter(Boolean),
      recentGroupExpenses: recent,
      trips,
    }),
    placeCoords,
  };
}
