/** The owner's private dates, read from the personal ledger store (kind `date`). */

import { useMemo } from 'react';

import {
  allOccurrences,
  decodeDate,
  encodeDate,
  type PersonalDate,
  type UpcomingItem,
} from '@waves/core';

import { localIsoDate, usePersonalRecords, useUpsertPersonalRecord } from '@/data/personal';
import { useDatePrefs } from '@/lib/dateReminders/store';
import { useAuth } from '@/lib/auth';

export function usePersonalDates(): readonly PersonalDate[] {
  const records = usePersonalRecords();
  return useMemo(
    () =>
      records
        .filter((r) => r.record_kind === 'date')
        .map((r) => decodeDate(r.id, r.data))
        .sort((a, b) => a.month - b.month || a.day - b.day),
    [records],
  );
}

function useOccurrences(withFestivals: boolean): readonly UpcomingItem[] {
  const dates = usePersonalDates();
  const { profile } = useAuth();
  const { festivalsOn } = useDatePrefs();
  const todayIso = localIsoDate(new Date());
  return useMemo(
    () =>
      allOccurrences({
        dates,
        country: profile?.country_code,
        festivalsOn: withFestivals ? festivalsOn : [],
        todayIso,
      }),
    [dates, profile?.country_code, festivalsOn, withFestivals, todayIso],
  );
}

/** Dates the person added, soonest first: what Home and Upcoming list. Never festivals. */
export const useDateOccurrences = (): readonly UpcomingItem[] => useOccurrences(false);

/** The same plus festivals the person switched on: only for the reminder card and notification. */
export const useReminderOccurrences = (): readonly UpcomingItem[] => useOccurrences(true);

export function useSaveDate() {
  const upsert = useUpsertPersonalRecord();
  return {
    isPending: upsert.isPending,
    save: (date: Omit<PersonalDate, 'id'> & { id?: string }, onDone: () => void) =>
      upsert.mutate(
        { recordId: date.id, recordKind: 'date', data: encodeDate(date) },
        { onSuccess: onDone },
      ),
  };
}
