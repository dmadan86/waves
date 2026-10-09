/**
 * "Add missing rates": bring the group's older foreign bills up to date.
 *
 * Bills saved before a rate was fetched automatically carry `fx = null`, and a
 * bill without a rate hides its conversion on every screen. This finds them and
 * gives each one a rate — the trip's pinned rate if the group has one, else the
 * rate for the day the bill was paid — by saving a new version through the
 * ordinary edit path, so the history records it like any other change.
 *
 * Safe to run twice and safe to run while others edit: each bill is looked at
 * again just before it is written, and one that has a rate by then is skipped.
 * A bill whose rate cannot be fetched (offline) is left alone and counted, so
 * running it again later picks up exactly those.
 */

import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import type { FxRecord } from '@waves/core';
import { MutationKind } from '@waves/core';
import { Button, Callout, Text, useTheme } from '@waves/ui';

import { fetchFxRate } from '@/data/api';
import { useGroup, useGroupFxRates } from '@/data/hooks';
import { isViewer } from '@/data/types';
import { useSync } from '@/sync';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { editStateFromVersion, expenseWritePayload } from '@/lib/expenseEdit';
import { todayIso } from '@/lib/expenseForm';
import {
  backfillRateFor,
  countMissing,
  fetchKey,
  needsRate,
  rateDateFor,
  selectBackfill,
} from '@/lib/fxAutoRate';
import { useGuestGuard } from '@/lib/guestGuard';
import { tripRateFor } from '@/lib/tripRates';

interface Progress {
  done: number;
  total: number;
  updated: number;
  failed: number;
  running: boolean;
}

export function MissingRatesCard({ groupId }: { groupId: string }): React.JSX.Element | null {
  const theme = useTheme();
  const { t } = useStrings();
  const { mutate } = useSync();
  const guard = useGuestGuard();
  const viewerId = useViewerId();
  const { group, members, expenses } = useGroup(groupId);
  const pinnedRates = useGroupFxRates(groupId);
  const [progress, setProgress] = useState<Progress | null>(null);

  // The run is a long async loop; reading these through refs means each bill is
  // judged against the mirror as it is *now*, not as it was when Run was tapped.
  const rowsRef = useRef(expenses.rows);
  const pinnedRef = useRef(pinnedRates.data);
  useEffect(() => {
    rowsRef.current = expenses.rows;
    pinnedRef.current = pinnedRates.data;
  }, [expenses.rows, pinnedRates.data]);

  const groupCurrency = group.data?.default_currency ?? null;
  const myMemberId =
    (members.data ?? []).find((m) => isViewer(m, viewerId) && m.left_at === null)?.id ?? null;
  if (!groupCurrency) return null;

  const candidates = selectBackfill(expenses.rows, groupCurrency, myMemberId);
  const missing = countMissing(expenses.rows, groupCurrency);
  const running = progress?.running ?? false;

  // Nothing to offer: no bill lacks a rate, or none of them is this person's to
  // rewrite. A finished run keeps its result on screen until they leave.
  if (!progress && candidates.length === 0) return null;

  const run = async (): Promise<void> => {
    if (running || guard.blockWrite()) return;
    const targets = selectBackfill(rowsRef.current, groupCurrency, myMemberId);
    const state: Progress = {
      done: 0,
      total: targets.length,
      updated: 0,
      failed: 0,
      running: true,
    };
    setProgress({ ...state });
    // One request per currency and day, however many bills share them.
    const fetched = new Map<string, Promise<FxRecord | null>>();
    const lookup = (currency: string, date: string | null): Promise<FxRecord | null> => {
      const key = fetchKey(currency, date);
      let pending = fetched.get(key);
      if (!pending) {
        pending = fetchFxRate(currency, groupCurrency, date ?? undefined).catch(() => null);
        fetched.set(key, pending);
      }
      return pending;
    };
    for (const target of targets) {
      // Looked at again: it may have been given a rate, edited or deleted since.
      const latest = rowsRef.current.find((row) => row.id === target.id);
      const version = latest?.currentVersion;
      if (
        !latest ||
        latest.deleted_at ||
        !version ||
        !needsRate({ currency: version.currency, groupCurrency, fx: version.fx })
      ) {
        state.done += 1;
        setProgress({ ...state });
        continue;
      }
      const pinned = tripRateFor(pinnedRef.current, version.currency, groupCurrency);
      const record = backfillRateFor(
        version,
        groupCurrency,
        pinned,
        pinned
          ? null
          : await lookup(version.currency, rateDateFor(version.expense_date, todayIso())),
      );
      if (!record) {
        state.failed += 1;
      } else {
        try {
          await mutate(
            MutationKind.ExpenseUpdate,
            groupId,
            expenseWritePayload({
              expenseId: target.id,
              state: { ...editStateFromVersion(version, myMemberId), fx: record },
              editing: version,
            }),
          );
          state.updated += 1;
        } catch {
          state.failed += 1;
        }
      }
      state.done += 1;
      setProgress({ ...state });
    }
    setProgress({ ...state, running: false });
  };

  const finished = progress && !progress.running ? progress : null;
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Callout tone={finished && finished.failed === 0 ? 'positive' : 'info'}>
        {running && progress
          ? t.fx.missingRatesProgress
              .replace('{done}', String(progress.done))
              .replace('{total}', String(progress.total))
          : finished
            ? finished.failed > 0
              ? t.fx.missingRatesPartial
                  .replace('{n}', String(finished.updated))
                  .replace('{failed}', String(finished.failed))
              : t.fx.missingRatesDone.replace('{n}', String(finished.updated))
            : t.fx.missingRatesBody.replace('{n}', String(missing))}
      </Callout>
      {running || (finished && finished.failed === 0) ? null : (
        <Button
          label={finished ? t.fx.retryRate : t.fx.missingRatesAction}
          variant="secondary"
          onPress={() => void run()}
        />
      )}
      {!running && !finished && missing > candidates.length ? (
        <Text variant="micro" tone="muted">
          {t.fx.missingRatesOthers}
        </Text>
      ) : null}
    </View>
  );
}
