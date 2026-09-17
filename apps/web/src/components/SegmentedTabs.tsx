'use client';

/**
 * One row of segmented tabs, the shape the phone uses.
 *
 * Deliberately a set of real tabs rather than three links: the three faces of a
 * group are three readings of rows already loaded, so switching between them
 * should not cost a navigation, and a person comparing balances against the
 * feed should not lose their place doing it.
 *
 * Keyboard behaviour is the tablist pattern — arrows move between tabs, Home
 * and End jump to the ends — because a segmented control that can only be
 * reached by Tab and then not operated is a control half the people who need
 * it cannot use.
 */

import { useRef } from 'react';

export interface Tab<T extends string> {
  value: T;
  label: string;
  /** Shown after the label, for a count. Omitted rather than zero. */
  badge?: number;
}

export function SegmentedTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
}: {
  tabs: readonly Tab<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Names the set for a screen reader — "Group views", not "Tabs". */
  label: string;
}) {
  const strip = useRef<HTMLDivElement>(null);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();

    const at = tabs.findIndex((tab) => tab.value === value);
    // Arrows follow the reading direction, so in Arabic the left arrow moves
    // the way the eye does rather than the way the array runs.
    const rtl = getComputedStyle(strip.current ?? document.body).direction === 'rtl';
    const back = rtl ? 'ArrowRight' : 'ArrowLeft';

    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : event.key === back
            ? (at - 1 + tabs.length) % tabs.length
            : (at + 1) % tabs.length;

    const target = tabs[next];
    if (!target) return;
    onChange(target.value);
    strip.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div ref={strip} role="tablist" aria-label={label} className="tabs" onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={`tab-${tab.value}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.value}`}
            // Only the selected tab is in the tab order; the arrows reach the
            // rest. Tabbing through every segment to leave the strip is what
            // makes a segmented control tedious with a keyboard.
            tabIndex={selected ? 0 : -1}
            className="tab"
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
            {tab.badge ? <span className="tab-count">{tab.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
