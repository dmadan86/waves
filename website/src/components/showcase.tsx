import Image from 'next/image';

import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight } from './icons';
import { Kicker } from './ui';

export function Showcase({ t }: { t: Dictionary['showcase'] }) {
  return (
    <section aria-labelledby="showcase-title" className="py-10 lg:py-14">
      <div className="mx-auto grid w-full max-w-[73rem] items-center gap-6 px-5 sm:px-8 lg:grid-cols-[0.85fr_1.35fr]">
        <div>
          <Kicker>{t.eyebrow}</Kicker>
          <h2
            id="showcase-title"
            className="mt-3 text-[2.6rem] leading-[1.06] font-bold tracking-[-0.035em] text-ink sm:text-[3.1rem]"
          >
            {t.title.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>
          <p className="mt-4 max-w-[22rem] text-[1rem] leading-relaxed text-ink-2">{t.body}</p>
          <a
            href="#features"
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-accent px-6 text-sm font-semibold text-accent-ink shadow-[0_10px_24px_rgb(122_90_248_/_0.28)] transition-transform hover:-translate-y-0.5"
          >
            {t.cta}
            <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
          </a>
        </div>
        <div className="art-plate relative aspect-[3/2] w-full">
          <Image
            src="/home/app-screens.webp"
            alt={t.alt}
            fill
            sizes="(min-width: 1024px) 60vw, 100vw"
            className="art-blend fade-edges object-contain"
          />
        </div>
      </div>
    </section>
  );
}
