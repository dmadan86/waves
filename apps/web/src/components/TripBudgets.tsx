'use client';

/**
 * The three ceilings a trip can carry, and the two readings taken against them.
 *
 * **The whole trip's**, which only an admin sets — enforced in the RPC, not
 * here; the button is hidden for everybody else because offering an action that
 * will be refused is worse than not offering it, but the hiding is courtesy,
 * not security.
 *
 * **Each member's own**, which anybody sets for themselves, privately or shared.
 * What arrives from the server is already what this reader may see — the select
 * policy is `is_group_member AND (visibility = 'group' OR it is mine)` — so
 * nothing is filtered here. A client that filtered would be trusted to.
 *
 * Then **the forecast** ("at this pace the trip lands at ₹65,000, ₹5,000 over")
 * and **fairness** ("Ravi has fronted 62% — Priya could take the next one").
 * Both are `@waves/core`'s, both per currency, and neither ever mixes two.
 *
 * A budget is a ceiling on *spend*, not a balance: it never moves what anybody
 * owes, and clearing one changes no money.
 */

import { useState } from 'react';

import {
  parseMajor,
  toMajorString,
  money as coreMoney,
  type BudgetProgress,
  type CurrencyFairness,
  type Forecast,
} from '@waves/core';

import { BudgetBar } from '@/components/BudgetBar';
import { useStrings } from '@/i18n-context';
import { fill } from '@/i18n';
import { money } from '@/lib/money';

/** One member's budget, resolved to a name and a standing. */
export interface MemberBudget {
  readonly memberId: string;
  readonly name: string;
  readonly isMine: boolean;
  readonly shared: boolean;
  readonly progress: BudgetProgress;
}

export function TripBudgets({
  currency,
  locale,
  busy,
  canSetOverall,
  overall,
  memberBudgets,
  forecasts,
  fairness,
  nameOf,
  onSetOverall,
  onSetMine,
  onClearMine,
}: {
  /** The group's default — what an amount typed with no currency means. */
  currency: string;
  locale: string;
  busy: boolean;
  /** Admins only. The RPC checks it too; this just hides a refusal. */
  canSetOverall: boolean;
  overall: BudgetProgress | null;
  memberBudgets: readonly MemberBudget[];
  forecasts: readonly Forecast[];
  fairness: readonly CurrencyFairness[];
  nameOf: (memberId: string) => string;
  onSetOverall: (amountMinor: bigint | null) => void;
  onSetMine: (amountMinor: bigint, shared: boolean) => void;
  onClearMine: () => void;
}) {
  const { t } = useStrings();
  const mine = memberBudgets.find((budget) => budget.isMine) ?? null;
  const others = memberBudgets.filter((budget) => !budget.isMine);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{t.budgets.title}</h2>
      </div>

      <BudgetRow
        label={t.budgets.overall}
        currency={currency}
        locale={locale}
        busy={busy}
        progress={overall}
        editable={canSetOverall}
        onSave={(amountMinor) => onSetOverall(amountMinor)}
        onClear={() => onSetOverall(null)}
      />

      <BudgetRow
        label={t.budgets.mine}
        currency={currency}
        locale={locale}
        busy={busy}
        progress={mine?.progress ?? null}
        editable
        withVisibility
        sharedNow={mine?.shared ?? false}
        badge={mine && !mine.shared ? t.budgets.onlyMe : undefined}
        onSave={(amountMinor, shared) => onSetMine(amountMinor, shared)}
        onClear={onClearMine}
      />

      {/* Everybody who chose to share theirs. Nobody's private row is here to
          leave out — RLS dropped it before it reached the browser. */}
      {others.map((budget) => (
        <BudgetBar
          key={budget.memberId}
          label={budget.name}
          progress={budget.progress}
          locale={locale}
        />
      ))}

      {forecasts.length > 0 ? (
        <div className="budget-note">
          <h3 className="row-heading">{t.budgets.forecast}</h3>
          {forecasts.map((row) => (
            <p key={row.currency} className="meta">
              {t.budgets.projectedTotal}:{' '}
              <strong>{money(row.projectedTotalMinor, row.currency, locale)}</strong>
              {row.onTrack === true ? ` · ${t.budgets.onTrack}` : null}
              {row.onTrack === false && row.projectedOverrunMinor !== null ? (
                <span className="tone-negative">
                  {' '}
                  ·{' '}
                  {money(
                    row.projectedOverrunMinor < 0n
                      ? -row.projectedOverrunMinor
                      : row.projectedOverrunMinor,
                    row.currency,
                    locale,
                  )}{' '}
                  {t.budgets.over}
                </span>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}

      {fairness.length > 0 ? (
        <div className="budget-note">
          <h3 className="row-heading">{t.budgets.fairness}</h3>
          {fairness.map((block) => (
            <p key={block.currency} className="meta">
              {block.overpayer
                ? fill(t.budgets.paidShare, {
                    name: nameOf(block.overpayer.member),
                    percent: String(Math.round(block.overpayer.paidRatio * 100)),
                  })
                : t.budgets.evenlyMatched}
              {block.nextPayer ? (
                <>
                  {' · '}
                  <span className="tone-brand">
                    {fill(t.budgets.nextUp, { name: nameOf(block.nextPayer) })}
                  </span>
                </>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/**
 * One editable budget: its bar when it is set, an invitation when it is not,
 * and the little form either way.
 *
 * The amount is held as text and parsed on save, never as a number: a budget is
 * money, and money does not go through a float on its way to the ledger. An
 * amount that will not parse leaves the form open rather than saving a zero.
 */
function BudgetRow({
  label,
  currency,
  locale,
  busy,
  progress,
  editable,
  withVisibility,
  sharedNow,
  badge,
  onSave,
  onClear,
}: {
  label: string;
  currency: string;
  locale: string;
  busy: boolean;
  progress: BudgetProgress | null;
  editable: boolean;
  withVisibility?: boolean;
  sharedNow?: boolean;
  badge?: string;
  onSave: (amountMinor: bigint, shared: boolean) => void;
  onClear: () => void;
}) {
  const { t } = useStrings();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [shared, setShared] = useState(sharedNow ?? false);
  const [bad, setBad] = useState(false);

  const start = () => {
    // Prefilled with what is there, in major units — somebody changing a budget
    // is usually adjusting it, not retyping it.
    setText(progress ? toMajorString(coreMoney(progress.capMinor, progress.currency)) : '');
    setShared(sharedNow ?? false);
    setBad(false);
    setOpen(true);
  };

  const save = () => {
    let minor: bigint;
    try {
      minor = parseMajor(text.trim(), currency).minor;
    } catch {
      setBad(true);
      return;
    }
    onSave(minor, shared);
    setOpen(false);
  };

  return (
    <div className="budget-row">
      {progress ? (
        <BudgetBar label={label} progress={progress} locale={locale} badge={badge} />
      ) : (
        <div className="budget-head">
          <span className="budget-label">{label}</span>
          <span className="faint">{money(0n, currency, locale)}</span>
        </div>
      )}

      {editable && !open ? (
        <div className="budget-actions">
          <button type="button" className="linklike" onClick={start} disabled={busy}>
            {progress ? t.budgets.edit : t.budgets.set}
          </button>
          {progress ? (
            <button type="button" className="linklike" onClick={onClear} disabled={busy}>
              {t.budgets.clear}
            </button>
          ) : null}
        </div>
      ) : null}

      {open ? (
        <form
          className="budget-form"
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <input
            className={bad ? 'split-input bad' : 'split-input'}
            value={text}
            inputMode="decimal"
            autoFocus
            aria-label={`${label} — ${t.budgets.amount}`}
            aria-invalid={bad || undefined}
            placeholder={t.budgets.amount}
            onChange={(event) => {
              setText(event.target.value);
              setBad(false);
            }}
          />
          {withVisibility ? (
            <label className="budget-share">
              <input
                type="checkbox"
                checked={shared}
                onChange={(event) => setShared(event.target.checked)}
              />
              {t.budgets.shareWithGroup}
            </label>
          ) : null}
          <span className="budget-form-actions">
            <button type="submit" className="btn brand" disabled={busy}>
              {t.budgets.save}
            </button>
            <button type="button" className="btn soft" onClick={() => setOpen(false)}>
              {t.plan.cancel}
            </button>
          </span>
        </form>
      ) : null}
    </div>
  );
}
