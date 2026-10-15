import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight, Check, Cloud, CloudOff, Cup, Mic, Mountain, Plane } from './icons';
import { Kicker } from './ui';

const scenarioIcons = [Plane, Mountain, Cup];

/**
 * "Works offline". The product claim is the offline-first ledger (ADR-005): an
 * entry is written to the phone's queue and shown at once, the sync engine sends
 * the queue in order when the network is back, a refusal stays visible with
 * retry or discard, and receipt photos wait in their own upload queue. The
 * picture is CSS and text only, and static: the two chips are the app's two
 * states, not an animation.
 */
export function OfflineBand({ t }: { t: Dictionary['offline'] }) {
  return (
    <section id="offline" aria-labelledby="offline-title" className="scroll-mt-20 py-6 lg:py-8">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="overflow-hidden rounded-[1.75rem] bg-surface p-5 shadow-[var(--w-shadow-card)] sm:p-7">
          <div className="grid items-start gap-6 lg:grid-cols-[1fr_1.05fr] lg:gap-10">
            <div>
              <Kicker>{t.eyebrow}</Kicker>
              <h2
                id="offline-title"
                className="mt-1.5 text-balance text-[1.5rem] leading-[1.15] font-bold tracking-[-0.02em] text-ink sm:text-[1.9rem]"
              >
                {t.title}
              </h2>
              <p className="mt-2.5 text-[0.92rem] leading-[1.6] text-ink-2">{t.body}</p>

              <ul className="mt-5 space-y-2.5">
                {t.scenarios.map((item, i) => {
                  const Icon = scenarioIcons[i]!;
                  return (
                    <li key={item.title} className="flex items-start gap-3">
                      <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-wash text-accent">
                        <Icon className="h-[1.1rem] w-[1.1rem]" />
                      </span>
                      <span>
                        <span className="block text-[0.92rem] font-semibold text-ink">
                          {item.title}
                        </span>
                        <span className="block text-[0.86rem] leading-snug text-ink-2">
                          {item.body}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="rounded-3xl bg-bg p-3 shadow-[var(--w-shadow-sm)] sm:p-4">
              <p className="px-1 text-[0.8rem] font-semibold text-ink">{t.demoTitle}</p>

              <div className="mt-2.5 rounded-2xl bg-surface p-3 shadow-[var(--w-shadow-sm)]">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[0.76rem] text-ink-3">
                    <CloudOff className="h-4 w-4" />
                    {t.offlineCaption}
                  </span>
                  <span className="inline-flex h-7 items-center rounded-full bg-chip px-3 text-[0.76rem] font-semibold text-ink-2 ring-1 ring-line-strong ring-inset">
                    <span className="me-1.5 h-1.5 w-1.5 rounded-full bg-ink-3" aria-hidden="true" />
                    {t.chipOffline}
                  </span>
                </div>
                <ul className="mt-2.5 divide-y divide-divider">
                  {t.items.map((item) => (
                    <li key={item.title} className="flex items-center gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[0.88rem] font-medium text-ink">
                          {item.title}
                        </span>
                        <span className="block truncate text-[0.74rem] text-ink-3">
                          {item.meta}
                        </span>
                      </span>
                      <bdi className="text-[0.88rem] font-semibold text-ink tabular-nums">
                        {item.amount}
                      </bdi>
                      <span className="inline-flex h-6 shrink-0 items-center rounded-full border border-dashed border-line-strong px-2 text-[0.68rem] font-medium text-ink-3">
                        {t.waiting}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex justify-center py-1.5 text-accent">
                <ArrowRight className="h-5 w-5 rotate-90" />
              </div>

              <div className="rounded-2xl bg-surface p-3 shadow-[var(--w-shadow-sm)]">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
                  <span className="inline-flex items-center gap-1.5 text-[0.76rem] text-ink-3">
                    <Cloud className="h-4 w-4" />
                    {t.syncedCaption}
                  </span>
                  <span className="inline-flex h-7 items-center rounded-full bg-accent px-3 text-[0.76rem] font-semibold text-accent-ink">
                    <Check className="me-1 h-3.5 w-3.5" />
                    {t.chipSynced}
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl bg-accent-wash px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[0.88rem] font-medium text-ink">
                      {t.balanceLabel}
                    </span>
                    <span className="block text-[0.74rem] text-ink-2">{t.balanceNote}</span>
                  </span>
                  <bdi className="text-[1.1rem] font-bold text-accent tabular-nums">
                    {t.balanceAmount}
                  </bdi>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-5 border-t border-line/70 pt-4 lg:grid-cols-2 lg:gap-10">
            <div>
              <p className="text-[0.82rem] font-semibold text-ink">{t.pointsTitle}</p>
              <ul className="mt-2.5 space-y-2">
                {t.points.map((line) => (
                  <li key={line} className="flex items-start gap-2 text-[0.86rem] text-ink-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                    {line}
                  </li>
                ))}
              </ul>
            </div>
            <div className="flex items-start gap-3 rounded-2xl bg-accent-wash p-4">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink">
                <Mic className="h-[1.1rem] w-[1.1rem]" />
              </span>
              <div>
                <p className="text-[0.92rem] font-semibold text-ink">{t.voiceTitle}</p>
                <p className="mt-1 text-[0.86rem] leading-[1.55] text-ink-2">{t.voiceBody}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
