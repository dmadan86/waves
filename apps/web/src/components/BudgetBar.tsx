'use client';

/**
 * A budget, and how far into it the trip is.
 *
 * Three readings, and the third is the one that matters: the bar is capped at
 * full, so a trip 25% over budget and one exactly on it draw the same bar. The
 * signed gap under it — "₹4,000 over" rather than "₹4,000 left" — is what
 * carries the overflow, because a bar cannot.
 *
 * `budgetProgress` in `@waves/core` decides all of it, including that a cap of
 * zero with spend against it is full while a cap of zero with nothing spent is
 * empty. Nothing is computed here; this paints what it was handed.
 */

import type { BudgetProgress } from '@waves/core';

import { useStrings } from '@/i18n-context';
import { money } from '@/lib/money';

export function BudgetBar({
  label,
  progress,
  locale,
  badge,
}: {
  label: string;
  progress: BudgetProgress;
  locale: string;
  /** A short note beside the name — "Only me", say. */
  badge?: string;
}) {
  const { t } = useStrings();
  const gap = progress.remainingMinor < 0n ? -progress.remainingMinor : progress.remainingMinor;

  return (
    <div className="budget">
      <div className="budget-head">
        <span className="budget-label">
          {label}
          {badge ? <span className="budget-badge">{badge}</span> : null}
        </span>
        <span className="budget-figures">
          {money(progress.spentMinor, progress.currency, locale)}
          <span className="faint"> / </span>
          {money(progress.capMinor, progress.currency, locale)}
        </span>
      </div>
      {/* The track is decoration: the figures above and the gap below both say
          the same thing in words, so a screen reader is told to skip it rather
          than read a width out. */}
      <span className="budget-track" aria-hidden>
        <span
          className={progress.over ? 'budget-fill over' : 'budget-fill'}
          style={{ width: `${Math.max(0, Math.min(1, progress.ratio)) * 100}%` }}
        />
      </span>
      <span className={progress.over ? 'budget-gap over' : 'budget-gap'}>
        {money(gap, progress.currency, locale)} {progress.over ? t.budgets.over : t.budgets.left}
      </span>
    </div>
  );
}
