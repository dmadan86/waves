'use client';

import { useState, useSyncExternalStore, type ReactNode } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import './hero-scenes.css';

type Scenes = Dictionary['hero']['scenes'];

const REDUCED = '(prefers-reduced-motion: reduce)';
const subscribeReduced = (cb: () => void) => {
  const mq = window.matchMedia(REDUCED);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
};

const Check = ({ draw = false, d }: { draw?: boolean; d?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="#fff"
    strokeWidth={3}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path
      d="M5 12.5l4.5 4.5L19 7"
      pathLength={1}
      className={draw ? 'hs-draw' : undefined}
      style={d ? ({ '--d': d } as React.CSSProperties) : undefined}
    />
  </svg>
);

const wave = [0.35, 0.6, 0.9, 0.5, 1, 0.65, 0.4, 0.75, 0.3];
const Wave = () => (
  <div className="hs-wave" aria-hidden="true">
    {wave.map((h, i) => (
      <i key={i} style={{ '--h': h * 0.7, '--d': `${0.3 + i * 0.07}s` } as React.CSSProperties} />
    ))}
  </div>
);

const d = (s: number) => ({ '--d': `${s}s` }) as React.CSSProperties;
const win = (s: number, t: number) => ({ '--d': `${s}s`, '--t': `${t}s` }) as React.CSSProperties;

function Voice({ v }: { v: Scenes['voice'] }) {
  return (
    <div className="hs-phone">
      <div className="flex items-center justify-center gap-[2.5cqw]">
        <div className="hs-mic">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </div>
        <Wave />
      </div>
      <p className="hs-bubble hs-light hs-in" style={d(0.4)}>
        <span className="hs-typed" style={{ '--n': v.say.length + 2 } as React.CSSProperties}>
          “{v.say}”
        </span>
      </p>
      <div className="hs-card hs-light hs-in" style={d(2.4)}>
        <div className="flex items-center justify-between gap-2">
          <p className="hs-cap">{v.added}</p>
          <span className="hs-ok">
            <Check draw d="2.9s" />
          </span>
        </div>
        <div className="mt-[1cqw] flex items-baseline justify-between gap-2">
          <span className="text-[4.2cqw] font-medium">{v.item}</span>
          <span className="hs-amt">{v.amount}</span>
        </div>
        <p className="hs-sub mt-[1cqw]">{v.split}</p>
      </div>
    </div>
  );
}

function Scan({ s }: { s: Scenes['scan'] }) {
  const rows = [
    ['58%', '420'],
    ['44%', '380'],
    ['66%', '540'],
    ['50%', '325'],
  ];
  return (
    <div className="hs-phone">
      <div className="hs-stack">
        <div className="hs-view hs-sh" style={win(0, 2.7)}>
          <i className="hs-corner tl" />
          <i className="hs-corner tr" />
          <i className="hs-corner bl" />
          <i className="hs-corner br" />
          <div className="hs-paper">
            <b className="hs-bar" style={{ width: '40%', background: '#1b1530' }} />
            {rows.map(([w, p]) => (
              <div key={p} className="hs-prow">
                <b className="hs-bar" style={{ width: w }} />
                <span>{p}</span>
              </div>
            ))}
            <div className="hs-prow hs-ptot">
              <b className="hs-bar" style={{ width: '22%', background: '#1b1530' }} />
              <span>1,665</span>
            </div>
          </div>
          <span className="hs-scanline" />
        </div>
        <div className="hs-card hs-light hs-in self-center" style={d(2.9)}>
          <div className="flex items-center justify-between gap-2">
            <p className="hs-cap">{s.added}</p>
            <span className="hs-ok">
              <Check draw d="3.3s" />
            </span>
          </div>
          <div className="mt-[1cqw] flex items-baseline justify-between gap-2">
            <span className="text-[4.2cqw] font-medium">{s.item}</span>
            <span className="hs-amt">{s.amount}</span>
          </div>
          <p className="hs-sub mt-[1cqw]">{s.split}</p>
        </div>
      </div>
    </div>
  );
}

function Settle({ s }: { s: Scenes['settle'] }) {
  return (
    <div className="hs-phone hs-clip">
      <div className="hs-stack">
        <div className="hs-card hs-light hs-sh" style={win(0, 4.4)}>
          <p className="hs-cap">{s.owe}</p>
          <p className="hs-amt mt-[1cqw] text-[8cqw]">{s.amount}</p>
          <span className="hs-btn mt-[3cqw]">
            {s.button}
            <span className="hs-ripple" />
          </span>
        </div>
        <div className="hs-card hs-green hs-in" style={d(4.6)}>
          <span className="hs-bigok">
            <Check draw d="5.0s" />
          </span>
          <p className="text-[5cqw] font-medium">{s.done}</p>
          <p className="hs-sub">{s.doneNote}</p>
        </div>
      </div>
      <div className="hs-sheet" aria-hidden="true">
        <p className="text-[3.6cqw] font-medium">{s.sheet}</p>
        <div className="hs-upis">
          {['#7A5AF8', '#10B981', '#F5B544', '#FF7A59'].map((c) => (
            <i key={c} style={{ '--c': c } as React.CSSProperties} />
          ))}
        </div>
        <p className="hs-sub">{s.sheetNote}</p>
      </div>
    </div>
  );
}

function Watch({ w }: { w: Scenes['watch'] }) {
  return (
    <>
      <div className="hs-glow" />
      <div className="hs-watch">
        <span className="hs-band up" />
        <span className="hs-band dn" />
        <span className="hs-crown" />
        <div className="hs-case">
          <span className="hs-time">9:41</span>
          <div className="hs-stack mt-[5cqw]">
            <div className="hs-face hs-sh" style={win(0.3, 2.3)}>
              <div className="hs-mic" style={{ width: '9cqw', height: '9cqw' }}>
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <rect x="9" y="3" width="6" height="12" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                </svg>
              </div>
              <Wave />
            </div>
            <div className="hs-face hs-sh" style={win(1.1, 1.6)}>
              <span className="hs-say">“{w.say}”</span>
            </div>
            <div className="hs-face hs-in" style={d(2.7)}>
              <span className="hs-bigok">
                <Check draw d="3.0s" />
              </span>
              <span className="text-[4.2cqw] font-medium text-[#6EE7B7]">{w.added}</span>
              <span className="hs-mono text-[3.8cqw] text-white">{w.item}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

const tiles = ['food', 'travel', 'bills', 'shop'] as const;
const tint = { food: '#FF7A59', travel: '#7A5AF8', bills: '#F5B544', shop: '#10B981' };

function Widget({ g }: { g: Scenes['widget'] }) {
  return (
    <div className="hs-phone" style={{ justifyContent: 'flex-start', paddingTop: '10cqw' }}>
      <div className="hs-widget">
        <div className="flex items-start justify-between gap-2">
          <p className="hs-cap">{g.today}</p>
          <div className="hs-bal">
            <span className="hs-sh" style={win(0, 3.4)} aria-hidden="true">
              {g.before}
            </span>
            <span className="hs-in" style={d(3.3)}>
              {g.after}
            </span>
          </div>
        </div>
        <div className="hs-body hs-stack">
          <div className="hs-tiles hs-sh" style={win(0, 1.9)}>
            {tiles.map((k) => (
              <div key={k} className={`hs-tile ${k === 'food' ? 'hot' : ''}`}>
                <b style={{ '--c': tint[k] } as React.CSSProperties} />
                {g[k]}
                {k === 'food' && <span className="hs-ripple" />}
              </div>
            ))}
          </div>
          <div className="hs-entry hs-sh" style={win(1.5, 1.6)}>
            <p className="hs-cap">{g.food}</p>
            <span className="hs-type">{g.entry}</span>
          </div>
          <div className="hs-savedrow hs-in" style={d(3.2)}>
            <span className="hs-ok" style={{ width: '9cqw', height: '9cqw' }}>
              <Check draw d="3.4s" />
            </span>
            <span>{g.saved}</span>
            <span className="hs-sub">{g.savedItem}</span>
          </div>
        </div>
      </div>
      <div className="hs-apps" aria-hidden="true">
        {[
          '#7A5AF8',
          '#F5B544',
          '#10B981',
          '#FF7A59',
          '#C4B5FD',
          '#7A5AF8',
          '#F4C3B1',
          '#A4CBEA',
        ].map((c, i) => (
          <i key={i} style={{ '--c': c } as React.CSSProperties} />
        ))}
      </div>
    </div>
  );
}

/**
 * The hero's right side: six short scenes that crossfade and loop. The progress
 * bar's animationend advances the story, so pausing (hover, focus, button) and
 * reduced motion both stop it for free. Scene 2 (the orbit) is server markup.
 */
export function HeroScenes({
  t,
  orbitLabel,
  split,
}: {
  t: Scenes;
  orbitLabel: string;
  split: ReactNode;
}) {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const reduced = useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );

  const scenes = [
    { id: 'voice', tab: t.voice.tab, label: t.voice.label, node: <Voice v={t.voice} />, dur: 4.8 },
    { id: 'split', tab: t.split.tab, label: orbitLabel, node: split, dur: 4.8 },
    { id: 'scan', tab: t.scan.tab, label: t.scan.label, node: <Scan s={t.scan} />, dur: 5.4 },
    {
      id: 'settle',
      tab: t.settle.tab,
      label: t.settle.label,
      node: <Settle s={t.settle} />,
      dur: 6.6,
    },
    { id: 'watch', tab: t.watch.tab, label: t.watch.label, node: <Watch w={t.watch} /> },
    { id: 'widget', tab: t.widget.tab, label: t.widget.label, node: <Widget g={t.widget} /> },
  ].map((s) => ({ ...s, cap: t[s.id as keyof typeof t] as { title: string; line: string } }));
  const held = !playing || hover || focus;

  return (
    <div
      className="mx-auto w-full max-w-[38rem] min-w-0"
      data-paused={held ? '' : undefined}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div className="hs-box relative aspect-square w-full">
        {scenes.map((s, i) => (
          <div
            key={s.id}
            role="img"
            aria-label={`${s.label} ${s.cap.title}. ${s.cap.line}`}
            aria-hidden={i !== active}
            data-on={i === active ? '' : undefined}
            className="hs-scene"
          >
            {s.node}
          </div>
        ))}
      </div>
      <div className="hs-caps" aria-hidden="true">
        {scenes.map((s, i) => (
          <div key={s.id} className="hs-capi" data-on={i === active ? '' : undefined}>
            <p className="hs-ct">{s.cap.title}</p>
            <p className="hs-cl">{s.cap.line}</p>
          </div>
        ))}
      </div>
      <div role="group" aria-label={t.nav} className="hs-ctl mt-3">
        {scenes.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className="hs-pill"
            aria-pressed={i === active}
            aria-current={i === active ? 'step' : undefined}
            onClick={() => setActive(i)}
            onFocus={(e) => setFocus(e.currentTarget.matches(':focus-visible'))}
            onBlur={() => setFocus(false)}
          >
            {s.tab}
            {i === active && !reduced && (
              <span
                key={active}
                className="hs-prog"
                style={{ '--hs-dur': `${s.dur}s` } as React.CSSProperties}
                onAnimationEnd={() => setActive((a) => (a + 1) % scenes.length)}
              />
            )}
          </button>
        ))}
        {!reduced && (
          <button
            type="button"
            className="hs-pill"
            aria-label={playing ? t.pause : t.play}
            onClick={() => setPlaying((p) => !p)}
          >
            <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor" aria-hidden="true">
              {playing ? <path d="M2 1h3v10H2zM7 1h3v10H7z" /> : <path d="M2 1l9 5-9 5z" />}
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
