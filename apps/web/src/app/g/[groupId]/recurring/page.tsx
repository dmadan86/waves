'use client';

/**
 * A group's repeating expenses: the rent, the broadband.
 *
 * The expenses themselves are posted by the server on their dates; this page is
 * the list of rules with pause, resume and stop. Making one, and changing its
 * amount or split, is the phone's job (the split maths and the offline queue
 * live there) — the page says so rather than pretending to a half-form.
 * A stopped rule is final, so stopping asks first.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Repeat } from 'lucide-react';

import { Frequency, frequencyOf } from '@waves/core';
import type { GroupRecurringRow, GroupRow } from '@waves/api-client';

import { AppFrame } from '@/components/AppFrame';
import { EmptyState } from '@/components/EmptyState';
import { Section } from '@/components/Shell';
import { SkeletonRows } from '@/components/Skeleton';
import { useStrings } from '@/i18n-context';
import { fill, type WebStrings } from '@/i18n';
import { friendlyError } from '@/lib/errors';
import { money } from '@/lib/money';
import { waves } from '@/lib/waves';

export default function RecurringPage() {
  const params = useParams<{ groupId: string }>();
  const groupId = params?.groupId ?? '';
  return (
    <AppFrame current={Section.Groups}>
      {() => <Recurring key={groupId} groupId={groupId} />}
    </AppFrame>
  );
}

function label(t: WebStrings['groupRecurring'], rule: GroupRecurringRow): string {
  switch (frequencyOf(rule)) {
    case Frequency.Weekly:
      return t.weekly;
    case Frequency.Fortnightly:
      return t.fortnightly;
    case Frequency.TwiceAMonth:
      return t.twiceAMonth;
    case Frequency.Quarterly:
      return t.quarterly;
    case Frequency.HalfYearly:
      return t.halfYearly;
    case Frequency.Yearly:
      return t.yearly;
    case Frequency.EveryNMonths:
      return fill(t.monthsInterval, { n: String(rule.interval) });
    default:
      return t.monthly;
  }
}

function Recurring({ groupId }: { groupId: string }) {
  const { t, locale } = useStrings();
  const r = t.groupRecurring;
  const [group, setGroup] = useState<GroupRow | null>(null);
  const [rules, setRules] = useState<GroupRecurringRow[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [row, list] = await Promise.all([waves.groupRow(groupId), waves.groupRecurring(groupId)]);
    setGroup(row);
    setRules(list);
  }, [groupId]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await load();
      } catch (caught) {
        if (active)
          setFailed(
            friendlyError(caught, 'web.recurring.load', {
              fallback: t.errors.couldNotLoad,
              offline: t.errors.offline,
            }),
          );
      } finally {
        if (active) setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [load, t.errors.couldNotLoad, t.errors.offline]);

  const change = async (rule: GroupRecurringRow, status: 'active' | 'paused' | 'stopped') => {
    if (status === 'stopped' && !window.confirm(fill(r.stopConfirm, { name: rule.description }))) {
      return;
    }
    setBusy(rule.id);
    setError(null);
    try {
      await waves.setGroupRecurringStatus(rule.id, status);
      await load();
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.recurring.update', {
          fallback: r.couldNotSave,
          offline: t.errors.offline,
        }),
      );
    } finally {
      setBusy(null);
    }
  };

  if (!ready) return <SkeletonRows rows={4} />;
  if (failed) return <p className="error">{failed}</p>;

  const over = (rule: GroupRecurringRow) =>
    rule.status === 'stopped' || (rule.end_date !== null && rule.next_date > rule.end_date);
  const ordered = [...rules.filter((rule) => !over(rule)), ...rules.filter(over)];

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{r.title}</h1>
          <div className="sub">{group?.name?.trim() || r.sub}</div>
        </div>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <p className="sub">{r.sub}</p>

      {ordered.length === 0 ? (
        <EmptyState Icon={Repeat} title={r.empty} />
      ) : (
        <div className="list">
          {ordered.map((rule) => {
            const ended = over(rule);
            return (
              <div
                key={rule.id}
                className="item"
                style={{ cursor: 'default', opacity: ended ? 0.6 : 1 }}
              >
                <span className="grow">
                  <span className="title">{rule.description}</span>
                  <span className="meta">
                    {label(r, rule)}
                    {' · '}
                    {ended
                      ? r.ended
                      : rule.status === 'paused'
                        ? r.paused
                        : fill(r.next, { date: rule.next_date })}
                    {rule.last_generated_on
                      ? ` · ${fill(r.lastAdded, { date: rule.last_generated_on })}`
                      : ''}
                  </span>
                </span>
                <span className="title">{money(BigInt(rule.amount), rule.currency, locale)}</span>
                {ended ? null : (
                  <span style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn soft"
                      disabled={busy === rule.id}
                      onClick={() =>
                        void change(rule, rule.status === 'paused' ? 'active' : 'paused')
                      }
                    >
                      {rule.status === 'paused' ? r.resume : r.pause}
                    </button>
                    <button
                      type="button"
                      className="btn soft"
                      disabled={busy === rule.id}
                      onClick={() => void change(rule, 'stopped')}
                    >
                      {r.stop}
                    </button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      <p className="sub">{r.editInApp}</p>
    </div>
  );
}
