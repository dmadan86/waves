import type { ReactNode } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight } from './icons';

/**
 * "Explore Waves" (design.md, Orbit C): eight coloured doors right after the
 * hero, each linking to the section or page that explains it.
 */

const look: Record<string, { bg: string; dark?: boolean; href: (l: string) => string }> = {
  split: { bg: '#F4C3B1', href: (l) => `/${l}#how` },
  scan: { bg: '#F3D282', href: (l) => `/${l}/personal#f-receipt` },
  voice: { bg: '#FBFAFF', href: (l) => `/${l}#voice` },
  settle: { bg: '#5B3DF5', dark: true, href: (l) => `/${l}#how` },
  offline: { bg: '#A8E3C8', href: (l) => `/${l}#offline` },
  ask: { bg: '#CDB9F5', href: (l) => `/${l}/mcp` },
  personal: { bg: '#A4CBEA', href: (l) => `/${l}/personal` },
  companies: { bg: '#F1E0A3', href: (l) => `/${l}/companies` },
};

const svg = (children: ReactNode) => (
  <svg
    viewBox="0 0 120 100"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    direction="ltr"
    className="h-14 w-16 shrink-0 sm:h-24 sm:w-28 lg:h-28 lg:w-32"
  >
    {children}
  </svg>
);
const money = (x: number, y: number, s: string, size = 9) => (
  <text x={x} y={y} fontSize={size} fill="currentColor" stroke="none" fontFamily="var(--font-mono)">
    {s}
  </text>
);

const icons: Record<string, ReactNode> = {
  split: svg(
    <>
      <path d="M30 6h44v60l-5.5-4-5.5 4-5.5-4-5.5 4-5.5-4-5.5 4-5.5-4-5.5 4z" />
      <path d="M40 18h24M40 27h24M40 36h16" />
      {money(36, 54, '₹1,665')}
      <path d="M52 68v10M52 78L22 88M52 78l30 10" strokeDasharray="3 3" />
      <circle cx="20" cy="92" r="4" />
      <circle cx="52" cy="92" r="4" />
      <circle cx="84" cy="92" r="4" />
    </>,
  ),
  scan: svg(
    <>
      <rect x="34" y="4" width="40" height="76" rx="7" />
      <path d="M48 12h12M42 26v-6h6M66 20h-6v0M66 20v6M42 58v6h6M66 64h-6M66 64v-6" />
      <path d="M48 30h12v20l-3-2-3 2-3-2-3 2z M51 36h6M51 41h6" />
      <path d="M38 42h32" strokeDasharray="3 3" />
      <path d="M88 14l2 5 5 2-5 2-2 5-2-5-5-2 5-2z M20 64l1.5 3.5 3.5 1.5-3.5 1.5-1.5 3.5-1.5-3.5-3.5-1.5 3.5-1.5z" />
    </>,
  ),
  voice: svg(
    <>
      <rect x="52" y="20" width="16" height="34" rx="8" />
      <path d="M44 42a16 16 0 0 0 32 0M60 58v22M48 80h24" />
      <path d="M6 32h30v14H22l-5 6v-6H6z" />
      {money(9, 43, '₹300', 8)}
      <path d="M84 8h28v14h-10l-4 5v-5H84z" />
      {money(88, 19, 'हिन्दी', 7)}
      <path d="M86 40h26v13h-12l-4 5v-5H86z" />
      {money(89, 50, 'தமிழ்', 6.5)}
    </>,
  ),
  settle: svg(
    <>
      <rect x="10" y="4" width="34" height="62" rx="6" />
      <circle cx="27" cy="24" r="10" />
      <path d="M22 24l4 4 7-8" />
      {money(15, 52, '₹555', 9)}
      <path d="M52 30c8-14 26-14 32 0M84 30l-1-7M84 30l-7-1" strokeDasharray="3 3" />
      <ellipse cx="94" cy="50" rx="12" ry="5" />
      <path d="M82 50v14c0 3 5 5 12 5s12-2 12-5V50M82 57c0 3 5 5 12 5s12-2 12-5" />
    </>,
  ),
  offline: svg(
    <>
      <circle cx="78" cy="18" r="7" />
      <path d="M78 4v3M78 29v3M64 18h3M89 18h3M68 8l2 2M86 26l2 2M68 28l2-2M86 10l2-2" />
      <path d="M6 70l22-32 10 12 8-10 18 24" />
      <rect x="74" y="40" width="22" height="38" rx="4" />
      <path d="M79 54a10 10 0 0 1 12 0M82 58a5 5 0 0 1 6 0M78 50l14 18" />
    </>,
  ),
  ask: svg(
    <>
      <path d="M8 10h50v28H24l-8 8v-8H8z" />
      <path d="M22 18l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM36 22h12M36 28h8" />
      <path d="M40 46h42v26H40z" />
      <path d="M46 54l2 2 3-3M56 55h18M46 64l2 2 3-3M56 65h18" />
    </>,
  ),
  personal: svg(
    <>
      <path d="M44 6h32v8H44zM40 14h40c2 0 4 2 4 4v54c0 4-3 6-6 6H42c-3 0-6-2-6-6V18c0-2 2-4 4-4z" />
      <ellipse cx="60" cy="40" rx="13" ry="5" />
      <path d="M47 40v14c0 3 6 5 13 5s13-2 13-5V40M47 47c0 3 6 5 13 5s13-2 13-5" />
      <path d="M90 38l12 0 4 6v14H90z" />
      {money(92, 54, '₹6k', 7)}
      <path d="M10 46c4-8 14-10 22-4" strokeDasharray="3 3" />
      <path d="M18 60v10M13 65h10" />
    </>,
  ),
  companies: svg(
    <>
      <path d="M10 30l8-16h64l8 16" />
      <path d="M10 30c0 5 4 8 8 8s8-3 8-8c0 5 4 8 8 8s8-3 8-8c0 5 4 8 8 8s8-3 8-8c0 5 4 8 8 8s8-3 8-8c0 5 4 8 8 8s8-3 8-8" />
      <path d="M16 38v42h68V38M44 80V58h14v22M22 52h12v8H22zM66 52h12v8H66z" />
      <circle cx="96" cy="16" r="10" />
      <path d="M91 16l4 4 7-8" />
    </>,
  ),
};

export function ExploreGrid({
  t,
  wearables,
  locale,
}: {
  t: Dictionary['explore'];
  wearables: Dictionary['wearables'];
  locale: string;
}) {
  return (
    <section aria-labelledby="explore-title" className="py-12 lg:py-16">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[0.72rem] font-medium tracking-[0.18em] text-accent uppercase">
              {t.eyebrow}
            </p>
            <h2
              id="explore-title"
              className="display mt-2 text-balance text-[2.4rem] leading-[1.05] text-ink sm:text-[3.4rem]"
            >
              {t.titleStart} <span className="text-accent">{t.titleAccent}</span>
            </h2>
          </div>
          <p className="max-w-sm text-pretty text-[0.9rem] leading-relaxed text-ink-2">{t.lead}</p>
        </div>

        <ul className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {t.cards.map((c, i) => {
            const k = look[c.id]!;
            return (
              <li key={c.id}>
                <a
                  href={k.href(locale)}
                  style={{ background: k.bg }}
                  className={`group flex h-full min-h-[12.5rem] flex-col rounded-[1.25rem] p-4 sm:min-h-[17rem] sm:rounded-[1.6rem] sm:p-6 transition-transform hover:-translate-y-1 focus-visible:-translate-y-1 lg:aspect-[5/7] ${
                    k.dark ? 'text-white' : 'text-[#1B1530]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    {icons[c.id]}
                    <div className="text-end">
                      <p className="text-[1.8rem] leading-none font-semibold tracking-[-0.04em] sm:text-[3rem]">
                        {String(i + 1).padStart(2, '0')}
                      </p>
                      <p className="mt-2 hidden max-w-[8rem] font-mono text-[0.66rem] sm:mt-3 sm:block tracking-[0.16em] uppercase opacity-80">
                        {c.label}
                      </p>
                    </div>
                  </div>
                  <div className="mt-auto flex items-end justify-between gap-2 pt-4 sm:pt-6">
                    <div className="min-w-0">
                      <h3 className="text-[1.3rem] leading-[1.05] font-semibold tracking-[-0.03em] break-words sm:text-[1.9rem]">
                        {c.title}
                      </h3>
                      <p className="mt-1.5 text-[0.78rem] leading-snug opacity-80 sm:mt-2 sm:text-[0.9rem]">
                        {c.body}
                      </p>
                    </div>
                    <span
                      className={`hidden h-10 w-10 shrink-0 sm:grid place-items-center rounded-full transition-colors ${
                        k.dark
                          ? 'bg-white/20 group-hover:bg-white/30'
                          : 'bg-black/10 group-hover:bg-black/15'
                      }`}
                    >
                      <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
                    </span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex flex-col gap-2 font-mono text-[0.7rem] tracking-[0.14em] text-ink-2 uppercase sm:flex-row sm:justify-between">
          <p>
            {t.alsoLabel}:{' '}
            {wearables.chips
              .map((ch) =>
                ch.status === 'soon' ? `${ch.label} (${wearables.soonLabel})` : ch.label,
              )
              .join(' · ')}
          </p>
          <p>{t.facts.join(' · ')}</p>
        </div>
      </div>
    </section>
  );
}
