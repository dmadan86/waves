import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight, Users } from './icons';

export function LedgerCard({ t }: { t: Dictionary['hero']['card'] }) {
  return (
    <div role="img" aria-label={t.alt} className="relative mx-auto w-full max-w-[34rem]">
      <div
        aria-hidden="true"
        className="absolute -inset-8 rounded-[2.5rem] bg-brand-500/10 blur-3xl"
      />

      <div className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-[#121016] shadow-[0_32px_90px_rgb(10_7_18_/_0.32)]">
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-[0.95rem] font-semibold text-white">{t.title}</p>
            <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[0.67rem] text-white/55">
              <Users className="h-3 w-3" aria-hidden="true" />
              {t.members}
            </p>
          </div>
          <span className="rounded-full bg-white/6 px-2 py-1 font-mono text-[0.66rem] text-white/55">
            {t.dates}
          </span>
        </div>

        <div className="grid gap-4 p-4 sm:p-5">
          <div className="relative overflow-hidden rounded-[1.25rem] bg-[linear-gradient(135deg,#6242DE_0%,#6242DE_55%,#4326A6_100%)] p-5 sm:p-6">
            <div
              aria-hidden="true"
              className="absolute -end-16 -top-20 h-48 w-48 rounded-full bg-white/14 blur-3xl"
            />
            <p className="font-mono text-[0.66rem] tracking-[0.1em] text-white uppercase">
              {t.balanceLabel}
            </p>
            <p
              dir="ltr"
              className="mt-2 font-mono tabular text-[2.7rem] leading-none font-medium tracking-[-0.05em] text-white [unicode-bidi:isolate] rtl:text-end"
            >
              +{t.balance}
            </p>
            <div className="mt-5 inline-flex items-center gap-2 rounded-full bg-black/20 px-3 py-2 text-[0.72rem] font-medium text-white">
              {t.settleCta}
              <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
            </div>
          </div>

          <div className="overflow-hidden rounded-[1.1rem] border border-white/8 bg-white/[0.035]">
            <ul className="divide-y divide-white/7">
              {t.rows.map((row) => (
                <li key={row.title} className="flex items-baseline gap-3 px-4 py-3.5 sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.84rem] text-white/90">{row.title}</span>
                    <span className="mt-0.5 block truncate font-mono text-[0.66rem] text-white/55">
                      {row.meta}
                    </span>
                  </span>
                  <span className="shrink-0 font-mono tabular text-[0.82rem] text-white/80">
                    {row.amount}
                  </span>
                </li>
              ))}
            </ul>
            <p className="flex items-center justify-between gap-3 border-t border-white/7 bg-black/15 px-4 py-3 font-mono text-[0.66rem] text-white/55 sm:px-5">
              <span>{t.rateLabel}</span>
              <span className="tabular text-white/65">{t.rate}</span>
            </p>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-[1.1rem] border border-white/8 bg-white/[0.035] px-4 py-3.5">
            <div>
              <p className="font-mono text-[0.66rem] tracking-[0.08em] text-white/55 uppercase">
                {t.settleLabel}
              </p>
              <p className="mt-1 text-[0.9rem] text-white/85">
                {t.settleLine}{' '}
                <span className="font-mono tabular font-medium text-white">{t.settleAmount}</span>
              </p>
            </div>
            <span className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-[0.72rem] font-semibold text-[#2c1d73]">
              {t.settleCta}
              <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
