import Link from 'next/link';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight } from './icons';
import { SectionTitle } from './ui';

const href = (id: string, locale: Locale) =>
  ({
    wearables: `/${locale}/features#wearables`,
    agents: `/${locale}/features#agents`,
    openSource: `/${locale}/features#open-source`,
    personal: `/${locale}/personal`,
    companies: `/${locale}/companies`,
  })[id] ?? `/${locale}/features`;

/** A compact row of links to what moved off the home page. */
export function MoreBand({ t, locale }: { t: Dictionary['more']; locale: Locale }) {
  return (
    <section aria-labelledby="more-title" className="py-8 lg:py-10">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <SectionTitle id="more-title" className="text-[1.6rem] sm:text-[2rem]">
          {t.title}
        </SectionTitle>
        <ul className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {t.items.map((item) => (
            <li key={item.id}>
              <Link
                href={href(item.id, locale)}
                className="group flex h-full flex-col rounded-2xl bg-surface p-4 shadow-[var(--w-shadow-card)] transition-transform hover:-translate-y-0.5"
              >
                <span className="flex items-center justify-between gap-2 text-[1rem] font-semibold text-ink">
                  {item.title}
                  <ArrowRight className="h-4 w-4 shrink-0 text-accent rtl:-scale-x-100" />
                </span>
                <span className="mt-1.5 text-[0.86rem] leading-snug text-ink-2">{item.body}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
