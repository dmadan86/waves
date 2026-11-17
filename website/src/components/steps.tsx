import type { Dictionary } from '@/i18n/dictionaries';
import { HeroScenes } from './hero-scenes';
import { Kicker } from './ui';

/**
 * "See it work": the three steps beside product screens drawn in HTML and CSS
 * (voice and receipt for Add, the group ledger for Split, the UPI handoff for
 * Settle). The panel is dark on purpose; the screens are built for it.
 */
export function Steps({ t }: { t: Dictionary['how'] }) {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-20 py-12 lg:py-16">
      <div className="mx-auto grid w-full max-w-[73rem] items-center gap-10 px-5 sm:px-8 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
        <div>
          <Kicker>{t.eyebrow}</Kicker>
          <h2
            id="how-title"
            className="display mt-3 text-balance text-[2.1rem] text-ink sm:text-[3.2rem]"
          >
            {t.title}
          </h2>
          <p className="mt-4 max-w-md text-[1.05rem] leading-relaxed text-ink-2">{t.subtitle}</p>
          <ol className="mt-8 space-y-5">
            {t.steps.map((step, i) => (
              <li key={step.title} className="flex items-start gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent font-mono text-[1rem] font-semibold text-accent-ink">
                  {i + 1}
                </span>
                <div>
                  <p className="text-[1.15rem] font-semibold text-ink">{step.title}</p>
                  <p className="mt-1 max-w-md text-[0.98rem] leading-snug text-ink-2">
                    {step.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <HeroScenes t={t.scenes} />
      </div>
    </section>
  );
}
