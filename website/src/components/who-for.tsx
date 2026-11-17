import Link from 'next/link';

import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight } from './icons';
import { Kicker, SectionTitle } from './ui';

const BLOB =
  'M10 52C4 32 22 10 48 8c20-1 30 10 48 10 14 0 24 14 20 32-4 20-24 32-48 30-24-1-52 2-58-28Z';

/** Violet line + soft fill on a pale lavender blob. Decorative. */
function Art({ kind }: { kind: number }) {
  return (
    <svg
      viewBox="0 0 120 92"
      className="h-[5.75rem] w-[7.5rem] text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={BLOB} className="fill-accent-wash stroke-none" />
      <g fill="currentColor" fillOpacity="0.14">
        {kind === 0 ? (
          <>
            <circle cx="60" cy="38" r="9" />
            <path d="M43 68c0-10 7-17 17-17s17 7 17 17z" />
            <circle cx="36" cy="46" r="6" />
            <circle cx="84" cy="46" r="6" />
          </>
        ) : kind === 1 ? (
          <>
            <path d="M24 48l22-18 22 18v22H24z" />
            <ellipse cx="90" cy="52" rx="11" ry="4" />
          </>
        ) : (
          <>
            <path d="M24 54h44v18H24z" />
            <path d="M22 48V37l5-11h42l5 11v11z" />
            <circle cx="82" cy="56" r="4" />
            <circle cx="98" cy="56" r="4" />
          </>
        )}
      </g>
      {kind === 0 ? (
        <>
          <path d="M60 47a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM43 68c0-10 7-17 17-17s17 7 17 17zM30 68c0-8 2-14 7-16M90 68c0-8-2-14-7-16M36 52a6 6 0 1 1 0-12M84 52a6 6 0 1 0 0-12" />
          <path d="M98 12v6M91 19h6M105 19h-6M93 8l2 3M103 8l-2 3" />
        </>
      ) : kind === 1 ? (
        <>
          <path d="M20 50l26-22 26 22M28 44v26h36V44M40 70V57h12v13" />
          <path d="M79 52v14c0 2.2 5 4 11 4s11-1.8 11-4V52M79 59c0 2.2 5 4 11 4s11-1.8 11-4M90 56c-6 0-11-1.8-11-4s5-4 11-4 11 1.8 11 4-5 4-11 4Z" />
        </>
      ) : (
        <>
          <path d="M22 48V37l5-11h42l5 11v11M22 48a6.2 6.2 0 0 0 12.3 0 6.2 6.2 0 0 0 12.3 0 6.2 6.2 0 0 0 12.3 0 6.2 6.2 0 0 0 12.4 0M27 54v18h40V54M39 72V60h14v12" />
          <path d="M76 74c0-5 3-8 6-8s6 3 6 8M92 74c0-5 3-8 6-8s6 3 6 8M82 60a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM98 60a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
        </>
      )}
    </svg>
  );
}

/** Three audiences, each with the one page that sells to them. */
export function WhoFor({ t, locale }: { t: Dictionary['whoFor']; locale: string }) {
  return (
    <section id="who" aria-labelledby="who-title" className="on-light scroll-mt-20 py-10 lg:py-12">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <Kicker>{t.eyebrow}</Kicker>
        <SectionTitle id="who-title" className="mt-2">
          {t.title}
        </SectionTitle>
        <ul className="mt-6 grid gap-4 md:grid-cols-3">
          {t.items.map((item, i) => (
            <li
              key={item.title}
              className="flex flex-col rounded-3xl bg-surface p-5 shadow-[var(--w-shadow-card)]"
            >
              <Art kind={i} />
              <h3 className="mt-3 text-[1.15rem] font-bold text-ink">{item.title}</h3>
              <p className="mt-2 flex-1 text-[0.9rem] leading-[1.6] text-ink-2">{item.body}</p>
              <Link
                href={`/${locale}${item.href}`}
                className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-accent-wash px-4 py-2 text-[0.88rem] font-bold text-accent hover:brightness-95"
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
