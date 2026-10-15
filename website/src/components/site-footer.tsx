import Link from 'next/link';

import { languageNames, locales, type Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { site } from '@/lib/site';
import { CopyrightYears } from './copyright-years';
import { Wordmark } from './logo';

type FooterLink = { label: string; href: string; kind: 'anchor' | 'route' | 'external' };

export function SiteFooter({
  locale,
  t,
  legal,
  appUrl,
}: {
  locale: Locale;
  t: Dictionary['footer'];
  legal: Dictionary['legal'];
  appUrl: string;
}) {
  const columns: { heading: string; links: FooterLink[] }[] = [
    {
      heading: t.product,
      links: [
        { label: t.links.features, href: '#features', kind: 'anchor' },
        { label: t.links.how, href: '#how', kind: 'anchor' },
        { label: t.links.security, href: '#security', kind: 'anchor' },
        { label: t.links.agents, href: '#agents', kind: 'anchor' },
        { label: t.links.pricing, href: '#pricing', kind: 'anchor' },
        { label: t.links.faq, href: '#faq', kind: 'anchor' },
      ],
    },
    {
      heading: t.company,
      links: [
        { label: t.links.webApp, href: appUrl, kind: 'external' },
        { label: legal.mcpTitle, href: `/${locale}/mcp`, kind: 'route' },
        { label: t.links.markdown, href: `/${locale}/index.md`, kind: 'external' },
      ],
    },
    {
      heading: t.support,
      links: [
        { label: t.links.contact, href: `mailto:${site.supportEmail}`, kind: 'external' },
        { label: t.links.privacy, href: `/${locale}/privacy`, kind: 'route' },
        { label: t.links.terms, href: `/${locale}/terms`, kind: 'route' },
        { label: t.links.deleteAccount, href: `/${locale}/delete-account`, kind: 'route' },
      ],
    },
  ];
  const cls =
    'inline-flex min-h-7 items-center text-[0.82rem] text-ink-2 transition-colors hover:text-ink';

  return (
    <footer className="mt-6 border-t border-line/70 pt-9">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="grid gap-8 md:grid-cols-[1.3fr_2fr]">
          <div>
            <Link href={`/${locale}`} aria-label={site.name}>
              <Wordmark />
            </Link>
            <p className="mt-3 max-w-[16rem] text-[0.82rem] leading-relaxed text-ink-2">
              {t.tagline}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            {columns.map((column) => (
              <nav key={column.heading} aria-label={column.heading}>
                <h2 className="text-[0.82rem] font-semibold text-ink">{column.heading}</h2>
                <ul className="mt-2.5 space-y-0.5">
                  {column.links.map((link) => (
                    <li key={link.label}>
                      {link.kind === 'route' ? (
                        <Link href={link.href} className={cls}>
                          {link.label}
                        </Link>
                      ) : (
                        <a href={link.href} className={cls}>
                          {link.label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-col-reverse items-start justify-between gap-3 border-t border-line/70 py-5 sm:flex-row sm:items-center">
          <p className="text-[0.75rem] text-ink-3">
            © <CopyrightYears from={2025} /> {site.name}. {t.rights} {t.notABank}
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
      </div>
    </footer>
  );
}
