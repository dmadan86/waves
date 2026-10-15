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
        <div className="banner-sky relative isolate overflow-hidden rounded-[1.75rem] px-6 py-7 sm:px-10 sm:py-9 lg:px-14">
          <h2
            id="download-title"
            className="text-[1.5rem] font-bold tracking-[-0.02em] text-[#1c1830] sm:text-[1.8rem]"
          >
            {t.title}
          </h2>
          <p className="mt-1.5 max-w-md text-[0.95rem] text-[#3b3652]">{t.subtitle}</p>
          <StoreBadges t={stores} className="mt-5" />
          <Image
            src="/home/cta.webp"
            alt={t.alt}
            width={470}
            height={175}
            className="pointer-events-none mt-5 ms-auto h-28 w-auto mix-blend-multiply sm:absolute sm:inset-y-0 sm:end-0 sm:-z-10 sm:mt-0 sm:h-full sm:[mask-image:linear-gradient(to_left,#000_70%,transparent_100%)] sm:rtl:[mask-image:linear-gradient(to_right,#000_70%,transparent_100%)]"
          />
        </div>
      </div>
    </section>
  );
}
