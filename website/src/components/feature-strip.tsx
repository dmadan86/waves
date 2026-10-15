import Image from 'next/image';

import type { Dictionary } from '@/i18n/dictionaries';

const tiles = [
  '/home/feature-scan.webp',
  '/home/feature-split.webp',
  '/home/feature-track.webp',
  '/home/feature-groups.webp',
  '/home/feature-shield.webp',
];

export function FeatureStrip({ t }: { t: Dictionary['features'] }) {
  return (
    <section
      id="features"
      aria-label={t.label}
      className="relative z-10 -mt-2 scroll-mt-20 lg:-mt-14"
    >
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <ul className="grid grid-cols-2 gap-x-3 gap-y-6 rounded-[1.75rem] bg-surface p-5 shadow-[var(--w-shadow-card)] sm:grid-cols-3 lg:grid-cols-5 lg:p-6">
          {t.items.map((item, i) => {
            return (
              <li
                key={item.title}
                className="flex flex-col items-center text-center max-sm:last:col-span-2"
              >
                <span className="art-plate relative block h-[4.5rem] w-28">
                  <Image
                    src={tiles[i]!}
                    alt=""
                    fill
                    sizes="7rem"
                    className="art-blend object-contain"
                  />
                </span>
                <h3 className="mt-2 text-[0.95rem] font-semibold text-ink">{item.title}</h3>
                <p className="mt-1 max-w-[11rem] text-[0.8rem] leading-snug text-ink-3">
                  {item.body}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
