import type { Dictionary } from '@/i18n/dictionaries';
import { LedgerCard } from './ledger-card';
import { Reveal } from './reveal';
import { StoreBadges } from './store-badges';
import { Button, Container } from './ui';

export function Hero({
  t,
  banner,
  appUrl,
}: {
  t: Dictionary['hero'];
  banner: Dictionary['banner'];
  appUrl: string;
}) {
  return (
    <section className="noise relative overflow-hidden border-b border-line pt-28 pb-20 sm:pt-32 sm:pb-28 lg:pt-40 lg:pb-32">
      <div
        aria-hidden="true"
        className="hero-grid pointer-events-none absolute inset-x-0 top-0 h-[48rem] opacity-70"
      />
      <div aria-hidden="true" className="hero-orb pointer-events-none -end-48 top-20" />

      <Container>
        <div className="grid items-center gap-16 lg:grid-cols-[minmax(0,0.92fr)_minmax(31rem,1.08fr)] lg:gap-20">
          <div className="relative z-10 max-w-2xl">
            <Reveal>
              <a
                href="#pricing"
                className="inline-flex items-center gap-2 rounded-full border border-line bg-paper/70 px-3 py-1.5 font-mono text-[0.68rem] tracking-[0.04em] text-ink-2 shadow-[var(--w-shadow-sm)] backdrop-blur-sm transition hover:border-line-strong hover:text-ink"
              >
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_0_4px_var(--w-accent-wash)]"
                />
                <span>{banner.text}</span>
                <span className="text-accent">{banner.link} ↗</span>
              </a>
            </Reveal>

            <Reveal delay={60}>
              <h1 className="mt-8 max-w-[10ch] text-balance text-[3.6rem] leading-[0.92] font-semibold tracking-[-0.065em] text-ink sm:text-[5rem] lg:text-[6.2rem]">
                {t.titleLine1}
                <br />
                <span className="text-gradient">{t.titleAccent}</span>
              </h1>
            </Reveal>

            <Reveal delay={110}>
              <p className="mt-7 max-w-xl text-pretty text-[1.12rem] leading-[1.7] text-ink-2 sm:text-[1.2rem]">
                {t.subtitle}
              </p>
            </Reveal>

            <Reveal delay={160}>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button href={appUrl} external size="lg">
                  {t.ctaPrimary}
                </Button>
                <Button href="#how" variant="secondary" size="lg">
                  {t.ctaSecondary}
                </Button>
              </div>
            </Reveal>

            <Reveal delay={210}>
              <StoreBadges t={t.stores} className="mt-6" />
            </Reveal>

            <Reveal delay={250}>
              <ul className="mt-8 grid max-w-xl grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                {t.facts.map((fact) => (
                  <li
                    key={fact}
                    className="border-l border-accent/50 ps-3 font-mono text-[0.68rem] leading-relaxed text-ink-3"
                  >
                    {fact}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delay={130} className="relative lg:justify-self-end">
            <LedgerCard t={t.card} />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
