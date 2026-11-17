'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import { Check, Mic } from './icons';

const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribeReduced = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

/** Typing speed, the beat before the card, how long the numbers count, how long a result rests. */
const TYPE_MS = 28;
const GAP_MS = 350;
const COUNT_MS = 700;
const REST_MS = 3600;

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text),
      (s) => s.segment,
    );
  }
  return Array.from(text);
}

/**
 * The hero's interactive example. Nothing here listens or calls a model: each
 * preset phrase carries the numbers it should produce, and the card is the same
 * sum Waves does (total / people), counted up. With reduced motion the finished
 * card is shown and the chips just swap it.
 */
export function HeroDemo({ t }: { t: Dictionary['hero']['demo'] }) {
  const [idx, setIdx] = useState(0);
  // Infinity is the finished frame: what server render, no-JS and reduced motion all show.
  const [elapsed, setElapsed] = useState(Infinity);
  const [touched, setTouched] = useState(false);
  const [held, setHeld] = useState(false);
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );

  const ph = t.phrases[idx]!;
  const chars = useMemo(() => graphemes(ph.say), [ph.say]);
  const typedEnd = chars.length * TYPE_MS;
  const doneAt = typedEnd + GAP_MS + COUNT_MS;

  useEffect(() => {
    if (reduced) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const e = now - start;
      setElapsed(e);
      if (e < doneAt) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [idx, doneAt, reduced]);

  const done = elapsed >= doneAt;
  useEffect(() => {
    if (reduced || touched || held || !done) return;
    const id = window.setTimeout(() => {
      setIdx((i) => (i + 1) % t.phrases.length);
      setElapsed(0);
    }, REST_MS);
    return () => window.clearTimeout(id);
  }, [reduced, touched, held, done, idx, t.phrases.length]);

  const choose = (i: number) => {
    setTouched(true);
    setIdx(i);
    setElapsed(reduced ? Infinity : 0);
  };

  const typing = elapsed < typedEnd;
  const shown = typing ? chars.slice(0, Math.floor(elapsed / TYPE_MS)).join('') : ph.say;
  const p = Math.min(1, Math.max(0, (elapsed - typedEnd - GAP_MS) / COUNT_MS));
  const eased = 1 - (1 - p) ** 3;
  const each = ph.total / ph.people;
  const total = p >= 1 ? ph.total : Math.round(ph.total * eased);
  const eachShown = p >= 1 ? each : Math.round(each * eased);
  const cardOn = elapsed >= typedEnd + GAP_MS;
  const split = ph.people > 1;

  return (
    <div
      role="group"
      aria-label={t.label}
      className="mx-auto w-full max-w-[28rem] min-w-0"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="rounded-[2rem] border border-white/15 bg-[#0B0828]/60 p-3 shadow-[0_30px_80px_rgb(0_0_0_/_0.45)] backdrop-blur sm:p-4">
        <p className="px-2 pb-2 font-mono text-[0.68rem] tracking-[0.12em] text-[#9C95C2] uppercase rtl:tracking-normal">
          {t.youSay}
        </p>
        <div
          aria-hidden="true"
          className="flex min-h-[4.6rem] items-center gap-3 rounded-[1.4rem] bg-[#FBFAFF] p-3 text-[#1B1530]"
        >
          <span className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#FF7A59] text-white">
            <Mic className="h-5 w-5" />
            {typing ? (
              <span className="absolute inset-0 animate-ping rounded-full bg-[#FF7A59]/40 motion-reduce:hidden" />
            ) : null}
          </span>
          <p className="min-w-0 text-[1.02rem] leading-snug font-medium text-pretty">
            “{shown}
            {typing ? (
              <span className="ms-px inline-block h-[1.05em] w-px translate-y-[0.15em] bg-[#7A5AF8]" />
            ) : null}
            {typing ? '' : '”'}
          </p>
        </div>

        <div
          aria-hidden="true"
          data-on={cardOn ? '' : undefined}
          className="mt-3 rounded-[1.4rem] bg-[#FBFAFF] p-4 text-[#1B1530] opacity-30 transition-opacity duration-300 data-[on]:opacity-100 sm:p-5"
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[1.25rem] font-semibold tracking-[-0.01em]">{ph.item}</p>
            <p className="font-mono text-[1.7rem] font-medium text-[#C2410C] tabular-nums">
              {inr(total)}
            </p>
          </div>
          <p className="mt-1 text-[0.92rem] text-[#5B546F]">
            {ph.paid} · {ph.who}
          </p>
          <div className="mt-3 flex min-h-[2.75rem] items-center justify-between gap-3 rounded-xl bg-[#EDE9FE] px-3.5 py-2.5">
            {split ? (
              <>
                <span className="text-[0.88rem] text-[#3F2FA0]">{t.eachOwes}</span>
                <span className="font-mono text-[1.15rem] font-medium text-[#3F2FA0] tabular-nums">
                  {inr(eachShown)}
                </span>
              </>
            ) : (
              <span className="text-[0.88rem] text-[#3F2FA0]">{t.noSplit}</span>
            )}
          </div>
          <p className="mt-3 flex items-center gap-2 text-[0.88rem] font-medium text-[#047857]">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-[#10B981] text-white">
              <Check className="h-3 w-3" />
            </span>
            {t.ready}
          </p>
        </div>
        <p className="sr-only" aria-live="polite">
          {done
            ? `${ph.say}. ${ph.item} ${inr(ph.total)}. ${ph.paid}. ${ph.who}. ${split ? `${t.eachOwes} ${inr(each)}. ` : ''}${t.ready}`
            : ''}
        </p>
      </div>

      <p className="mt-4 font-mono text-[0.68rem] tracking-[0.12em] text-[#9C95C2] uppercase rtl:tracking-normal">
        {t.pick}
      </p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {t.phrases.map((x, i) => (
          <li key={x.chip}>
            <button
              type="button"
              aria-pressed={i === idx}
              onClick={() => choose(i)}
              className={`min-h-11 rounded-full border px-4 text-[0.86rem] transition-colors ${
                i === idx
                  ? 'border-[#C4B5FD]/70 bg-white/15 text-white'
                  : 'border-white/15 bg-white/[0.07] text-[#D9D4F5] hover:bg-white/[0.14]'
              }`}
            >
              {x.chip}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
