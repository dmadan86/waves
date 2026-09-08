import Link from 'next/link';

import type { Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { site } from '@/lib/site';
import { ArrowRight } from './icons';
import { Wordmark } from './logo';
import { Container } from './ui';

export type LegalSection = { heading: string; body: string[] };

/**
 * The shell every legal page shares. The document itself is published in
 * English in all four locales and carries `lang="en"` so a screen reader
 * switches voice rather than reading English with a Tamil pronunciation — a
 * translated policy that nobody has had reviewed would be worse than an honest
 * English one.
 */
export function LegalPage({
  locale,
  title,
  updated,
  intro,
  sections,
  t,
}: {
  locale: Locale;
  title: string;
  updated: string;
  intro: string;
  sections: LegalSection[];
  t: Dictionary['legal'];
}) {
  return (
    <>
      <header className="border-b border-line">
        <Container className="flex h-16 items-center justify-between">
          <Link href={`/${locale}`} aria-label={site.name}>
            <Wordmark />
          </Link>
          <Link
            href={`/${locale}`}
            className="group inline-flex items-center gap-2 rounded-xs text-sm text-ink-2 transition-colors hover:text-ink"
          >
            {t.backHome}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
          </Link>
        </Container>
      </header>

      <main id="main" tabIndex={-1} className="py-20 sm:py-28">
        <Container className="max-w-3xl">
          <p className="font-mono text-[0.6875rem] tracking-[0.12em] text-ink-3 uppercase">
            {t.lastUpdated} · {updated}
          </p>
          <h1 className="mt-4 text-[2.25rem] font-semibold tracking-[-0.035em] text-ink sm:text-[3rem]">
            {title}
          </h1>
          <p className="mt-3 font-mono text-[0.75rem] text-ink-3">{t.englishOnly}</p>

          <div lang="en" dir="ltr" className="mt-12 space-y-10">
            <p className="text-pretty text-[1.0625rem] leading-[1.65] text-ink-2">{intro}</p>

            {sections.map((section) => (
              <section key={section.heading}>
                <h2 className="text-[1.0625rem] font-semibold tracking-[-0.015em] text-ink">
                  {section.heading}
                </h2>
                <div className="mt-3 space-y-3">
                  {section.body.map((paragraph) => (
                    <p key={paragraph} className="text-[0.9375rem] leading-[1.65] text-ink-2">
                      {paragraph}
                    </p>
                  ))}
                </div>
              </section>
            ))}

            <p className="text-[0.9375rem] text-ink-2">
              Questions about any of this:{' '}
              <a
                className="rounded-xs text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-accent"
                href={`mailto:${site.supportEmail}`}
              >
                {site.supportEmail}
              </a>
            </p>
          </div>
        </Container>
      </main>
    </>
  );
}
