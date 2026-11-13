import Link from 'next/link';

import type { Dictionary } from '@/i18n/dictionaries';
import { ArrowRight } from './icons';
import { OrbitBg } from './orbit-bg';
import { StoreBadges } from './store-badges';

const chip = {
  paid: 'bg-[#EDE9FE] text-[#5B3FD6]',
  owes: 'bg-[#FFE4DB] text-[#C2410C]',
  settled: 'bg-[#D1FAE5] text-[#047857]',
};

/** One person on the ring, positioned in % of the square orbit box. */
function Member({
  name,
  tone,
  chipTone,
  status,
  x,
  y,
}: {
  name: string;
  tone: string;
  chipTone: keyof typeof chip;
  status: string;
  x: number;
  y: number;
}) {
  return (
    <div
      className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-[#FBFAFF] py-1.5 ps-1.5 pe-3 text-[0.8rem] font-medium whitespace-nowrap text-[#1B1530] shadow-[0_14px_40px_rgb(0_0_0_/_0.35)] sm:text-[0.88rem]"
      style={{ left: `${x}%`, top: `${y}%` }}
    >
      <span
        className="grid h-7 w-7 place-items-center rounded-full text-[0.8rem] font-semibold text-[#1B1530] sm:h-8 sm:w-8"
        style={{ background: tone }}
      >
        {name.slice(0, 1)}
      </span>
      {name}
      <span
        className={`${chipTone === 'owes' ? 'inline' : 'hidden sm:inline'} rounded-full px-2 py-0.5 font-mono text-[0.68rem] ${chip[chipTone]}`}
      >
        {status}
      </span>
    </div>
  );
}

/** The Orbit hero (website/design.md): thin headline, a group as an orbit, moving currents. */
export function Hero({
  t,
  stores,
  locale,
}: {
  t: Dictionary['hero'];
  stores: Dictionary['stores'];
  locale: string;
}) {
  const o = t.orbit;
  const [asha, ravi, meera] = t.split.people;

  return (
    <section className="on-dark relative isolate overflow-hidden bg-[linear-gradient(160deg,#0E0B2A_0%,#150F45_60%,#1B1150_100%)] text-white">
      <OrbitBg />
      {/* Scrim so the copy never sits on the brightest part of a ribbon. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,rgb(14_11_42_/_0.75),transparent_55%)] rtl:bg-[linear-gradient(to_left,rgb(14_11_42_/_0.75),transparent_55%)]"
      />
      <div className="mx-auto grid w-full max-w-[80rem] items-center gap-10 px-5 pt-28 pb-10 sm:px-8 lg:min-h-[46rem] lg:grid-cols-[minmax(0,0.54fr)_minmax(0,0.46fr)] lg:gap-6 lg:pt-32">
        <div className="min-w-0">
          <p className="font-mono text-[0.75rem] tracking-[0.14em] text-[#FFB199] uppercase rtl:tracking-normal">
            {t.eyebrow}
          </p>
          <h1 className="mt-5 font-display text-[3rem] leading-[1.02] font-extralight tracking-[-0.03em] text-balance sm:text-[4.4rem] lg:text-[4.5rem] rtl:tracking-normal rtl:sm:text-[3.6rem] rtl:lg:text-[4.2rem]">
            {t.titleStart} <span className="font-light text-[#FF7A59]">{t.titleAccent}</span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-[1.1rem] leading-[1.55] font-light text-[#C9C3E6]">
            {t.subtitle}
          </p>
          <StoreBadges t={stores} className="mt-8" />
          <Link
            href={`/${locale}/companies`}
            className="mt-5 inline-flex items-center gap-1.5 text-[0.92rem] font-medium text-[#FFB199] hover:underline"
          >
            {t.ctaBusiness}
            <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
          </Link>
          <ul className="mt-8 flex flex-wrap gap-2.5">
            {t.trust.map((item) => (
              <li
                key={item}
                className="rounded-full border border-white/12 bg-white/[0.07] px-3.5 py-1.5 font-mono text-[0.75rem] text-[#D9D4F5]"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Positions are physical (left/top %), so the ring keeps its geometry in RTL. */}
        <div
          role="img"
          aria-label={o.label}
          className="relative mx-auto aspect-square w-full max-w-[38rem] min-w-0"
        >
          <div className="absolute inset-[8%] rounded-full border border-dashed border-[#C4B5FD]/35" />
          <div className="absolute inset-[23%] rounded-full border border-[#C4B5FD]/15" />
          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible">
            <defs>
              <linearGradient id="orbit-arc" x1="0" x2="1">
                <stop offset="0" stopColor="#FF7A59" />
                <stop offset="1" stopColor="#C4B5FD" />
              </linearGradient>
            </defs>
            <path
              id="orbit-path"
              d="M 29 84 Q 80 78 81 22"
              fill="none"
              stroke="url(#orbit-arc)"
              strokeWidth="2"
              opacity="0.25"
            />
            <path
              d="M 29 84 Q 80 78 81 22"
              fill="none"
              stroke="url(#orbit-arc)"
              strokeWidth="0.45"
            />
            <circle r="0.9" fill="#fff" className="orbit-spark">
              <animateMotion dur="3.2s" repeatCount="indefinite">
                <mpath href="#orbit-path" />
              </animateMotion>
            </circle>
          </svg>

          <div className="absolute top-1/2 left-1/2 w-[44%] -translate-x-1/2 -translate-y-1/2 rounded-3xl bg-[#FBFAFF] p-4 text-[#1B1530] shadow-[0_30px_80px_rgb(0_0_0_/_0.45)] sm:p-6">
            <p className="font-mono text-[0.68rem] tracking-[0.1em] text-[#5B546F] uppercase">
              {o.groupLabel}
            </p>
            <p className="mt-1 text-[1.05rem] font-medium sm:text-[1.35rem]">{o.group}</p>
            <p className="mt-1 font-mono text-[1.5rem] font-medium text-[#C2410C] sm:text-[2rem]">
              {o.total}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#EDE9FE]">
              <div className="h-full w-[62%] bg-[#7A5AF8]" />
            </div>
            <p className="mt-2.5 text-[0.75rem] text-[#5B546F] sm:text-[0.82rem]">{o.meta}</p>
          </div>

          <Member name={asha} tone="#C4B5FD" chipTone="settled" status={o.settled} x={50} y={8} />
          <Member name={o.you} tone="#FF7A59" chipTone="paid" status={o.paid} x={81} y={22} />
          <Member name={ravi} tone="#F5B544" chipTone="owes" status={o.owes} x={29} y={84} />
          <Member name={meera} tone="#10B981" chipTone="settled" status={o.settled} x={19} y={22} />
          <p className="absolute top-[86%] left-[78%] -translate-x-1/2 rounded-full border border-dashed border-[#FFB199]/70 px-3 py-1.5 font-mono text-[0.7rem] whitespace-nowrap text-[#FFB199] sm:text-[0.8rem]">
            {o.invite}
          </p>
        </div>
      </div>

      <div className="mx-auto flex max-w-[80rem] flex-wrap items-end justify-between gap-4 px-5 pb-10 sm:px-8 lg:pb-24">
        <p className="w-full border-t border-white/10 pt-6 font-display text-[1.5rem] font-extralight text-[#C9C3E6] sm:text-[1.9rem]">
          {o.statementStart} <span className="font-light text-white">{o.statementEnd}</span>
        </p>
      </div>
    </section>
  );
}
