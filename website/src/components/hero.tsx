import Image from 'next/image';

import type { Dictionary } from '@/i18n/dictionaries';
import { Check } from './icons';
import { StoreBadges } from './store-badges';

export function Hero({ t, stores }: { t: Dictionary['hero']; stores: Dictionary['stores'] }) {
  return (
    <section className="relative isolate overflow-hidden">
      <div className="mx-auto w-full max-w-[73rem] px-5 pt-24 pb-4 sm:px-8 lg:min-h-[34rem] lg:pt-32 lg:pb-28">
        <div className="max-w-[28rem]">
          <p className="text-[0.72rem] font-semibold tracking-[0.12em] text-accent uppercase">
            {t.eyebrow}
          </p>
          <h1 className="mt-4 text-[2.6rem] leading-[1.04] font-bold tracking-[-0.035em] text-balance text-ink sm:text-[3.4rem]">
            {t.titleStart} <span className="text-blue">{t.titleAccent}</span>
          </h1>
          <p className="mt-5 max-w-[26rem] text-[1.02rem] leading-[1.6] text-ink-2">{t.subtitle}</p>
          <StoreBadges t={stores} className="mt-7" />
          <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2">
            {t.trust.map((item) => (
              <li key={item} className="inline-flex items-center gap-1.5 text-[0.8rem] text-ink-2">
                <span className="grid h-4 w-4 place-items-center rounded-full bg-[#22a06b] text-white">
                  <Check className="h-2.5 w-2.5" />
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* One image for every width: below `lg` it follows the copy, above it
          sits behind it and fades into the page on its inner and lower edges. */}
      <div className="hero-art relative -z-10 mx-auto mt-2 aspect-[364/282] w-full max-w-xl lg:absolute lg:end-0 lg:top-0 lg:mt-0 lg:aspect-auto lg:h-full lg:w-[60%] lg:max-w-none">
        <Image
          src="/home/hero.webp"
          alt={t.alt}
          fill
          priority
          sizes="(min-width: 1024px) 60vw, 100vw"
          className="object-cover object-left"
        />
      </div>
    </section>
  );
}
