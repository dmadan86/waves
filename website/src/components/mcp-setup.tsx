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
  copyLabel,
  copy,
  copied,
  label,
}: {
  tabs: SetupTab[];
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

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1.5 overflow-x-auto rounded-2xl bg-chip p-1.5"
      >
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
            className={`inline-flex h-10 shrink-0 items-center rounded-xl px-4 text-[0.88rem] font-semibold whitespace-nowrap transition-colors ${
              active === i
                ? 'bg-surface text-ink shadow-[var(--w-shadow-sm)]'
                : 'text-ink-2 hover:text-ink'
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
          className="mt-5"
        >
          <ol className="space-y-3">
            {tab.steps.map((step, n) => (
              <li key={step} className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-wash text-[0.75rem] font-bold text-accent">
                  {n + 1}
                </span>
                <span className="text-[0.95rem] leading-[1.6] text-ink-2">{step}</span>
              </li>
            ))}
          </ol>
          {tab.snippet ? (
            <div className="mt-5 space-y-3">
              <CopyCode
                code={tab.snippet}
                label={tab.snippetLabel}
                copyLabel={copyLabel}
                copy={copy}
                copied={copied}
              />
              {tab.after ? (
                <p className="text-[0.88rem] leading-[1.6] text-ink-2">{tab.after}</p>
              ) : null}
            </div>
          ) : null}
          {tab.extra ? (
            <div className="mt-4">
              <CopyCode
                code={tab.extra.code}
                label={tab.extra.label}
                copyLabel={copyLabel}
                copy={copy}
                copied={copied}
                inline
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
