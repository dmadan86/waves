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

/** Every date and festival with its next occurrence, soonest first. */
export function useDateOccurrences(): readonly UpcomingItem[] {
  const dates = usePersonalDates();
  const { profile } = useAuth();
  const { festivalsOff } = useDatePrefs();
  const todayIso = localIsoDate(new Date());
  return useMemo(
    () => allOccurrences({ dates, country: profile?.country_code, festivalsOff, todayIso }),
    [dates, profile?.country_code, festivalsOff, todayIso],
  );
}

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
