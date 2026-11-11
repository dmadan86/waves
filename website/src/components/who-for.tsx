import Link from 'next/link';

import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight } from './icons';
import { Kicker, SectionTitle } from './ui';

/** Three audiences, each with the one page that sells to them. */
export function WhoFor({ t, locale }: { t: Dictionary['whoFor']; locale: string }) {
  return (
    <section id="who" aria-labelledby="who-title" className="scroll-mt-20 py-10 lg:py-12">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <Kicker>{t.eyebrow}</Kicker>
        <SectionTitle id="who-title" className="mt-2">
          {t.title}
        </SectionTitle>
        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {t.items.map((item) => (
            <li
              key={item.title}
              className="flex flex-col rounded-2xl bg-surface p-5 shadow-[var(--w-shadow-card)]"
            >
              <h3 className="text-[1.05rem] font-semibold text-ink">{item.title}</h3>
              <p className="mt-2 flex-1 text-[0.9rem] leading-[1.6] text-ink-2">{item.body}</p>
              <Link
                href={`/${locale}${item.href}`}
                className="mt-4 inline-flex items-center gap-1.5 text-[0.88rem] font-semibold text-accent hover:underline"
              >
                {item.cta}
                <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
