import type { Dictionary } from '@/i18n/dictionaries';
import { Check } from './icons';
import { StoreBadges } from './store-badges';

export function DownloadBanner({
  t,
  stores,
  result,
}: {
  t: Dictionary['cta'];
  stores: Dictionary['stores'];
  /** The resolved line from the hero split, echoed as the closing beat. */
  result?: string;
}) {
  return (
    <section id="download" aria-labelledby="download-title" className="scroll-mt-20 py-8 lg:py-12">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="relative isolate overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,#3b2399_0%,#6a4bf5_58%,#a994ff_100%)] px-6 py-12 text-white sm:px-12 sm:py-16 lg:px-16">
          <div
            aria-hidden="true"
            className="absolute -end-24 -top-24 -z-10 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.28),transparent)]"
          />
          <h2
            id="download-title"
            className="display max-w-[22ch] text-[2.3rem] text-balance text-white sm:text-[3.6rem]"
          >
            {t.title}
          </h2>
          <p className="mt-4 max-w-md text-[1.02rem] leading-relaxed text-white/80">{t.subtitle}</p>
          <StoreBadges t={stores} className="mt-8" />
          {result ? (
            <p
              aria-hidden="true"
              className="mt-10 inline-flex items-center gap-2.5 rounded-full bg-white px-4 py-2.5 text-[0.95rem] font-semibold text-[#211b32] shadow-[0_12px_30px_rgb(20_10_60/0.3)] lg:absolute lg:end-14 lg:bottom-14 lg:mt-0"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-[#237a60] text-white">
                <Check className="h-3.5 w-3.5" />
              </span>
              <span className="tabular-nums">{result}</span>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
