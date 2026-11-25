import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { Check } from './icons';
import { Button, Kicker } from './ui';

/** "Couples and families": the home page's pointer to /home. Stated in full there. */
export function HomeBand({ t, locale }: { t: Dictionary['homeBand']; locale: Locale }) {
  return (
    <section id="family" aria-labelledby="family-title" className="scroll-mt-20 py-6 lg:py-8">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="agents-card overflow-hidden rounded-[1.75rem] p-5 shadow-[var(--w-shadow-card)] sm:p-7">
          <div className="max-w-2xl">
            <Kicker>{t.eyebrow}</Kicker>
            <h2
              id="family-title"
              className="display mt-1.5 text-balance text-[2rem] text-ink sm:text-[2.6rem]"
            >
              {t.title}
            </h2>
            <p className="mt-2.5 text-[0.92rem] leading-[1.6] text-ink-2">{t.body}</p>
            <ul className="mt-4 space-y-2">
              {t.points.map((p) => (
                <li key={p} className="flex items-start gap-2 text-[0.88rem] text-ink">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                  {p}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
              <Button href={`/${locale}/home`} size="lg">
                {t.cta}
              </Button>
              <p className="text-[0.8rem] text-ink-3">{t.availability}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
