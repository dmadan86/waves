'use client';

import { useCallback, useSyncExternalStore } from 'react';

import { Moon, Sun, System } from './icons';

type Choice = 'light' | 'dark' | 'system';

const order: Choice[] = ['system', 'light', 'dark'];

const KEY = 'waves-theme';

/**
 * The stored choice is browser state, so it is read through
 * `useSyncExternalStore` rather than assigned from an effect: the server
 * snapshot is `null`, the client snapshot is whatever is in storage, and React
 * reconciles the two itself instead of us rendering one value and then
 * correcting it. It also means a change in one tab reaches the others.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function readStored(): Choice | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    /* private mode, blocked storage — the OS preference stands. */
    return 'system';
  }
}

/** Before hydration there is no answer, and pretending otherwise is the flash. */
const serverSnapshot = () => null;

export function ThemeToggle({ label, names }: { label: string; names: Record<Choice, string> }) {
  const stored = useSyncExternalStore(subscribe, readStored, serverSnapshot);
  const choice: Choice = stored ?? 'system';

  const apply = useCallback((next: Choice) => {
    const root = document.documentElement;
    root.classList.remove('theme-light', 'theme-dark');
    if (next !== 'system') root.classList.add(`theme-${next}`);
    try {
      if (next === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, next);
    } catch {
      /* the choice still applies for this page view. */
    }
    for (const listener of listeners) listener();
  }, []);

  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : System;
  const next = order[(order.indexOf(choice) + 1) % order.length];

  return (
    <button
      type="button"
      onClick={() => apply(next)}
      // Until the stored choice is known the button announces the neutral
      // label rather than a state that may turn out to be wrong.
      aria-label={stored ? `${label}: ${names[choice]}` : label}
      title={stored ? `${label}: ${names[choice]}` : label}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-ink-2 transition-colors duration-150 hover:bg-chip hover:text-ink"
    >
      <Icon className="h-[1.05rem] w-[1.05rem]" />
    </button>
  );
}
