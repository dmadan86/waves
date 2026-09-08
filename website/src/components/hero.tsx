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
    <section className="relative overflow-hidden border-b border-line pt-24 pb-14 sm:pt-28 sm:pb-20">
      {/*
       * Ruled paper, faint, behind the whole opening. It is the ledger's own
       * texture rather than a decorative glow, and it stops at the fold so the
       * rest of the page reads as a different surface.
       */}
      <div
        aria-hidden="true"
        className="ruled pointer-events-none absolute inset-0 -z-10 opacity-60 [--rule:32px] [mask-image:linear-gradient(to_bottom,#000_20%,transparent_92%)]"
      />

      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-[1fr_0.92fr] lg:gap-16">
          <div>
            <Reveal>
              <a
                href="#pricing"
                className="inline-flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 font-mono text-[0.6875rem] tracking-[0.06em] text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink"
              >
                <span
                  aria-hidden="true"
                  className="animate-blink h-1.5 w-1.5 rounded-full bg-accent"
                />
                {banner.text}
                {/* The pill's text is a statement; without this the link has no
                    stated destination. */}
                <span className="text-accent">{banner.link}</span>
              </a>
            </Reveal>

            <Reveal delay={50}>
              <h1 className="mt-7 text-balance text-[2.75rem] leading-[1.02] font-semibold tracking-[-0.04em] text-ink sm:text-[3.75rem] lg:text-[4.25rem]">
                {t.titleLine1}
                <br />
                <span className="text-accent">{t.titleAccent}</span>
              </h1>
            </Reveal>

            <Reveal delay={100}>
              <p className="mt-6 max-w-lg text-pretty text-[1.0625rem] leading-[1.6] text-ink-2">
                {t.subtitle}
              </p>
            </Reveal>

            <Reveal delay={150}>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button href={appUrl} external size="lg">
                  {t.ctaPrimary}
                </Button>
                <Button href="#how" variant="quiet" size="lg">
                  {t.ctaSecondary}
                </Button>
              </div>
            </Reveal>

            <Reveal delay={200}>
              <StoreBadges t={t.stores} className="mt-7" />
            </Reveal>

            <Reveal delay={240}>
              {/*
               * Four claims a sceptic can check, set as data rather than as a
               * sentence — no adjectives, no superlatives.
               */}
              <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[0.75rem] text-ink-3">
                {t.facts.map((fact) => (
                  <li key={fact} className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="text-accent">
                      ·
                    </span>
                    {fact}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delay={120} className="lg:justify-self-end lg:ps-4">
            <LedgerCard t={t.card} />
          </Reveal>
        </div>
      </Container>
    </section>
  );
}
