import Image from 'next/image';
import Link from 'next/link';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight, Eye, Lock, Users } from './icons';
import { Kicker } from './ui';

const pillIcons = [Lock, Eye, Users];

export function PrivacyBand({ t, locale }: { t: Dictionary['privacy']; locale: Locale }) {
  return (
    <section id="security" aria-labelledby="security-title" className="scroll-mt-20 py-6 lg:py-8">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="privacy-card relative grid items-center gap-5 overflow-hidden rounded-[1.75rem] p-5 shadow-[var(--w-shadow-card)] sm:grid-cols-[auto_1fr] sm:gap-7 sm:p-6">
          <div className="art-plate relative h-[6.25rem] w-40 justify-self-start sm:h-[7.5rem] sm:w-48">
            <Image
              src="/home/feature-shield.webp"
              alt={t.alt}
              fill
              sizes="10rem"
              className="art-blend object-contain"
            />
          </div>
          <div>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Kicker>{t.eyebrow}</Kicker>
                <h2
                  id="security-title"
                  className="mt-1.5 text-[1.5rem] font-bold tracking-[-0.02em] text-ink sm:text-[1.7rem]"
                >
                  {t.title}
                </h2>
              </div>
              <Link
                href={`/${locale}/privacy`}
                className="inline-flex items-center gap-1.5 text-[0.84rem] font-semibold text-accent hover:underline"
              >
                {t.cta}
                <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
              </Link>
            </div>
            <p className="mt-1.5 text-[0.92rem] text-ink-2">{t.body}</p>
            <ul className="mt-4 flex flex-wrap gap-2.5">
              {t.pills.map((pill, i) => {
                const Icon = pillIcons[i]!;
                return (
                  <li
                    key={pill}
                    className="inline-flex h-10 items-center gap-2 rounded-full bg-surface px-4 text-[0.85rem] font-medium text-ink shadow-[var(--w-shadow-sm)]"
                  >
                    <Icon className="h-[1.05rem] w-[1.05rem] text-accent" />
                    {pill}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
