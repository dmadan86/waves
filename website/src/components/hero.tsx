import type { Dictionary } from '@/i18n/dictionaries';
import { Check } from './icons';
import { SplitStage } from './split-stage';
import { StoreBadges } from './store-badges';

export function Hero({ t, stores }: { t: Dictionary['hero']; stores: Dictionary['stores'] }) {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden="true"
        className="hero-glow pointer-events-none absolute -z-10 aspect-square w-[44rem] max-w-none -translate-y-1/4 max-lg:top-56 max-lg:start-1/2 max-lg:-translate-x-1/2 lg:-top-24 lg:-end-40"
      />
      <div className="mx-auto grid w-full max-w-[73rem] items-center gap-10 px-5 pt-24 pb-10 sm:px-8 lg:min-h-[42rem] lg:grid-cols-[minmax(0,0.46fr)_minmax(0,0.54fr)] lg:gap-8 lg:pt-28 lg:pb-24">
        <div className="min-w-0">
          <p className="text-[0.72rem] font-semibold tracking-[0.14em] text-accent uppercase rtl:tracking-normal">
            {t.eyebrow}
          </p>
          <h1 className="display mt-4 text-[2.9rem] text-balance text-ink sm:text-[4.4rem] lg:text-[5rem] rtl:sm:text-[3.6rem] rtl:lg:text-[4.1rem]">
            {t.titleStart} <span className="text-accent">{t.titleAccent}</span>
          </h1>
          <p className="mt-6 max-w-[28rem] text-[1.05rem] leading-[1.6] text-ink-2">{t.subtitle}</p>
          <StoreBadges t={stores} className="mt-8" />
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
            {t.trust.map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5 text-[0.82rem] text-ink-2">
                <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-[#237a60] text-white">
                  <Check className="h-2.5 w-2.5" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div className="w-full max-w-[34rem] min-w-0 justify-self-center lg:justify-self-end">
          <SplitStage t={t.split} />
        </div>
      </div>
    </section>
  );
}
