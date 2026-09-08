import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight, Users } from './icons';

/**
 * The product, drawn at desktop scale rather than shrunk into a phone bezel —
 * a phone mockup floating on a gradient is the 2018 tell, and it makes the one
 * image everybody sees too small to read.
 *
 * Two fragments, two treatments: a solid ledger panel that proves the product
 * is real, and a stroke-only settle card overlapping it that proves what the
 * product is *for*. The amounts are set in the mono with tabular figures, and
 * every direction is carried by a word and a sign as well as by colour.
 */
export function LedgerCard({ t }: { t: Dictionary['hero']['card'] }) {
  return (
    <div
      role="img"
      aria-label={t.alt}
      className="relative mx-auto w-full max-w-[26rem] lg:max-w-none"
    >
      <div className="panel-raised overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem] font-semibold text-ink">{t.title}</p>
            <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[0.6875rem] text-ink-3">
              <Users className="h-3 w-3" aria-hidden="true" />
              {t.members}
            </p>
          </div>
          <span className="shrink-0 rounded-sm bg-chip px-1.5 py-0.5 font-mono text-[0.6875rem] text-ink-2">
            {t.dates}
          </span>
        </header>

        {/* The balance. The label carries the direction, so the colour is
            reinforcement rather than the only signal. */}
        <div className="border-b border-line px-5 py-5">
          <p className="font-mono text-[0.6875rem] tracking-[0.1em] text-ink-3 uppercase">
            {t.balanceLabel}
          </p>
          {/*
           * The sign has to stay welded to the number. In an Arabic paragraph
           * a leading "+" is a neutral character and the bidi algorithm
           * happily reorders it to the far side of the digits, so the amount
           * is isolated as its own left-to-right run.
           */}
          <p
            dir="ltr"
            className="mt-1.5 font-mono tabular text-[2.125rem] leading-none font-medium tracking-[-0.03em] text-up [unicode-bidi:isolate] rtl:text-end"
          >
            +{t.balance}
          </p>
        </div>

        <ul className="divide-y divide-divider">
          {t.rows.map((row) => (
            <li key={row.title} className="flex items-baseline gap-3 px-5 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[0.875rem] text-ink">{row.title}</span>
                <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-ink-3">
                  {row.meta}
                </span>
              </span>
              <span className="shrink-0 font-mono tabular text-[0.875rem] text-ink-2">
                {row.amount}
              </span>
            </li>
          ))}
        </ul>

        {/* The second currency is the point of the row above it: a foreign bill
            converted at the rate the trip actually got. */}
        <p className="flex items-center justify-between gap-3 border-t border-line bg-chip px-5 py-2.5 font-mono text-[0.6875rem] text-ink-3">
          <span>{t.rateLabel}</span>
          <span className="tabular text-ink-2">{t.rate}</span>
        </p>
      </div>

      {/*
       * The second fragment, offset past the panel's end edge so the pair reads
       * as two layers rather than one box. It deliberately does not overlap the
       * panel: the rows underneath are the multi-currency demonstration, which
       * is the whole reason the card is there, and covering them to look
       * composed would be trading the argument for the styling.
       */}
      <div className="relative z-10 mt-3 ms-auto me-4 w-[15.5rem] rounded-lg border border-line-strong bg-bg p-4 shadow-[var(--w-shadow-lg)] sm:-me-6 lg:-me-10">
        <p className="font-mono text-[0.6875rem] tracking-[0.1em] text-ink-3 uppercase">
          {t.settleLabel}
        </p>
        <p className="mt-1.5 text-[0.9375rem] text-ink">
          {t.settleLine}{' '}
          <span className="font-mono tabular font-medium text-ink">{t.settleAmount}</span>
        </p>
        <span className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[0.8125rem] font-medium text-accent-ink">
          {t.settleCta}
          <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
