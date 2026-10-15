import Image from 'next/image';

import type { Dictionary } from '@/i18n/dictionaries';
import { Kicker, SectionTitle } from './ui';

const art = [
  '/home/moment-trips.webp',
  '/home/moment-dining.webp',
  '/home/moment-home.webp',
  '/home/moment-finance.webp',
];

export function Moments({ t }: { t: Dictionary['moments'] }) {
  return (
    <section aria-labelledby="moments-title" className="py-10 lg:py-12">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <Kicker>{t.eyebrow}</Kicker>
        <SectionTitle id="moments-title" className="mt-2">
          {t.title}
        </SectionTitle>
        <ul className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
          {t.items.map((item, i) => (
            <li
              key={item.title}
              className="rounded-[1.4rem] bg-surface p-2.5 shadow-[var(--w-shadow-card)]"
            >
              <div className="relative aspect-[144/84] overflow-hidden rounded-2xl">
                <Image
                  src={art[i]!}
                  alt={item.alt}
                  fill
                  sizes="(min-width: 1024px) 17rem, 45vw"
                  className="object-cover"
                />
              </div>
              <h3 className="mt-3 px-1.5 text-[0.95rem] font-semibold text-ink">{item.title}</h3>
              <p className="mt-1 px-1.5 pb-1.5 text-[0.84rem] leading-snug text-ink-2">
                {item.body}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
