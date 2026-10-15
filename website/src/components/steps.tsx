import Image from 'next/image';

import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight } from './icons';
import { Kicker, SectionTitle } from './ui';

const art = ['/home/how-add.webp', '/home/how-split.webp', '/home/how-track.webp'];
const badge = ['#6f8cf7', '#7f63f1', '#9461ee'];

export function Steps({ t }: { t: Dictionary['how'] }) {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-20 py-12 lg:py-16">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <Kicker>{t.eyebrow}</Kicker>
        <SectionTitle id="how-title" className="mt-2">
          {t.title}
        </SectionTitle>
        <p className="mt-2 max-w-sm text-[0.95rem] leading-relaxed text-ink-2">{t.subtitle}</p>

        <ol className="mt-7 grid gap-4 md:grid-cols-[1fr_auto_1fr_auto_1fr] md:items-center md:gap-3">
          {t.steps.map((step, i) => (
            <li key={step.title} className="contents">
              <div className="overflow-hidden rounded-[1.4rem] bg-surface shadow-[var(--w-shadow-card)]">
                <div className="flex gap-3 p-5 pb-3">
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-semibold text-white"
                    style={{ background: badge[i] }}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-[1rem] font-semibold text-ink">{step.title}</h3>
                    <p className="mt-1 text-[0.88rem] leading-snug text-ink-2">{step.body}</p>
                  </div>
                </div>
                <div className="art-plate relative mx-3 mb-3 aspect-[7/4] overflow-hidden rounded-2xl">
                  <Image
                    src={art[i]!}
                    alt={step.alt}
                    fill
                    sizes="(min-width: 768px) 22rem, 90vw"
                    className="art-blend object-cover [mask-image:linear-gradient(to_right,transparent,#000_9%,#000_91%,transparent)]"
                  />
                </div>
              </div>
              {i < t.steps.length - 1 ? (
                <ArrowRight className="hidden h-5 w-5 text-accent md:block rtl:-scale-x-100" />
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
