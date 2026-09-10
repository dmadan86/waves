import Link from 'next/link';

import { languageNames, locales, type Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { site } from '@/lib/site';
import { CopyrightYears } from './copyright-years';
import { Container } from './ui';

export function SiteFooter({
  locale,
  t,
  appUrl,
}: {
  locale: Locale;
  t: Dictionary['footer'];
  appUrl: string;
}) {
  const columns = [
    {
      heading: t.product,
      links: [
        { label: t.links.features, href: '#features' },
        { label: t.links.how, href: '#how' },
        { label: t.links.currencies, href: '#currencies' },
        { label: t.links.pricing, href: '#pricing' },
        { label: t.links.faq, href: '#faq' },
        { label: t.links.webApp, href: appUrl, external: true },
      ],
    },
    {
      heading: t.company,
      links: [
        { label: t.links.contact, href: `mailto:${site.supportEmail}`, external: true },
        { label: t.links.support, href: `mailto:${site.supportEmail}`, external: true },
      ],
    },
    {
      heading: t.legal,
      links: [
        { label: t.links.privacy, href: `/${locale}/privacy` },
        { label: t.links.terms, href: `/${locale}/terms` },
        { label: t.links.deleteAccount, href: `/${locale}/delete-account` },
        // The markdown twin of this page, for anyone — or anything — that
        // would rather read the text than the layout.
        { label: t.links.markdown, href: `/${locale}/index.md`, external: true },
      ],
    },
  ];

  return (
    <footer className="relative overflow-hidden border-t border-line bg-paper pt-16">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[1.3fr_2fr]">
          <div>
            <p className="max-w-sm text-[0.9375rem] leading-relaxed text-ink-2">{t.tagline}</p>
            <p className="mt-6 font-mono text-[0.75rem] text-ink-3">{t.notABank}</p>
          </div>

          <div className="grid gap-10 sm:grid-cols-3">
            {columns.map((column) => (
              <nav key={column.heading} aria-label={column.heading}>
                <h2 className="font-mono text-[0.6875rem] tracking-[0.14em] text-ink-3 uppercase">
                  {column.heading}
                </h2>
                <ul className="mt-4 space-y-1">
                  {column.links.map((link) => {
                    const className =
                      'inline-flex min-h-9 items-center rounded-xs text-[0.875rem] text-ink-2 transition-colors duration-150 hover:text-ink';
                    return (
                      <li key={link.label}>
                        {'external' in link && link.external ? (
                          <a href={link.href} className={className}>
                            {link.label}
                          </a>
                        ) : link.href.startsWith('#') ? (
                          <a href={link.href} className={className}>
                            {link.label}
                          </a>
                        ) : (
                          <Link href={link.href} className={className}>
                            {link.label}
                          </Link>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col-reverse items-start justify-between gap-5 border-t border-line pt-6 sm:flex-row sm:items-center">
          {/* The page is prerendered, so a build-time year would freeze. The
              range starts at the year the site went up and ends at whatever
              year the reader's own clock says. */}
          <p className="font-mono text-[0.75rem] text-ink-3">
            © <CopyrightYears from={2025} /> {site.name}. {t.rights}
          </p>

          <nav aria-label={t.language} className="flex flex-wrap items-center gap-1">
            {locales.map((l) => (
              <Link
                key={l}
                href={`/${l}`}
                lang={l}
                hrefLang={l}
                aria-current={l === locale ? 'page' : undefined}
                className={`inline-flex min-h-9 items-center rounded-md px-2.5 text-[0.8125rem] transition-colors duration-150 ${
                  l === locale ? 'bg-chip text-ink' : 'text-ink-3 hover:text-ink'
                }`}
              >
                {languageNames[l].endonym}
              </Link>
            ))}
          </nav>
        </div>
      </Container>

      {/*
       * The full stop. The wordmark set enormous and cropped by the viewport —
       * hidden from assistive technology, and the one place the pixel face gets
       * to be loud.
       *
       * Automated checkers will flag its contrast. That is expected and it is
       * not a defect: WCAG 1.4.3 exempts text that is part of a brand name, and
       * this is the brand name used as ornament, carrying no information. It
       * has to stay a watermark; at 3:1 it would stop being one.
       */}
      <p
        aria-hidden="true"
        className="mt-12 -mb-[0.18em] w-full text-center font-pixel leading-[0.78] tracking-[-0.01em] text-ink/[0.07] select-none text-[clamp(5rem,26vw,22rem)]"
      >
        waves
      </p>
    </footer>
  );
}
