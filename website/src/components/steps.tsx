import Image from 'next/image';

import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight, Check, Receipt, Users } from './icons';
import { Button, Kicker } from './ui';

const icons = [Receipt, Users, Check];
/** The first two steps in the brand wash, the last one green: settled. */
const tint = ['bg-accent-wash text-accent', 'bg-accent-wash text-accent', 'bg-up/12 text-up'];

export function Steps({ t, appUrl }: { t: Dictionary['how']; appUrl: string }) {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-20 py-12 lg:py-16">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="grid items-center gap-6 md:grid-cols-[1.15fr_1fr]">
          <div>
            <Kicker>{t.eyebrow}</Kicker>
            <h2
              id="how-title"
              className="mt-3 text-balance text-[2.1rem] font-bold leading-[1.08] tracking-[-0.02em] text-ink sm:text-[3.2rem]"
            >
              {t.title}
            </h2>
            <p className="mt-4 max-w-md text-[1.05rem] leading-relaxed text-ink-2 sm:text-[1.2rem]">
              {t.subtitle}
            </p>
            <Button href={appUrl} external size="lg" arrow={false} className="mt-7">
              {t.cta}
            </Button>
          </div>
          {/* The art is drawn on a pale wash, so it sits in its own light panel on either theme. */}
          <div className="relative mx-auto aspect-[680/560] w-full max-w-[30rem] overflow-hidden rounded-[1.6rem]">
            <Image
              src="/home/how-settled.webp"
              alt={t.artAlt}
              fill
              unoptimized
              sizes="(min-width: 768px) 30rem, 90vw"
              className="object-contain"
            />
          </div>
        </div>

        <div className="mt-8 rounded-[1.6rem] bg-surface p-6 shadow-[var(--w-shadow-card)] sm:p-8">
          <h3 className="text-[1.6rem] font-bold tracking-[-0.015em] text-ink sm:text-[2rem]">
            {t.simple}
          </h3>
          <ol className="mt-6 grid gap-5 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center md:gap-4">
            {t.steps.map((step, i) => {
              const Icon = icons[i]!;
              return (
                <li key={step.title} className="contents">
                  <div className="flex items-center gap-4">
                    <span
                      className={`grid h-14 w-14 shrink-0 place-items-center rounded-full ${tint[i]}`}
                    >
                      <Icon className="h-7 w-7" />
                    </span>
                    <div>
                      <p className="text-[1.05rem] font-semibold text-ink">{step.title}</p>
                      <p className="mt-1 text-[0.92rem] leading-snug text-ink-2">{step.body}</p>
                    </div>
                  </div>
                  {i < t.steps.length - 1 ? (
                    <ArrowRight className="hidden h-5 w-5 text-ink-3 md:block rtl:-scale-x-100" />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
