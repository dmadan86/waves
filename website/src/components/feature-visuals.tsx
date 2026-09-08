import type { Dictionary } from '@/i18n/dictionaries';
import { Alert, Lock, Receipt } from './icons';

type VisualProps = { t: Dictionary['visuals'] };

/**
 * The product, drawn.
 *
 * Every one of these is real UI reduced to its skeleton — a panel, hairlines,
 * mono figures — rather than an illustration standing in for one. Drawing them
 * means they translate, they stay sharp at any density, they invert with the
 * theme, and they weigh nothing.
 *
 * The rule the app follows holds here: a direction is never carried by colour
 * alone. Every amount that means something arrives with a sign, a word, or
 * both.
 */

/*
 * These are drawn in live DOM rather than shipped as images, which is what
 * makes them translate and stay sharp — but it also means a screen reader
 * would otherwise read a hundred context-free fragments interleaved with the
 * real copy. `role="img"` makes each one a single leaf node carrying one
 * translated summary, exactly as a picture of it would.
 */
function Frame({
  children,
  label,
  alt,
}: {
  children: React.ReactNode;
  label?: string;
  alt?: string;
}) {
  return (
    <figure
      role={alt ? 'img' : undefined}
      aria-label={alt}
      className="panel-raised overflow-hidden"
    >
      {label ? (
        <figcaption className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5 font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
          {label}
        </figcaption>
      ) : null}
      {children}
    </figure>
  );
}

/** 1 — Splits. The bill and the split add up, to the last minor unit. */
function SplitVisual({ t }: VisualProps) {
  return (
    <Frame label={t.split.label} alt={t.split.alt}>
      <div className="px-4 pt-4 pb-3">
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-[0.9375rem] text-ink">{t.split.bill}</span>
          <span className="font-mono tabular text-[1.125rem] font-medium text-ink">
            {t.split.total}
          </span>
        </p>

        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={t.split.typesLabel}>
          {t.split.types.map((type, index) => (
            <li
              key={type}
              className={`rounded-sm px-2 py-1 font-mono text-[0.6875rem] ${
                index === 0 ? 'bg-accent text-accent-ink' : 'bg-chip text-ink-2'
              }`}
            >
              {type}
            </li>
          ))}
        </ul>
      </div>

      <ul className="divide-y divide-divider border-t border-line">
        {t.split.people.map((person) => (
          <li key={person.name} className="flex items-baseline gap-3 px-4 py-2.5">
            <span className="flex-1 truncate text-[0.8125rem] text-ink-2">{person.name}</span>
            <span className="font-mono tabular text-[0.8125rem] text-ink">{person.share}</span>
          </li>
        ))}
      </ul>

      <p className="flex items-baseline justify-between gap-3 border-t border-line bg-chip px-4 py-2.5">
        <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
          {t.split.checkLabel}
        </span>
        <span className="font-mono tabular text-[0.8125rem] text-ink">{t.split.total}</span>
      </p>
    </Frame>
  );
}

/** 2 — Offline. A queue that is not an error state. */
function OfflineVisual({ t }: VisualProps) {
  return (
    <Frame label={t.offline.label} alt={t.offline.alt}>
      <p className="flex items-center gap-2 border-b border-line px-4 py-2.5 font-mono text-[0.75rem] text-ink-2">
        <Alert className="h-3.5 w-3.5 text-ink-3" aria-hidden="true" />
        {t.offline.noSignal}
        <span className="ms-auto text-ink-3">{t.offline.waiting}</span>
      </p>

      <ul className="divide-y divide-divider">
        {t.offline.rows.map((row) => (
          <li key={row} className="flex items-center gap-3 px-4 py-2.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
            <span className="flex-1 truncate text-[0.8125rem] text-ink-2">{row}</span>
            <span className="font-mono text-[0.6875rem] text-ink-3">{t.offline.queued}</span>
          </li>
        ))}
      </ul>

      <p className="flex items-center gap-2 border-t border-line bg-chip px-4 py-2.5 font-mono text-[0.6875rem] text-ink-3">
        <Lock className="h-3.5 w-3.5" aria-hidden="true" />
        {t.offline.encrypted}
      </p>
    </Frame>
  );
}

/** 3 — Trips and currencies. One rate, fixed, and both columns shown. */
function TripVisual({ t }: VisualProps) {
  return (
    <Frame label={t.trip.label} alt={t.trip.alt}>
      <div className="border-b border-line px-4 py-4">
        <p className="font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
          {t.trip.rateLabel}
        </p>
        <p className="mt-1 font-mono tabular text-[1.25rem] font-medium tracking-[-0.02em] text-ink">
          {t.trip.rate}
        </p>
        <p className="mt-1 font-mono text-[0.6875rem] text-ink-3">{t.trip.rateNote}</p>
      </div>

      <table className="w-full text-start">
        <thead>
          <tr className="border-b border-line">
            {t.trip.columns.map((column, index) => (
              <th
                key={column}
                scope="col"
                className={`px-4 py-2 font-mono text-[0.6875rem] font-normal tracking-[0.06em] text-ink-3 uppercase ${
                  index === 0 ? 'text-start' : 'text-end'
                }`}
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {t.trip.rows.map((row) => (
            <tr key={row.label}>
              <td className="px-4 py-2.5 text-[0.8125rem] text-ink-2">{row.label}</td>
              <td className="px-4 py-2.5 text-end font-mono tabular text-[0.8125rem] text-ink-2">
                {row.foreign}
              </td>
              <td className="px-4 py-2.5 text-end font-mono tabular text-[0.8125rem] text-ink">
                {row.home}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  );
}

/** 4 — Capture. The receipt itemised, and the same expense spoken. */
function CaptureVisual({ t }: VisualProps) {
  return (
    <div role="img" aria-label={t.capture.alt} className="grid gap-3">
      <Frame label={t.capture.label}>
        <div className="flex items-start gap-3 px-4 py-3.5">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-chip text-ink-3">
            <Receipt className="h-4 w-4" aria-hidden="true" />
          </span>
          <ul className="min-w-0 flex-1 space-y-1.5">
            {t.capture.items.map((item) => (
              <li key={item.name} className="flex items-baseline gap-3">
                <span className="flex-1 truncate text-[0.8125rem] text-ink-2">{item.name}</span>
                <span className="font-mono tabular text-[0.8125rem] text-ink-2">{item.price}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="flex items-baseline justify-between gap-3 border-t border-line bg-chip px-4 py-2.5">
          <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
            {t.capture.total}
          </span>
          <span className="font-mono tabular text-[0.875rem] font-medium text-ink">
            {t.capture.totalValue}
          </span>
        </p>
      </Frame>

      <div className="panel flex items-center gap-3 px-4 py-3.5">
        {/* A level meter, drawn: fixed bars, no animation to sit through. */}
        <span aria-hidden="true" className="flex h-6 items-center gap-[3px]">
          {[6, 12, 20, 14, 24, 10, 16, 8, 18, 11].map((height, index) => (
            <span
              key={index}
              style={{ height: `${height}px` }}
              className="w-[3px] rounded-full bg-accent/70"
            />
          ))}
        </span>
        <p className="min-w-0 flex-1 text-[0.8125rem] leading-snug text-ink-2 italic">
          {t.capture.quote}
        </p>
      </div>
    </div>
  );
}

/**
 * 5 — Settling. The one thing the copy has always claimed and never shown:
 * a tangle of debts collapsing to the fewest payments that clear it.
 *
 * Both states are drawn side by side rather than animated between, so the
 * comparison is legible in the page's first still frame and to anyone who
 * never scrolls it into view. The only motion is the dashed flow along the two
 * surviving payments, and reduced motion stops it.
 */
const NODES = [
  { x: 80, y: 14 },
  { x: 121.8, y: 44.4 },
  { x: 105.9, y: 93.6 },
  { x: 54.1, y: 93.6 },
  { x: 38.2, y: 44.4 },
] as const;

const TANGLE = [
  [0, 1],
  [1, 2],
  [2, 0],
  [3, 1],
  [4, 2],
  [0, 4],
  [3, 0],
] as const;

const SIMPLIFIED = [
  [3, 0],
  [1, 0],
] as const;

function DebtGraph({
  edges,
  flowing = false,
}: {
  edges: readonly (readonly [number, number])[];
  flowing?: boolean;
}) {
  return (
    <svg viewBox="0 0 160 108" className="h-auto w-full" aria-hidden="true">
      {edges.map(([from, to]) => {
        const a = NODES[from];
        const b = NODES[to];
        return (
          <line
            key={`${from}-${to}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={flowing ? 'var(--w-accent)' : 'var(--w-line-strong)'}
            strokeWidth={flowing ? 1.6 : 1}
            strokeLinecap="round"
            strokeDasharray={flowing ? '4 3' : undefined}
            className={flowing ? 'animate-flow' : undefined}
          />
        );
      })}
      {NODES.map((node, index) => (
        <circle
          key={index}
          cx={node.x}
          cy={node.y}
          r="6.5"
          fill="var(--w-surface)"
          stroke={flowing && index === 0 ? 'var(--w-accent)' : 'var(--w-line-strong)'}
          strokeWidth="1.4"
        />
      ))}
    </svg>
  );
}

function SettleVisual({ t }: VisualProps) {
  return (
    <div role="img" aria-label={t.settle.alt} className="grid gap-3">
      <div className="grid grid-cols-2 gap-3">
        {[
          {
            caption: t.settle.beforeLabel,
            count: t.settle.beforeCount,
            edges: TANGLE,
            flow: false,
          },
          {
            caption: t.settle.afterLabel,
            count: t.settle.afterCount,
            edges: SIMPLIFIED,
            flow: true,
          },
        ].map((panel) => (
          <figure key={panel.caption} className="panel px-3 py-3">
            <DebtGraph edges={panel.edges} flowing={panel.flow} />
            <figcaption className="mt-2 flex items-baseline justify-between gap-2">
              <span className="font-mono text-[0.6875rem] tracking-[0.06em] text-ink-3 uppercase">
                {panel.caption}
              </span>
              <span
                className={`font-mono tabular text-[0.8125rem] ${panel.flow ? 'text-accent' : 'text-ink-2'}`}
              >
                {panel.count}
              </span>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="panel px-4 py-3.5">
        <p className="flex items-baseline justify-between gap-3">
          <span className="text-[0.875rem] text-ink">{t.settle.line}</span>
          <span className="font-mono tabular text-[0.875rem] font-medium text-ink">
            {t.settle.amount}
          </span>
        </p>
        {/* Partial settlement, as a real proportion rather than a decorative bar. */}
        <p className="mt-3 flex items-baseline justify-between gap-3 font-mono text-[0.6875rem] text-ink-3">
          <span>{t.settle.paidLabel}</span>
          <span className="tabular">{t.settle.paidValue}</span>
        </p>
        {/* The fraction comes from the dictionary because the amounts do:
            every language shows its own money, so one hardcoded width would
            be right in one of the four and visibly wrong in the other three. */}
        <span
          aria-hidden="true"
          className="mt-1.5 block h-1 w-full overflow-hidden rounded-full bg-chip"
        >
          <span
            className="block h-full rounded-full bg-accent"
            style={{ inlineSize: `${t.settle.paidPercent}%` }}
          />
        </span>
        <p className="mt-3 flex items-center gap-2 font-mono text-[0.6875rem] text-ink-3">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-line-strong" />
          {t.settle.awaiting}
        </p>
      </div>
    </div>
  );
}

/** 6 — The private side. */
function PersonalVisual({ t }: VisualProps) {
  return (
    <Frame label={t.personal.label} alt={t.personal.alt}>
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="inline-flex items-center gap-1.5 rounded-sm bg-accent-wash px-2 py-1 font-mono text-[0.6875rem] text-accent">
          <Lock className="h-3 w-3" aria-hidden="true" />
          {t.personal.onlyYou}
        </span>
        <span className="font-mono text-[0.6875rem] text-ink-3">{t.personal.month}</span>
      </div>

      <dl className="grid grid-cols-2 divide-x divide-divider border-b border-line rtl:divide-x-reverse">
        <div className="px-4 py-3.5">
          <dt className="font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
            {t.personal.spent}
          </dt>
          <dd className="mt-1 font-mono tabular text-[1.125rem] font-medium text-ink">
            {t.personal.spentValue}
          </dd>
        </div>
        <div className="px-4 py-3.5">
          <dt className="font-mono text-[0.6875rem] tracking-[0.08em] text-ink-3 uppercase">
            {t.personal.left}
          </dt>
          <dd className="mt-1 font-mono tabular text-[1.125rem] font-medium text-ink">
            {t.personal.leftValue}
          </dd>
        </div>
      </dl>

      <ul className="divide-y divide-divider">
        {t.personal.rows.map((row) => (
          <li key={row.title} className="flex items-baseline gap-3 px-4 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.8125rem] text-ink">{row.title}</span>
              <span className="mt-0.5 block truncate font-mono text-[0.6875rem] text-ink-3">
                {row.meta}
              </span>
            </span>
            <span className="shrink-0 font-mono tabular text-[0.8125rem] text-ink-2">
              {row.amount}
            </span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

export const featureVisuals = [
  SplitVisual,
  OfflineVisual,
  TripVisual,
  CaptureVisual,
  SettleVisual,
  PersonalVisual,
] as const;
