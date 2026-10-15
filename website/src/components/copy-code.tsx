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
}: {
  code: string;
  label?: string;
  copyLabel: string;
  copy: string;
  copied: string;
  /** One-line address style rather than a multi-line block. */
  inline?: boolean;
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
        className="flex items-start gap-2 rounded-2xl bg-surface p-2 ps-4 shadow-[var(--w-shadow-card)]"
      >
        <pre
          className={`min-w-0 flex-1 overflow-x-auto font-mono text-[0.82rem] leading-[1.7] text-ink ${
            inline ? 'py-2.5 whitespace-nowrap' : 'py-2.5 whitespace-pre'
          }`}
          tabIndex={0}
        >
          <code>{code}</code>
        </pre>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copyLabel}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-accent-wash px-3.5 text-[0.82rem] font-semibold text-accent transition-colors hover:bg-brand-200"
        >
          {done ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span aria-live="polite">{done ? copied : copy}</span>
        </button>
      </div>
    </div>
  );
}
