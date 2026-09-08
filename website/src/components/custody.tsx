import type { Dictionary } from '@/i18n/dictionaries';
import { Container } from './ui';

/**
 * The band that used to be a marquee of payment-rail names.
 *
 * A scrolling strip is a social-proof shape; filling it with rails instead of
 * logos was filler, and leading it with one country's rail told every other
 * country the product was not for them. What replaced it is the sentence that
 * makes the whole rail question moot: Waves is not in the payment path. The
 * rails then appear as examples, in no privileged order, deliberately drawn
 * from four continents.
 */
export function Custody({ t }: { t: Dictionary['custody'] }) {
  return (
    <section className="border-b border-line bg-paper py-12 sm:py-14">
      <Container>
        <div className="grid gap-6 md:grid-cols-[1fr_auto] md:items-center md:gap-12">
          <div>
            <p className="text-balance text-[1.375rem] leading-[1.25] font-semibold tracking-[-0.02em] text-ink sm:text-[1.625rem]">
              {t.claim}
            </p>
            <p className="mt-3 max-w-2xl text-pretty text-[0.9375rem] leading-[1.6] text-ink-2">
              {t.body}
            </p>
          </div>

          <ul className="flex flex-wrap gap-1.5 md:max-w-xs md:justify-end">
            {t.rails.map((rail) => (
              <li
                key={rail}
                className="rounded-sm border border-line px-2 py-1 font-mono text-[0.6875rem] text-ink-2"
              >
                {rail}
              </li>
            ))}
          </ul>
        </div>
      </Container>
    </section>
  );
}
