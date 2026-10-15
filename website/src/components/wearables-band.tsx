import type { Dictionary } from '@/i18n/dictionaries';
import { Check, Mic, Plus } from './icons';
import { Kicker } from './ui';

type T = Dictionary['wearables'];

/**
 * "Watch and widgets". Every screen here is drawn from the shipped code, in the
 * app's own English (neither the watch targets nor the Android widgets are
 * translated):
 *   - watch: apps/mobile/targets/watch/Views.swift (Home: Speak / Quick add /
 *     Recent; the voice outcome "Added ₹120 · Auto"; the Recent list)
 *   - widgets: apps/mobile/targets/widgets/index.swift and
 *     plugins/withWavesWidgets.js (Add expense, What did you spend on?, the
 *     action grid).
 * The widgets hold no data and show no balances, and neither does the watch, so
 * nothing here pretends to. Static CSS and text only; no raster images.
 */

function Glyph({ d, className = 'h-3.5 w-3.5' }: { d: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

const CLOCK = 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z';
const CAMERA = 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z';
const PEN = 'M4 20l4-1 11-11-3-3L5 16zM14 6l3 3';
const FOOD = 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2.5 6 0 8v10';
const CAR = 'M5 16V11l2-5h10l2 5v5M3 16h18M7.5 16.5v2M16.5 16.5v2';
const BAG = 'M6 8h12l1 12H5zM9 8V6a3 3 0 0 1 6 0v2';
const GEAR =
  'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19 12l2-1-1-3-2 .5-1.5-1.5.5-2-3-1-1 2h-2l-1-2-3 1 .5 2L6 8.5 4 8l-1 3 2 1v0l-2 1 1 3 2-.5L7.5 17l-.5 2 3 1 1-2h2l1 2 3-1-.5-2 1.5-1.5 2 .5 1-3z';

function Chip({ kind, label, status, t }: { kind: string; label: string; status: string; t: T }) {
  const soon = status === 'soon';
  return (
    <li
      data-kind={kind}
      className={`inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[0.84rem] font-medium shadow-[var(--w-shadow-sm)] ${
        soon ? 'bg-chip text-ink-2' : 'bg-surface text-ink'
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${soon ? 'bg-ink-3' : 'bg-accent'}`}
        aria-hidden="true"
      />
      {label}
      <span
        className={`rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${
          soon ? 'bg-surface text-ink-3' : 'bg-accent-wash text-accent'
        }`}
      >
        {soon ? t.soonLabel : t.availableLabel}
      </span>
    </li>
  );
}

/** A watch body: black case, rounded screen, as the SwiftUI views render on it. */
function Watch({ children }: { children: React.ReactNode }) {
  return (
    <div
      dir="ltr"
      lang="en"
      className="h-[13rem] w-[10.6rem] shrink-0 rounded-[2.6rem] bg-[#1c1b22] p-[0.55rem] shadow-[var(--w-shadow-card)]"
    >
      <div className="flex h-full flex-col overflow-hidden rounded-[2.1rem] bg-black px-3 pt-3 pb-2 text-white">
        {children}
      </div>
    </div>
  );
}

const WATCH_ACCENT = 'text-[#7a5af8]';

function WatchRow({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-[#1f1f24] px-2 py-[0.33rem] text-[0.82rem] font-medium">
      <span className={WATCH_ACCENT}>{icon}</span>
      {label}
    </div>
  );
}

function WatchHome() {
  return (
    <Watch>
      <p className={`text-[0.9rem] font-semibold ${WATCH_ACCENT}`}>Waves</p>
      <div className="mt-1.5 space-y-1">
        <WatchRow icon={<Mic className="h-3.5 w-3.5" />} label="Speak" />
        <WatchRow icon={<Plus className="h-3.5 w-3.5" />} label="Quick add" />
        <WatchRow icon={<Glyph d={CLOCK} />} label="Recent" />
      </div>
    </Watch>
  );
}

function WatchAdded() {
  return (
    <Watch>
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
        <Check className={`h-6 w-6 ${WATCH_ACCENT}`} />
        <p className="text-[0.86rem] leading-tight font-medium">Added ₹120 · Auto</p>
        <span className="mt-0.5 rounded-full bg-[#2a2a30] px-3 py-1 text-[0.74rem] font-medium">
          Done
        </span>
      </div>
    </Watch>
  );
}

function WatchRecent() {
  const rows = [
    ['Dinner', '₹600', 'Goa Trip · 2h ago'],
    ['Cab', '₹350', 'Goa Trip · 1d ago'],
    ['Chai', '₹40', 'Flat 4B · 2d ago'],
  ];
  return (
    <Watch>
      <p className={`text-[0.9rem] font-semibold ${WATCH_ACCENT}`}>Recent</p>
      <div className="mt-1.5 space-y-1.5">
        {rows.map(([title, amount, sub]) => (
          <div key={title} className="border-b border-white/10 pb-1 last:border-0">
            <div className="flex items-center justify-between text-[0.82rem]">
              <span>{title}</span>
              <span className="font-bold tabular-nums">{amount}</span>
            </div>
            <p className="text-[0.62rem] text-white/50">{sub}</p>
          </div>
        ))}
      </div>
    </Watch>
  );
}

function RoundBtn({ d, children }: { d?: string; children?: React.ReactNode }) {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-wash text-accent">
      {children ?? <Glyph d={d ?? ''} className="h-4 w-4" />}
    </span>
  );
}

function WLogo() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.6rem] bg-accent text-[0.95rem] font-bold text-accent-ink">
      W
    </span>
  );
}

const widgetCard =
  'rounded-[1.4rem] border border-line/60 bg-surface p-3 shadow-[var(--w-shadow-card)]';

function WidgetCompact() {
  return (
    <div dir="ltr" lang="en" className={`${widgetCard} flex items-center gap-2.5`}>
      <WLogo />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[0.88rem] font-semibold text-ink">Add expense</p>
        <p className="truncate text-[0.72rem] text-ink-2">Tap to add quickly</p>
      </div>
      <div className="flex gap-1.5">
        <RoundBtn d={CAMERA} />
        <RoundBtn>
          <Mic className="h-4 w-4" />
        </RoundBtn>
        <RoundBtn d={PEN} />
      </div>
    </div>
  );
}

function CatChip({ d, label, tone }: { d: string; label: string; tone: string }) {
  return (
    <span
      className={`flex flex-1 items-center justify-center gap-1 rounded-full bg-chip px-1.5 py-1.5 text-[0.7rem] font-medium text-ink ${tone}`}
    >
      <Glyph d={d} className="h-3.5 w-3.5" />
      <span className="truncate text-ink">{label}</span>
    </span>
  );
}

function WidgetSearch() {
  return (
    <div dir="ltr" lang="en" className={`${widgetCard} space-y-2`}>
      <div className="flex items-center gap-2 rounded-full bg-bg py-1 ps-1.5 pe-2">
        <WLogo />
        <span className="flex-1 truncate text-[0.8rem] text-ink-2">What did you spend on?</span>
        <Mic className="h-4.5 w-4.5 text-ink" />
      </div>
      <div className="flex gap-1.5">
        <CatChip d={FOOD} label="Food" tone="text-[#b8690f]" />
        <CatChip d={CAR} label="Travel" tone="text-[#1d68a3]" />
        <CatChip d={BAG} label="Shopping" tone="text-[#964450]" />
        <span className="flex w-9 items-center justify-center rounded-full bg-chip text-[0.8rem] font-bold text-ink">
          …
        </span>
      </div>
    </div>
  );
}

function Tile({ d, label, sub, mic }: { d?: string; label: string; sub: string; mic?: boolean }) {
  return (
    <span className="flex flex-1 flex-col items-center gap-0.5 rounded-2xl bg-chip px-1 py-1.5 text-center">
      <span className="text-accent">
        {mic ? <Mic className="h-4 w-4" /> : <Glyph d={d ?? ''} className="h-4 w-4" />}
      </span>
      <span className="text-[0.7rem] font-semibold text-ink">{label}</span>
      <span className="w-full truncate text-[0.58rem] text-ink-2">{sub}</span>
    </span>
  );
}

function WidgetGrid() {
  return (
    <div dir="ltr" lang="en" className={`${widgetCard} space-y-2`}>
      <div className="flex items-center gap-2">
        <WLogo />
        <div className="min-w-0 flex-1">
          <p className="text-[0.86rem] font-semibold text-ink">Waves</p>
          <p className="truncate text-[0.68rem] text-ink-2">Capture expenses, anywhere</p>
        </div>
        <span className="text-ink-2">
          <Glyph d={GEAR} className="h-4 w-4" />
        </span>
      </div>
      <div className="flex gap-1.5">
        <Tile d={CAMERA} label="Photo" sub="Add with photo" />
        <Tile mic label="Voice" sub="Say it out loud" />
        <Tile d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M4 12h16" label="Scan" sub="Scan receipt" />
        <Tile d={PEN} label="Manual" sub="Type it" />
      </div>
    </div>
  );
}

export function WearablesBand({ t }: { t: T }) {
  return (
    <section id="wearables" aria-labelledby="wearables-title" className="scroll-mt-20 py-6 lg:py-8">
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <div className="grid items-end gap-4 lg:grid-cols-[1.2fr_1fr] lg:gap-10">
          <div>
            <Kicker>{t.eyebrow}</Kicker>
            <h2
              id="wearables-title"
              className="mt-1.5 text-balance text-[1.5rem] leading-[1.15] font-bold tracking-[-0.02em] text-ink sm:text-[1.9rem]"
            >
              {t.title}
            </h2>
            <p className="mt-2.5 text-[0.92rem] leading-[1.6] text-ink-2">{t.body}</p>
          </div>
          <ul className="flex flex-wrap gap-2 lg:justify-end">
            {t.chips.map((c) => (
              <Chip key={c.id} kind={c.id} label={c.label} status={c.status} t={t} />
            ))}
          </ul>
        </div>

        <div className="mt-5 grid items-start gap-4 lg:grid-cols-[1.25fr_1fr] lg:gap-5">
          <figure className="min-w-0 rounded-[1.75rem] bg-accent-wash p-4 sm:p-5">
            <figcaption className="text-[0.92rem] font-semibold text-ink">
              {t.watchTitle}
            </figcaption>
            <div
              className="mt-3 flex flex-1 snap-x items-center justify-start gap-3 overflow-x-auto pb-3 sm:justify-center"
              aria-hidden="true"
            >
              <WatchHome />
              <WatchAdded />
              <WatchRecent />
            </div>
            <p className="mt-2 text-[0.8rem] text-ink-2">{t.watchCaption}</p>
          </figure>

          <figure className="min-w-0 rounded-[1.75rem] bg-accent-wash p-4 sm:p-5">
            <figcaption className="text-[0.92rem] font-semibold text-ink">
              {t.widgetsTitle}
            </figcaption>
            <div className="mt-3 space-y-2.5" aria-hidden="true">
              <WidgetCompact />
              <WidgetSearch />
              <WidgetGrid />
            </div>
            <p className="mt-2 text-[0.8rem] text-ink-2">{t.widgetCaption}</p>
          </figure>
        </div>
        <p className="mt-2 text-[0.76rem] text-ink-3">{t.mockNote}</p>

        <h3 className="mt-5 text-[1.05rem] font-bold text-ink">{t.examplesTitle}</h3>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
          {t.examples.map((ex) => (
            <li
              key={ex.title}
              className="rounded-3xl bg-surface p-3.5 shadow-[var(--w-shadow-card)]"
            >
              <span className="inline-flex h-6 items-center rounded-full bg-chip px-2.5 text-[0.7rem] font-medium text-ink-2">
                {ex.where}
              </span>
              <p className="mt-2 text-[0.95rem] font-semibold text-ink">{ex.title}</p>
              <p className="mt-1 text-[0.84rem] leading-[1.5] text-ink-2">
                <bdi>{ex.body}</bdi>
              </p>
            </li>
          ))}
        </ul>

        <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {t.points.map((line) => (
            <li key={line} className="flex items-start gap-2 text-[0.86rem] text-ink-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[0.82rem] font-medium text-accent">{t.soonNote}</p>
      </div>
    </section>
  );
}
