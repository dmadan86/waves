'use client';

/**
 * Me: the private personal ledger in the browser.
 *
 * Reads the person's own `personal_records` from the same `sync` mirror the
 * phone uses and writes through the same `personal.upsert` / `personal.delete`
 * mutations on their personal scope (ADR-005: keyed by their own id). There is
 * no biometric gate on the web (A51 is a phone feature), so the page asks for a
 * signed-in, non-guest session instead and says so.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Wallet } from 'lucide-react';

import {
  CATEGORIES,
  MutationKind,
  personalScope,
  toMajorString,
  type CurrencyCode,
  type PersonalTxn,
} from '@waves/core';

import { AskSpending } from '@/components/AskSpending';
import { EmptyState } from '@/components/EmptyState';
import { useAuth } from '@/lib/auth';
import { useStrings } from '@/i18n-context';
import { friendlyError } from '@/lib/errors';
import {
  entryData,
  groupByDay,
  ledgerTxns,
  mainCurrency,
  monthOf,
  monthsWithEntries,
  monthTotals,
  type EntryForm,
} from '@/lib/me';
import { money } from '@/lib/money';
import { useSync } from '@/lib/sync';

const localToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function MePage({ profileId }: { profileId: string }) {
  const { t } = useStrings();
  const { isGuest } = useAuth();
  if (isGuest) {
    return (
      <div>
        <div className="page-head">
          <h1>{t.me.title}</h1>
        </div>
        <section className="panel">
          <p>{t.me.signInNeeded}</p>
        </section>
      </div>
    );
  }
  return <Ledger profileId={profileId} />;
}

function Ledger({ profileId }: { profileId: string }) {
  const { t, locale } = useStrings();
  const { mirror, hydrated, mutate, error: syncError } = useSync();
  const [today] = useState(localToday);
  const [month, setMonth] = useState(monthOf(today));
  const [editing, setEditing] = useState<PersonalTxn | 'new' | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const txns = useMemo(() => ledgerTxns(mirror, profileId), [mirror, profileId]);
  const currency = mainCurrency(txns);
  const months = monthsWithEntries(txns, monthOf(today));
  const inMonth = txns.filter((txn) => monthOf(txn.date) === month);
  const days = groupByDay(inMonth, currency);
  const totals = monthTotals(txns, month, currency);
  const spent = totals.reduce((sum, row) => sum + row.spent, 0n);
  const earned = inMonth
    .filter((txn) => txn.kind === 'income' && txn.currency === currency)
    .reduce((sum, txn) => sum + txn.amount, 0n);
  const fmt = (minor: bigint, cur = currency) => money(minor, cur, locale);
  const label = (category: string | null) =>
    category === null
      ? t.me.uncategorised
      : ((t.categories as Record<string, string>)[category] ?? category);
  const scope = personalScope(profileId);

  async function remove(txn: PersonalTxn) {
    if (!window.confirm(t.me.deleteConfirm)) return;
    setFailed(null);
    try {
      await mutate(MutationKind.PersonalDelete, scope, { recordId: txn.id });
    } catch (caught) {
      setFailed(
        friendlyError(caught, 'web.me.delete', {
          fallback: t.me.form.couldNotSave,
          offline: t.errors.offline,
        }),
      );
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{t.me.title}</h1>
          <div className="sub">{t.me.sub}</div>
        </div>
        <button type="button" className="btn brand" onClick={() => setEditing('new')}>
          {t.me.add}
        </button>
        <Link className="btn soft" href="/me/import">
          {t.me.importStatement}
        </Link>
      </div>

      {syncError ? <p className="error">{syncError}</p> : null}
      {failed ? (
        <p className="error" role="alert">
          {failed}
        </p>
      ) : null}

      {editing ? (
        <EntryEditor
          key={editing === 'new' ? 'new' : editing.id}
          txn={editing === 'new' ? null : editing}
          currency={currency}
          today={today}
          scope={scope}
          onDone={() => setEditing(null)}
        />
      ) : null}

      {!hydrated ? (
        <p className="muted">{t.me.loading}</p>
      ) : txns.length === 0 && !editing ? (
        <EmptyState
          Icon={Wallet}
          title={t.me.emptyTitle}
          body={t.me.emptyBody}
          action={{ label: t.me.importStatement, href: '/me/import' }}
        />
      ) : (
        <>
          <section className="panel">
            <div className="panel-head">
              <h2>{t.me.byCategory}</h2>
              <select
                aria-label={t.me.month}
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="stat-strip">
              <div className="stat-cell">
                <span className="meta">{t.me.spent}</span>
                <strong data-testid="me-spent">{fmt(spent)}</strong>
              </div>
              <div className="stat-cell">
                <span className="meta">{t.me.earned}</span>
                <strong>{fmt(earned)}</strong>
              </div>
            </div>
            {totals.length === 0 ? (
              <p className="muted">{t.me.noSpending}</p>
            ) : (
              <ul className="list" aria-label={t.me.byCategory}>
                {totals.map((row) => (
                  <li key={row.category ?? 'none'} className="row">
                    <span className="grow">{label(row.category)}</span>
                    <span className="meta">{Math.round(row.share * 100)}%</span>
                    <strong>{fmt(row.spent)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <AskSpending key={month} month={month} currency={currency} />

          <section className="panel">
            <div className="panel-head">
              <h2>{t.me.entries}</h2>
            </div>
            {days.map((day) => (
              <div key={day.date} className="list">
                <div className="row row-heading" style={{ overflowWrap: 'anywhere' }}>
                  <span className="grow">{day.date}</span>
                  {day.spent > 0n ? <span className="meta">{fmt(day.spent)}</span> : null}
                </div>
                {day.txns.map((txn) => (
                  <div key={txn.id} className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <span className="grow" style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                      <span className="title">{txn.note ?? label(txn.category)}</span>
                      <span className="meta"> {label(txn.category)}</span>
                    </span>
                    <strong>
                      {txn.kind === 'income' ? '+' : ''}
                      {fmt(txn.amount, txn.currency)}
                    </strong>
                    <button
                      type="button"
                      className="btn soft"
                      aria-label={`${t.me.edit} ${txn.note ?? label(txn.category)}`}
                      onClick={() => setEditing(txn)}
                    >
                      {t.me.edit}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      aria-label={`${t.me.delete} ${txn.note ?? label(txn.category)}`}
                      onClick={() => void remove(txn)}
                    >
                      {t.me.delete}
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function EntryEditor({
  txn,
  currency,
  today,
  scope,
  onDone,
}: {
  txn: PersonalTxn | null;
  currency: string;
  today: string;
  scope: string;
  onDone: () => void;
}) {
  const { t } = useStrings();
  const { mutate } = useSync();
  const cur = txn?.currency ?? currency;
  const [form, setForm] = useState<EntryForm>({
    kind: txn?.kind ?? 'expense',
    amountText: txn ? toMajorString({ minor: txn.amount, currency: cur as CurrencyCode }) : '',
    category: txn?.category ?? null,
    note: txn?.note ?? '',
    date: txn?.date ?? today,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EntryForm>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    const data = entryData(form, cur, txn ?? undefined);
    if (!data) {
      setError(t.me.form.badAmount);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await mutate(MutationKind.PersonalUpsert, scope, {
        recordId: txn?.id ?? crypto.randomUUID(),
        recordKind: 'txn',
        data,
      });
      onDone();
    } catch (caught) {
      setError(
        friendlyError(caught, 'web.me.save', {
          fallback: t.me.form.couldNotSave,
          offline: t.errors.offline,
        }),
      );
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-label={txn ? t.me.form.editTitle : t.me.form.addTitle}>
      <div className="panel-head">
        <h2>{txn ? t.me.form.editTitle : t.me.form.addTitle}</h2>
      </div>
      <div
        className="people"
        role="group"
        aria-label={t.me.form.expense + ' / ' + t.me.form.income}
      >
        {(['expense', 'income'] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className="chip"
            aria-pressed={form.kind === kind}
            onClick={() => set({ kind })}
          >
            {kind === 'expense' ? t.me.form.expense : t.me.form.income}
          </button>
        ))}
      </div>
      <label>
        <span className="meta">
          {t.me.form.amount} ({cur})
        </span>
        <input
          value={form.amountText}
          inputMode="decimal"
          onChange={(event) => set({ amountText: event.target.value })}
        />
      </label>
      <label>
        <span className="meta">{t.me.form.note}</span>
        <input value={form.note} onChange={(event) => set({ note: event.target.value })} />
      </label>
      <label>
        <span className="meta">{t.me.form.date}</span>
        <input
          type="date"
          value={form.date}
          onChange={(event) => set({ date: event.target.value })}
        />
      </label>
      <div className="people" role="group" aria-label={t.me.form.category}>
        {CATEGORIES.map((option) => (
          <button
            key={option.id}
            type="button"
            className="chip"
            aria-pressed={form.category === option.id}
            onClick={() => set({ category: form.category === option.id ? null : option.id })}
          >
            {t.categories[option.id]}
          </button>
        ))}
      </div>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn brand" disabled={busy} onClick={() => void save()}>
          {t.me.form.save}
        </button>
        <button type="button" className="btn soft" onClick={onDone}>
          {t.me.form.cancel}
        </button>
      </div>
    </section>
  );
}
