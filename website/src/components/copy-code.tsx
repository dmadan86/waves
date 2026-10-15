'use client';

import { useEffect, useRef, useState } from 'react';

import { Check, Copy } from './icons';

/**
 * A code block with a copy button. The code is always left-to-right, even on
 * an Arabic page: an address or a JSON key read right-to-left is a different
 * string. Clipboard access can be refused (insecure context, permissions), in
 * which case the text is still selectable and the button simply stays quiet.
 */
export function CopyCode({
  code,
  label,
  copyLabel,
  copy,
  copied,
  inline = false,
  compact = false,
}: {
  code: string;
  label?: string;
  copyLabel: string;
  copy: string;
  copied: string;
  /** One-line address style rather than a multi-line block. */
  inline?: boolean;
  /** Tighter padding and type, for use inside a card. */
  compact?: boolean;
}) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setDone(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1800);
    } catch {
      /* The text stays selectable. */
    }
  };

  return (
    <div className="min-w-0">
      {label ? (
        <p className="mb-1.5 text-[0.78rem] font-semibold tracking-[0.02em] text-ink-2">{label}</p>
      ) : null}
      <div
        dir="ltr"
        className={`flex items-start gap-2 bg-surface shadow-[var(--w-shadow-card)] ${
          compact ? 'rounded-xl p-1.5 ps-3' : 'rounded-2xl p-2 ps-4'
        }`}
      >
        <pre
          className={`min-w-0 flex-1 overflow-x-auto font-mono leading-[1.7] text-ink ${
            compact ? 'py-1.5 text-[0.76rem]' : 'py-2.5 text-[0.82rem]'
          } ${inline ? 'whitespace-nowrap' : compact ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'}`}
          tabIndex={0}
        >
          <code>{code}</code>
        </pre>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copyLabel}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-accent-wash font-semibold text-accent transition-colors hover:bg-brand-200 ${
            compact ? 'h-9 px-3 text-[0.78rem]' : 'h-10 px-3.5 text-[0.82rem]'
          }`}
        >
          {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span aria-live="polite">{done ? copied : copy}</span>
        </button>
      </div>
    </div>
  );
}
