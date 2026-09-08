'use client';

import { useMemo, useState } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import { REGIONS, type CurrencyRow, type Region } from '@/lib/currencies';
import { Search } from './icons';
import { Container, Eyebrow, Lede, Section, SectionTitle } from './ui';

/**
 * "Supports 180+ currencies" is a sentence. This is the same claim as an
 * object the visitor can search — which is both a stronger proof and the most
 * direct answer the page has to "is this product for my country".
 *
 * The rows are built on the server in the page's own language, so the browser
 * receives finished text and no formatting code.
 */
export function Currencies({ t, rows }: { t: Dictionary['currencies']; rows: CurrencyRow[] }) {
  const [region, setRegion] = useState<Region | 'all'>('all');
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return rows.filter(
      (row) =>
        (region === 'all' || row.region === region) &&
        (needle === '' ||
          row.code.toLocaleLowerCase().includes(needle) ||
          row.name.toLocaleLowerCase().includes(needle)),
    );
  }, [rows, region, query]);

  const filters: readonly (Region | 'all')[] = ['all', ...REGIONS];

  return (
    <Section id="currencies" ground="paper">
      <Container>
        <div className="max-w-3xl">
          <Eyebrow index="02">{t.eyebrow}</Eyebrow>
          <SectionTitle className="mt-5">{t.title}</SectionTitle>
          <Lede className="mt-4">{t.subtitle}</Lede>
        </div>

        <div className="mt-9 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <ul className="-mx-5 flex gap-1.5 overflow-x-auto px-5 md:mx-0 md:flex-wrap md:px-0">
            {filters.map((value) => {
              const selected = region === value;
              return (
                <li key={value}>
                  <button
                    type="button"
                    onClick={() => setRegion(value)}
                    aria-pressed={selected}
                    className={`inline-flex h-9 shrink-0 items-center rounded-md px-3 font-mono text-[0.75rem] whitespace-nowrap transition-colors duration-150 ${
                      selected ? 'bg-ink text-bg' : 'bg-chip text-ink-2 hover:text-ink'
                    }`}
                  >
                    {t.regions[value]}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="relative md:w-64">
            <Search
              className="pointer-events-none absolute top-1/2 start-3 h-4 w-4 -translate-y-1/2 text-ink-3"
              aria-hidden="true"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.searchPlaceholder}
              aria-label={t.searchLabel}
              className="h-11 w-full rounded-md border border-line bg-bg ps-9 pe-3 text-sm text-ink placeholder:text-ink-3 focus-visible:border-accent"
            />
          </div>
        </div>

        {/* The count is announced, so a screen-reader user filtering the list
            hears the result rather than having to go and count the rows. */}
        <p aria-live="polite" className="mt-4 font-mono text-[0.75rem] text-ink-3">
          {t.count.replace('{n}', String(shown.length))}
        </p>

        {shown.length > 0 ? (
          // Capped and scrolled: the list is evidence, and evidence does not
          // need two thousand pixels of the page to be convincing.
          // The scroller is the wrapper, not the list: putting a role on the
          // <ul> to make it focusable would strip the list semantics from all
          // hundred and fifty rows inside it.
          <div
            tabIndex={0}
            role="group"
            aria-label={t.title}
            className="mt-3 max-h-[22rem] overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg"
          >
            <ul className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
              {shown.map((row) => (
                <li key={row.code} className="flex items-baseline gap-3 bg-surface px-3.5 py-2.5">
                  <span className="w-9 shrink-0 font-mono text-[0.8125rem] font-medium text-ink">
                    {row.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-ink-2">
                    {row.name}
                  </span>
                  <span aria-hidden="true" className="shrink-0 font-mono text-[0.75rem] text-ink-3">
                    {row.symbol}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-line px-4 py-8 text-center text-sm text-ink-2">
            {t.empty}
          </p>
        )}

        <p className="mt-5 max-w-2xl font-mono text-[0.75rem] leading-relaxed text-ink-3">
          {t.note}
        </p>
      </Container>
    </Section>
  );
}
