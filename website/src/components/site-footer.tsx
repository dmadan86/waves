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
        { label: t.links.markdown, href: `/${locale}/index.md`, external: true },
      ],
    },
  ];

  return (
    <footer className="overflow-hidden border-t border-line bg-paper pt-16">
      <Container>
        <div className="grid gap-14 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <Link href={`/${locale}`} className="inline-flex items-center text-ink">
              <span className="font-pixel text-2xl tracking-[0.02em]">waves</span>
            </Link>
            <p className="mt-5 max-w-sm text-[0.9rem] leading-relaxed text-ink-2">{t.tagline}</p>
            <p className="mt-5 font-mono text-[0.68rem] text-ink-3">{t.notABank}</p>
          </div>

          <div className="grid gap-10 sm:grid-cols-3">
            {columns.map((column) => (
              <nav key={column.heading} aria-label={column.heading}>
                <h2 className="font-mono text-[0.66rem] tracking-[0.14em] text-ink-3 uppercase">
                  {column.heading}
                </h2>
                <ul className="mt-4 space-y-1.5">
                  {column.links.map((link) => {
                    const cls =
                      'inline-flex min-h-8 items-center text-[0.84rem] text-ink-2 transition-colors hover:text-ink';
                    return (
                      <li key={link.label}>
                        {'external' in link && link.external ? (
                          <a href={link.href} className={cls}>
                            {link.label}
                          </a>
                        ) : link.href.startsWith('#') ? (
                          <a href={link.href} className={cls}>
                            {link.label}
                          </a>
                        ) : (
                          <Link href={link.href} className={cls}>
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

        <div className="mt-14 flex flex-col-reverse items-start justify-between gap-5 border-t border-line py-6 sm:flex-row sm:items-center">
          <p className="font-mono text-[0.68rem] text-ink-3">
            © <CopyrightYears from={2025} /> {site.name}. {t.rights}
          </p>
          <nav aria-label={t.language} className="flex flex-wrap gap-1">
            {locales.map((l) => (
              <Link
                key={l}
                href={`/${l}`}
                lang={l}
                hrefLang={l}
                aria-current={l === locale ? 'page' : undefined}
                className={`inline-flex min-h-8 items-center rounded-full px-2.5 text-[0.75rem] ${l === locale ? 'bg-chip text-ink' : 'text-ink-3 hover:text-ink'}`}
              >
                {languageNames[l].endonym}
              </Link>
            ))}
          </nav>
        </div>
      </Container>
      <p
        aria-hidden="true"
        className="mt-8 -mb-[0.16em] w-full text-center font-pixel leading-[0.72] tracking-[-0.04em] text-ink/[0.055] select-none text-[clamp(7rem,28vw,25rem)]"
      >
        waves
      </p>
    </footer>
  );
}
