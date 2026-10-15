'use client';

import { useState } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight, Chevron } from './icons';
import { Kicker, SectionTitle } from './ui';

const INITIAL = 6;

/**
 * Native `<details>` rows: they open with JavaScript off, are already
 * keyboard-operable and announced correctly. Only the "view all" toggle needs
 * script. The first six questions show by default; the rest sit behind the
 * toggle.
 */
export function Faq({ t }: { t: Dictionary['faq'] }) {
  const [all, setAll] = useState(false);
  const half = Math.ceil((all ? t.items.length : INITIAL) / 2);
  const shown = all ? t.items : t.items.slice(0, INITIAL);
  const columns = [shown.slice(0, half), shown.slice(half)];

  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-20 py-10 lg:py-12">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Kicker>{t.eyebrow}</Kicker>
            <SectionTitle id="faq-title" className="mt-2">
              {t.title}
            </SectionTitle>
          </div>
          <button
            type="button"
            onClick={() => setAll((v) => !v)}
            aria-expanded={all}
            className="inline-flex items-center gap-1.5 text-[0.88rem] font-semibold text-accent hover:underline"
          >
            {all ? t.viewLess : t.viewAll}
            <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
          </button>
        </div>

        <div className="mt-6 grid items-start gap-3 md:grid-cols-2">
          {columns.map((column, c) => (
            <div key={c} className="space-y-3">
              {column.map((item) => (
                <details
                  key={item.q}
                  className="group rounded-2xl bg-surface shadow-[var(--w-shadow-card)]"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-3.5 text-start text-[0.93rem] font-medium text-ink [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <Chevron className="h-4 w-4 shrink-0 text-ink-3 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="px-5 pb-4 text-[0.88rem] leading-[1.6] text-ink-2">{item.a}</p>
                </details>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
