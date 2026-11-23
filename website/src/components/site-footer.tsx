import Link from 'next/link';

import { languageNames, locales, type Locale } from '@/i18n/config';
import type { Dictionary } from '@/i18n/dictionaries';
import { site, socialLinks } from '@/lib/site';
import { AttributedLink } from './attributed-link';
import { CopyrightYears } from './copyright-years';
import { Wordmark } from './logo';

type FooterLink = {
  label: string;
  href: string;
  kind: 'anchor' | 'route' | 'external';
  lang?: string;
};

export function SiteFooter({
  locale,
  t,
  legal,
  appUrl,
  anchorBase = '',
}: {
  locale: Locale;
  t: Dictionary['footer'];
  legal: Dictionary['legal'];
  appUrl: string;
  /** Prefix for the in-page product links, so a secondary page can point them at the home page. */
  anchorBase?: string;
}) {
  // English-only pages always point at /en, whatever the page locale.
  const en = (label: string, path: string): FooterLink => ({
    label,
    href: `/en${path}`,
    kind: 'route',
    lang: 'en',
  });
  // Each inner array is one grid column; a column can stack two headed lists.
  const columns: { heading: string; links: FooterLink[] }[][] = [
    [
      {
        heading: t.product,
        links: [
          { label: t.links.features, href: `${anchorBase}#features`, kind: 'anchor' },
          { label: t.links.how, href: `${anchorBase}#how`, kind: 'anchor' },
          { label: t.links.personal, href: `/${locale}/personal`, kind: 'route' },
          { label: t.links.companies, href: `/${locale}/companies`, kind: 'route' },
          { label: t.links.offline, href: `${anchorBase}#offline`, kind: 'anchor' },
          { label: t.links.voice, href: `${anchorBase}#voice`, kind: 'anchor' },
          { label: t.links.wearables, href: `${anchorBase}#wearables`, kind: 'anchor' },
          { label: t.links.security, href: `${anchorBase}#security`, kind: 'anchor' },
          { label: t.links.pricing, href: `${anchorBase}#pricing`, kind: 'anchor' },
          { label: t.links.faq, href: `${anchorBase}#faq`, kind: 'anchor' },
        ],
      },
    ],
    [
      {
        heading: 'AI agents',
        links: [
          { label: legal.mcpTitle, href: `/${locale}/mcp`, kind: 'route' },
          { label: t.links.agents, href: `${anchorBase}#agents`, kind: 'anchor' },
        ],
      },
      {
        heading: 'Compare',
        links: [
          en('Splitwise alternative', '/alternatives/splitwise-alternative'),
          en('Waves vs Splitwise', '/compare/waves-vs-splitwise'),
          en('Waves vs Splitkaro', '/compare/waves-vs-splitkaro'),
          en('Waves vs Tricount', '/compare/waves-vs-tricount'),
          en('Waves vs Google Pay split', '/compare/waves-vs-google-pay'),
          en('All comparisons', '/compare'),
        ],
      },
    ],
    [
      {
        heading: 'Use cases',
        links: [
          en('Split bills with roommates', '/use-cases/split-bills-with-roommates'),
          en('Trip expense splitter', '/use-cases/trip-expense-splitter'),
          en('Split rent in India', '/use-cases/split-rent-india'),
        ],
      },
      {
        heading: 'Resources',
        links: [
          { label: t.links.webApp, href: appUrl, kind: 'external' },
          en('Press kit', '/press'),
          { label: t.links.github, href: site.githubUrl, kind: 'external' },
          { label: t.links.markdown, href: `/${locale}/index.md`, kind: 'external' },
        ],
      },
    ],
    [
      {
        heading: t.support,
        links: [
          { label: t.links.support, href: `/${locale}/support`, kind: 'route' },
          { label: t.links.contact, href: `mailto:${site.supportEmail}`, kind: 'external' },
          { label: t.links.privacy, href: `/${locale}/privacy`, kind: 'route' },
          { label: t.links.terms, href: `/${locale}/terms`, kind: 'route' },
          { label: t.links.refund, href: `/${locale}/refund`, kind: 'route' },
          { label: t.links.deleteAccount, href: `/${locale}/delete-account`, kind: 'route' },
        ],
      },
    ],
  ];
  const cls =
    'inline-flex min-h-7 items-center text-[0.82rem] text-ink-2 transition-colors hover:text-ink';

  return (
    <footer className="mt-6 border-t border-line/70 pt-9">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-4">
          {columns.map((stack) => (
            <div key={stack[0].heading} className="space-y-7">
              {stack.map((column) => (
                <nav key={column.heading} aria-label={column.heading}>
                  <h2 className="text-[0.82rem] font-semibold text-ink">{column.heading}</h2>
                  <ul className="mt-2.5 space-y-0.5">
                    {column.links.map((link) => (
                      <li key={link.label}>
                        {link.kind === 'route' ? (
                          <Link href={link.href} className={cls} lang={link.lang}>
                            {link.label}
                          </Link>
                        ) : link.href === appUrl ? (
                          <AttributedLink
                            href={link.href}
                            kind="web"
                            placement="footer"
                            className={cls}
                          >
                            {link.label}
                          </AttributedLink>
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
          ))}
        </div>

        <div className="mt-9 flex flex-col gap-3 border-t border-line/70 pt-6 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <Link href={`/${locale}`} aria-label={site.name}>
              <Wordmark />
            </Link>
            <p className="mt-2 max-w-[18rem] text-[0.82rem] leading-relaxed text-ink-2">
              {t.tagline}
            </p>
          </div>
          {socialLinks.length ? (
            <ul className="flex gap-3">
              {socialLinks.map((l) => (
                <li key={l.name}>
                  <a href={l.href} rel="me noopener" className={cls}>
                    {l.name}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col-reverse items-start justify-between gap-3 border-t border-line/70 py-5 sm:flex-row sm:items-center">
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
