import type { Dictionary } from '@/i18n/dictionaries';
import { StoreBadges } from './store-badges';
import { Button, Container } from './ui';

/**
 * The restraint is the device. One headline, one line beneath it, one button,
 * and the qualifying sentence that stops the button overselling.
 */
export function FinalCta({
  t,
  stores,
  appUrl,
}: {
  t: Dictionary['cta'];
  stores: Dictionary['hero']['stores'];
  appUrl: string;
}) {
  return (
    <section className="border-t border-line py-24 sm:py-32">
      <Container>
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-balance text-[2.125rem] leading-[1.06] font-semibold tracking-[-0.035em] text-ink sm:text-[3rem]">
            {t.title}
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-pretty text-[1.0625rem] leading-relaxed text-ink-2">
            {t.subtitle}
          </p>

          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button href={appUrl} external size="lg">
              {t.primary}
            </Button>
            <Button href={appUrl} external variant="quiet" size="lg">
              {t.secondary}
            </Button>
          </div>

          <div className="mt-7 flex justify-center empty:mt-0">
            {/* Only real store links belong here; the "coming to the stores"
                line already runs in the hero and would just repeat. */}
            <StoreBadges t={stores} linksOnly />
          </div>

          <p className="mt-7 font-mono text-[0.75rem] leading-relaxed text-ink-3">{t.note}</p>
        </div>
      </Container>
    </section>
  );
}
