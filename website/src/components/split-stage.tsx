'use client';

import { useState, useSyncExternalStore } from 'react';
import type { Dictionary } from '@/i18n/dictionaries';
import './split-stage.css';

export function SplitStage({ t }: { t: Dictionary['hero']['split'] }) {
  // False on the server and during hydration, true after: the animation is an enhancement.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [run, setRun] = useState(0);

  return (
    <div className="ss-wrap">
      <figure
        key={run}
        className={`ss-stage${mounted ? ' ss-live' : ''}`}
        role="img"
        aria-label={t.label}
      >
        <div className="ss-scene" aria-hidden="true">
          <span className="ss-example">{t.example}</span>
          <div className="ss-bill ss-paper">
            <span className="ss-bill-name">{t.bill}</span>
            <strong className="ss-total">{t.total}</strong>
            <span className="ss-paid">{t.paidBy}</span>
          </div>
          <svg className="ss-paths" viewBox="0 0 400 440" fill="none" preserveAspectRatio="none">
            <path pathLength="1" d="M200 126 C200 164 64 142 64 208" />
            <path pathLength="1" d="M200 126 C200 160 200 174 200 208" />
            <path pathLength="1" d="M200 126 C200 164 336 142 336 208" />
          </svg>
          <div className="ss-people">
            {t.people.map((person, index) => (
              <div className={`ss-person ss-person-${index}`} key={index}>
                <span className="ss-share">{t.each}</span>
                <span className="ss-avatar">{Array.from(person)[0]}</span>
                <span className="ss-name">{person}</span>
              </div>
            ))}
          </div>
          <div className="ss-balance ss-paper">
            <span className="ss-check">
              <svg viewBox="0 0 24 24" fill="none">
                <path d="m6 12 4 4 8-8" />
              </svg>
            </span>
            <span className="ss-note">{t.resultNote}</span>
            <strong className="ss-result">{t.result}</strong>
          </div>
          <div className="ss-sheet ss-paper">
            <div className="ss-settle">
              <span>{t.settle}</span>
              <svg viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14m-5-5 5 5-5 5" />
              </svg>
            </div>
            <span className="ss-upi">{t.upi}</span>
          </div>
        </div>
      </figure>
      <button className="ss-replay" type="button" onClick={() => setRun((value) => value + 1)}>
        {t.replay}
      </button>
    </div>
  );
}
