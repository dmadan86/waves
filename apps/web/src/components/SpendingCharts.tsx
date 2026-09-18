'use client';

/**
 * Two charts, drawn in CSS.
 *
 * No charting library. A bar list is a row with a filled track, and a column
 * chart is a row of boxes with heights — both are a few rules, and the page
 * already ships a design system that knows the colours. Pulling in a chart
 * package to draw twelve rectangles would cost more bytes than the rest of the
 * route and give the tints back in somebody else's palette.
 *
 * What matters more than the drawing: both charts are readable without seeing
 * them. The figure is written beside every bar rather than encoded only in its
 * length, the bars are a list to a screen reader, and each column is a link
 * that says what it stands for and where it goes. A chart nobody can read is a
 * decoration.
 *
 * The bars are sized against the largest value, not the total: the question is
 * "what did we spend most on", and against a total every bar in a group with
 * eight categories is a sliver.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';

/** One bar: something named, what it came to, and how it compares. */
export interface Bar {
  key: string;
  label: string;
  /** Already formatted for the reader's locale. */
  formatted: string;
  value: bigint;
  /** A tint name from the design system, for the fill. */
  tint?: string;
  leading?: ReactNode;
}

export function BarList({ bars }: { bars: Bar[] }) {
  const largest = bars.reduce((most, bar) => (bar.value > most ? bar.value : most), 0n);

  return (
    <ul className="bars">
      {bars.map((bar) => (
        <li key={bar.key} className="bar-row">
          <span className="bar-head">
            <span className="bar-label">
              {bar.leading}
              {bar.label}
            </span>
            <span className="bar-value">{bar.formatted}</span>
          </span>
          {/* The track is decoration: the sentence above it already carries
              both the name and the figure, so a screen reader is told to skip
              the geometry rather than read a width out. */}
          <span className="bar-track" aria-hidden>
            <span
              className="bar-fill"
              style={{
                width: largest > 0n ? `${percent(bar.value, largest)}%` : '0%',
                background: bar.tint ? `var(--w-tint-${bar.tint})` : 'var(--w-brand-soft)',
              }}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** One column: a period, what it came to, and where tapping it goes. */
export interface Column {
  key: string;
  label: string;
  formatted: string;
  value: bigint;
  href: string;
}

export function ColumnChart({
  columns,
  describe,
}: {
  columns: Column[];
  describe: (column: Column) => string;
}) {
  const tallest = columns.reduce((most, column) => (column.value > most ? column.value : most), 0n);
  const strip = useRef<HTMLDivElement>(null);

  // Six columns do not fit a phone, so the strip scrolls — and left to itself it
  // would open on the oldest months with this month off the end, which is the
  // one somebody came to see. Start at the recent end instead. In a
  // right-to-left page the recent end is the left one, and `scrollWidth` is
  // still the distance to it, so the sign follows the direction.
  useEffect(() => {
    const node = strip.current;
    if (!node) return;
    const overflow = node.scrollWidth - node.clientWidth;
    if (overflow <= 0) return;
    const rtl = getComputedStyle(node).direction === 'rtl';
    node.scrollLeft = rtl ? -overflow : overflow;
  }, [columns]);

  return (
    <div className="columns" ref={strip}>
      {columns.map((column) => (
        // A column is a way in, not a picture: it opens the month it stands
        // for. Sized as a link rather than drawn and then made clickable, so
        // the whole column is the target and the keyboard reaches it.
        <Link key={column.key} className="column" href={column.href} aria-label={describe(column)}>
          <span className="column-value">{column.formatted}</span>
          <span className="column-track" aria-hidden>
            <span
              className="column-fill"
              style={{
                // A month with nothing in it still gets a hairline, so the
                // gap in the sequence is visible rather than missing.
                height: tallest > 0n ? `max(2px, ${percent(column.value, tallest)}%)` : '2px',
              }}
            />
          </span>
          <span className="column-label">{column.label}</span>
        </Link>
      ))}
    </div>
  );
}

/**
 * A share of the largest, as a percentage.
 *
 * In integer arithmetic: these are minor units in bigint, and going through a
 * float to draw a box would be the one place in the app that rounds money for
 * display. Two decimal places is finer than a pixel on any screen this runs on.
 */
function percent(value: bigint, largest: bigint): number {
  if (largest <= 0n) return 0;
  const scaled = (value * 10000n) / largest;
  return Number(scaled) / 100;
}
