import Image from 'next/image';

import type { Dictionary } from '@/i18n/dictionaries';
import { StoreBadges } from './store-badges';

export function DownloadBanner({
  t,
  stores,
}: {
  t: Dictionary['cta'];
  stores: Dictionary['stores'];
}) {
  return (
    <section id="download" aria-labelledby="download-title" className="scroll-mt-20 py-6 lg:py-8">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="banner-sky relative isolate overflow-hidden rounded-[1.75rem] px-6 py-7 sm:px-24 sm:py-9 lg:px-36">
          <Image
            src="/home/cta-left.webp"
            alt=""
            width={280}
            height={404}
            className="fade-to-end pointer-events-none absolute left-0 top-0 -z-10 h-full w-auto"
          />
          <Image
            src="/home/cta-right.webp"
            alt={t.alt}
            width={664}
            height={404}
            className="fade-to-start pointer-events-none absolute right-0 top-0 -z-10 hidden h-full w-auto sm:block"
          />
          <h2
            id="download-title"
            className="text-[1.5rem] font-bold tracking-[-0.02em] text-[#1c1830] sm:text-[1.8rem]"
          >
            {t.title}
          </h2>
          <p className="mt-1.5 max-w-md text-[0.95rem] text-[#3b3652]">{t.subtitle}</p>
          <StoreBadges t={stores} className="mt-5" />
        </div>
      </div>
    </section>
  );
}
