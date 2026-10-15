'use client';

import { useId, useRef, useState } from 'react';

import { CopyCode } from './copy-code';

export type SetupTab = {
  id: string;
  name: string;
  steps: string[];
  /** Label above the snippet, when the tab has one. */
  snippetLabel?: string;
  /** The snippet itself — code, never translated. */
  snippet?: string;
  /** A second, labelled code block (the generic tab's discovery address). */
  extra?: { label: string; code: string };
  /** A closing sentence under the snippet. */
  after?: string;
};

/**
 * Tabs per client. Arrow keys move between tabs (roving tabindex), as a tab
 * list is expected to; every panel stays in the DOM and hidden so the setup
 * text is still in the page for anything that reads it without script.
 */
export function McpSetup({
  tabs,
  endpoint,
  endpointLabel,
  copyLabel,
  copy,
  copied,
  label,
}: {
  tabs: SetupTab[];
  /** The server address, shown beside every client's steps. */
  endpoint: string;
  endpointLabel: string;
  copyLabel: string;
  copy: string;
  copied: string;
  label: string;
}) {
  const [active, setActive] = useState(0);
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (event: React.KeyboardEvent, i: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const next = (d: number) => (i + d + tabs.length) % tabs.length;
    let target: number | null = null;
    if (event.key === 'ArrowRight') target = next(rtl ? -1 : 1);
    else if (event.key === 'ArrowLeft') target = next(rtl ? 1 : -1);
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = tabs.length - 1;
    if (target === null) return;
    event.preventDefault();
    setActive(target);
    refs.current[target]?.focus();
  };

  const copyProps = { copyLabel, copy, copied };

  return (
    <div>
      <div role="tablist" aria-label={label} className="flex flex-wrap gap-2">
        {tabs.map((tab, i) => (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[i] = node;
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${tab.id}`}
            aria-selected={active === i}
            aria-controls={`${base}-panel-${tab.id}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => onKey(e, i)}
            className={`inline-flex h-9 shrink-0 items-center rounded-full px-4 text-[0.84rem] font-semibold whitespace-nowrap transition-colors ${
              active === i
                ? 'bg-accent text-accent-ink shadow-[0_6px_16px_rgb(122_90_248_/_0.28)]'
                : 'bg-chip text-ink-2 hover:text-ink'
            }`}
          >
            {tab.name}
          </button>
        ))}
      </div>

      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-panel-${tab.id}`}
          aria-labelledby={`${base}-tab-${tab.id}`}
          hidden={active !== i}
          className="mt-5 grid gap-6 lg:grid-cols-[1fr_21.5rem] lg:gap-8"
        >
          <ol className="space-y-3 self-center">
            {tab.steps.map((step, n) => (
              <li key={step} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-wash text-[0.75rem] font-bold text-accent">
                  {n + 1}
                </span>
                <span className="text-[0.9rem] leading-[1.55] text-ink-2">{step}</span>
              </li>
            ))}
          </ol>
          <div className="min-w-0 space-y-3 rounded-2xl bg-chip/70 p-3.5">
            <CopyCode code={endpoint} label={endpointLabel} inline compact {...copyProps} />
            {tab.snippet ? (
              <CopyCode code={tab.snippet} label={tab.snippetLabel} compact {...copyProps} />
            ) : null}
            {tab.extra ? (
              <CopyCode
                code={tab.extra.code}
                label={tab.extra.label}
                inline
                compact
                {...copyProps}
              />
            ) : null}
            {tab.after ? (
              <p className="text-[0.8rem] leading-[1.55] text-ink-2">{tab.after}</p>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
