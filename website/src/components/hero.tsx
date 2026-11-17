import type { Dictionary } from '@/i18n/dictionaries';
import { site } from '@/lib/site';
import { HeroDemo } from './hero-demo';
import { OrbitBg } from './orbit-bg';
import { StoreBadges } from './store-badges';
import { Button } from './ui';

/** The Orbit hero (website/design.md): thin headline on the left, an interactive voice example on the right. */
export function Hero({ t, stores }: { t: Dictionary['hero']; stores: Dictionary['stores'] }) {
  return (
    <section className="on-dark relative isolate overflow-hidden bg-[linear-gradient(160deg,#0E0B2A_0%,#150F45_60%,#1B1150_100%)] text-white">
      <OrbitBg />
      {/* Scrim so the copy never sits on the brightest part of a ribbon. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(14_11_42_/_0.75),transparent_55%)] rtl:bg-[linear-gradient(to_left,rgb(14_11_42_/_0.75),transparent_55%)]"
      />
      <div className="mx-auto grid w-full max-w-[80rem] items-center gap-10 px-5 pt-28 pb-14 sm:px-8 lg:min-h-[44rem] lg:grid-cols-[minmax(0,0.54fr)_minmax(0,0.46fr)] lg:gap-8 lg:pt-32 lg:pb-20">
        <div className="min-w-0">
          <p className="font-mono text-[0.75rem] tracking-[0.14em] text-[#FFB199] uppercase rtl:tracking-normal">
            {t.eyebrow}
          </p>
          <h1 className="mt-5 font-display text-[2.8rem] leading-[1.04] font-extralight tracking-[-0.03em] text-balance sm:text-[4.2rem] lg:text-[4.2rem] rtl:tracking-normal rtl:sm:text-[3.4rem] rtl:lg:text-[3.8rem]">
            {t.titleStart} <span className="font-light text-[#FF7A59]">{t.titleAccent}</span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-[1.1rem] leading-[1.55] font-light text-[#C9C3E6]">
            {t.subtitle}
          </p>
          <ul className="mt-6 flex flex-wrap gap-2.5">
            {t.trust.map((item) => (
              <li
                key={item}
                className="rounded-full border border-white/12 bg-white/[0.07] px-3.5 py-1.5 font-mono text-[0.75rem] text-[#D9D4F5]"
              >
                {item}
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button href={site.appUrl} external size="lg">
              {t.ctaPrimary}
            </Button>
            <a
              href="#how"
              className="inline-flex h-12 items-center rounded-md border border-white/20 px-6 text-[0.9375rem] font-medium text-white transition-colors hover:bg-white/10"
            >
              {t.ctaSecondary}
            </a>
          </div>
          <StoreBadges t={stores} className="mt-6" />
        </div>

        <HeroDemo t={t.demo} />
      </div>
    </section>
  );
}
