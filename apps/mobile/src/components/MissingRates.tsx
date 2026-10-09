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
 *
 * Sometimes the server can only offer a rate from another day (every source
 * down, or only a latest-only source for a past bill). Those bills are skipped
 * too, and the result says so ("could only get a rate from another day") with
 * a separate "Use rates from other days" — such a rate goes on a bill only
 * when the person asks for it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';

import { MutationKind } from '@waves/core';
import { Button, Callout, Text, useTheme } from '@waves/ui';

import { fetchFxRate } from '@/data/api';
import { useGroup, useGroupFxRates } from '@/data/hooks';
import { useSync } from '@/sync';
import { useStrings } from '@/i18n';
import { useViewerId } from '@/lib/auth';
import { editStateFromVersion, expenseWritePayload } from '@/lib/expenseEdit';
import {
  activeMemberId,
  backfillRateFor,
  countMissing,
  fetchKey,
  localToday,
  needsRate,
  rateDateFor,
  selectBackfill,
} from '@/lib/fxAutoRate';
import {
  backfillOutcome,
  lookupFromError,
  staleLabel,
  usableRate,
  type BackfillLookup,
} from '@/lib/fxStale';
import { useGuestGuard } from '@/lib/guestGuard';
import { tripRateFor } from '@/lib/tripRates';

interface Progress {
  done: number;
  total: number;
  updated: number;
  failed: number;
  /** Bills skipped because only a rate from another day was on offer: one day per bill. */
  staleDays: string[];
  running: boolean;
}

export function MissingRatesCard({ groupId }: { groupId: string }): React.JSX.Element | null {
  const theme = useTheme();
  const { t, locale } = useStrings();
  const { mutate } = useSync();
  const guard = useGuestGuard();
  const viewerId = useViewerId();
  const { group, members, expenses } = useGroup(groupId);
  const pinnedRates = useGroupFxRates(groupId);
  const [progress, setProgress] = useState<Progress | null>(null);

  // The run is a long async loop; reading these through refs means each bill is
  // judged against the mirror as it is *now*, not as it was when Run was tapped.
  const runningRef = useRef(false);
  const rowsRef = useRef(expenses.rows);
  const pinnedRef = useRef(pinnedRates.data);
  useEffect(() => {
    rowsRef.current = expenses.rows;
    pinnedRef.current = pinnedRates.data;
  }, [expenses.rows, pinnedRates.data]);

  const groupCurrency = group.data?.default_currency ?? null;
  const myMemberId = activeMemberId(members.data ?? [], viewerId);
  // Scans of every bill in the group: only redone when the bills or the
  // currency change, not on each progress tick of a run.
  const candidates = useMemo(
    () => (groupCurrency ? selectBackfill(expenses.rows, groupCurrency, myMemberId) : []),
    [expenses.rows, groupCurrency, myMemberId],
  );
  const missing = useMemo(
    () => (groupCurrency ? countMissing(expenses.rows, groupCurrency) : 0),
    [expenses.rows, groupCurrency],
  );
  if (!groupCurrency) return null;
  const running = progress?.running ?? false;

  // Nothing to offer: no bill lacks a rate, or none of them is this person's to
  // rewrite. A finished run keeps its result on screen until they leave.
  if (!progress && candidates.length === 0) return null;

  const run = async (acceptStale = false): Promise<void> => {
    // A ref, not `running`: that is the render's copy and a second tap in the
    // same frame still sees false.
    if (runningRef.current || guard.blockWrite()) return;
    runningRef.current = true;
    const targets = selectBackfill(rowsRef.current, groupCurrency, myMemberId);
    const state: Progress = {
      done: 0,
      total: targets.length,
      updated: 0,
      failed: 0,
      staleDays: [],
      running: true,
    };
    setProgress({ ...state });
    // One request per currency and day, however many bills share them.
    const fetched = new Map<string, Promise<BackfillLookup>>();
    const lookup = (currency: string, date: string | null): Promise<BackfillLookup> => {
      const key = fetchKey(currency, date);
      let pending = fetched.get(key);
      if (!pending) {
        pending = fetchFxRate(currency, groupCurrency, date ?? undefined).then(
          (record): BackfillLookup => ({ kind: 'fresh', record }),
          lookupFromError,
        );
        fetched.set(key, pending);
      }
      return pending;
    };
    try {
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
        const found = pinned
          ? null
          : await lookup(version.currency, rateDateFor(version.expense_date, localToday()));
        const record = backfillRateFor(
          version,
          groupCurrency,
          pinned,
          found ? usableRate(found, acceptStale) : null,
        );
        if (!record && found?.kind === 'stale') {
          // A rate from another day was on offer and not accepted: left alone, and said so.
          state.staleDays.push(found.day);
        } else if (!record) {
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
    } finally {
      runningRef.current = false;
      setProgress({ ...state, running: false });
    }
  };

  const finished = progress && !progress.running ? progress : null;
  const outcome = finished ? backfillOutcome(finished) : null;
  const staleCount = outcome?.staleCount ?? 0;
  const allDone = outcome?.allDone ?? false;
  // Only a rate from another day was on offer for these. Said in full, and
  // used only on the explicit button.
  const staleText =
    outcome && outcome.staleFrom
      ? staleLabel(outcome.staleFrom, t.fx.missingRatesStale, locale).replace(
          '{n}',
          String(staleCount),
        )
      : null;
  const headline =
    running && progress
      ? t.fx.missingRatesProgress
          .replace('{done}', String(progress.done))
          .replace('{total}', String(progress.total))
      : outcome
        ? outcome.headline === 'partial'
          ? t.fx.missingRatesPartial
              .replace('{n}', String(finished?.updated ?? 0))
              .replace('{failed}', String(finished?.failed ?? 0))
          : outcome.headline === 'done'
            ? t.fx.missingRatesDone.replace('{n}', String(finished?.updated ?? 0))
            : // Every bill was skipped for a rate from another day: nothing was
              // done, so no "done" — the explanation is the headline.
              staleText
        : t.fx.missingRatesBody.replace('{n}', String(missing));
  return (
    <View style={{ gap: theme.spacing.sm }}>
      <Callout tone={allDone ? 'positive' : 'info'}>{headline}</Callout>
      {staleText && !outcome?.onlyStale ? (
        <Text variant="caption" tone="muted">
          {staleText}
        </Text>
      ) : null}
      {finished && staleCount > 0 && !running ? (
        <Button
          label={t.fx.missingRatesUseStale}
          variant="secondary"
          onPress={() => void run(true)}
        />
      ) : null}
      {running || allDone ? null : (
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
