'use client';

import { useId, useState } from 'react';

import { Check } from './icons';

type Role = {
  name: string;
  blurb: string;
  can: string[];
  mockTitle: string;
  rows: { k: string; v: string }[];
};

/** Owner / Manager / Employee: pick one and the card shows what that person sees. */
export function RoleSwitcher({ roles, label }: { roles: Role[]; label: string }) {
  const [i, setI] = useState(0);
  const id = useId();
  const role = roles[i];

  const onKey = (e: React.KeyboardEvent) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + roles.length) % roles.length;
    setI(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKey}
        className="inline-flex gap-1 rounded-full bg-chip p-1"
      >
        {roles.map((r, n) => (
          <button
            key={r.name}
            id={`${id}-tab-${n}`}
            role="tab"
            type="button"
            aria-selected={n === i}
            aria-controls={`${id}-panel`}
            tabIndex={n === i ? 0 : -1}
            onClick={() => setI(n)}
            className={`h-10 rounded-full px-4 text-[0.86rem] font-semibold transition-colors ${
              n === i ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {r.name}
          </button>
        ))}
      </div>

      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${i}`}
        className="mt-4 grid gap-4"
      >
        <div key={`t${i}`} className="cm-swap">
          <p className="text-[0.95rem] leading-[1.55] text-ink-2">{role.blurb}</p>
          <ul className="mt-3 space-y-2">
            {role.can.map((line) => (
              <li key={line} className="flex items-start gap-2 text-[0.88rem] text-ink">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
                {line}
              </li>
            ))}
          </ul>
        </div>
        <div
          key={`m${i}`}
          aria-hidden="true"
          className="cm-swap rounded-2xl bg-surface p-4 shadow-[var(--w-shadow-card)]"
        >
          <p className="text-[0.75rem] font-semibold tracking-[0.1em] rtl:tracking-normal text-ink-3 uppercase">
            {role.mockTitle}
          </p>
          <ul className="mt-2 divide-y divide-divider">
            {role.rows.map((row) => (
              <li
                key={row.k}
                className="flex items-center justify-between gap-3 py-2 text-[0.88rem]"
              >
                <bdi className="text-ink-2">{row.k}</bdi>
                <bdi className="font-semibold text-ink tabular-nums">{row.v}</bdi>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
