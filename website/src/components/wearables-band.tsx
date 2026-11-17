import type { CSSProperties } from 'react';

import type { Dictionary } from '@/i18n/dictionaries';
import './wear-watch.css';
import { InView } from './in-view';
import { LineIcon, type IconName } from './line-icon';
import { Kicker } from './ui';

type T = Dictionary['wearables'];

/**
 * "Do more, with your watch". The watches are drawn in CSS from the shipped
 * SwiftUI views (apps/mobile/targets/watch/Views.swift) and the widgets
 * (apps/mobile/targets/widgets): English only, no balances, no raster images.
 */

const CARD_ICONS: IconName[] = ['mic', 'plusMinus', 'list', 'grid'];

const DARK_BTN = 'grid place-items-center rounded-full bg-[#2c2b33] text-white';

function WatchFace({ i }: { i: number }) {
  if (i === 0)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2">
        <svg
          viewBox="0 0 32 24"
          className="h-7 w-9 text-[#9b82ff]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
        >
          {['M3 12v0', 'M8 8v8', 'M13 4v16', 'M18 7v10', 'M23 9.5v5', 'M28 12v0'].map((d, n) => (
            <path
              key={d}
              d={d}
              className="ww-bar"
              style={{ '--d': `${n * 0.09}s` } as CSSProperties}
            />
          ))}
        </svg>
        <p className="ww-said flex items-center gap-1 text-[0.76rem] font-semibold whitespace-nowrap">
          Auto ₹120
          <LineIcon name="check" className="h-3.5 w-3.5 text-[#3ddc84]" strokeWidth={3} />
        </p>
      </div>
    );
  if (i === 1)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-[0.78rem] font-semibold whitespace-nowrap">Add expense</p>
        {/* Three amounts stacked; the loop steps through them as + is pressed. */}
        <p className="relative -my-1 h-5 w-14 text-center text-[0.95rem] font-bold tabular-nums">
          <span className="ww-amt ww-amt-1 absolute inset-0">₹100</span>
          <span className="ww-amt ww-amt-2 absolute inset-0">₹110</span>
          <span className="ww-amt ww-amt-3 absolute inset-0">₹120</span>
        </p>
        <div className="flex gap-2">
          <span className={`h-8 w-8 text-lg ${DARK_BTN}`}>−</span>
          <span className={`ww-press h-8 w-8 text-lg ${DARK_BTN}`}>+</span>
        </div>
      </div>
    );
  if (i === 2)
    return (
      <div className="flex h-full flex-col justify-center gap-1.5 px-0.5">
        <p className="text-[0.74rem] font-semibold text-[#9b82ff]">Recent</p>
        {(
          [
            ['car', '₹320', '2m'],
            ['food', '₹140', '10m'],
          ] as const
        ).map(([icon, amt, when], n) => (
          <div
            key={icon}
            style={{ '--d': `${n * 0.25}s` } as CSSProperties}
            className="ww-row flex items-center gap-1 rounded-full bg-[#2c2b33] px-2 py-1 text-[0.66rem]"
          >
            <LineIcon name={icon} className="h-3 w-3 shrink-0 text-[#9b82ff]" />
            <span className="font-bold tabular-nums">{amt}</span>
            <span className="ms-auto text-white/50">{when}</span>
          </div>
        ))}
      </div>
    );
  return (
    <div className="grid h-full grid-cols-2 place-content-center gap-2 px-1">
      {(['home', 'food', 'camera', 'mic'] as const).map((icon) => (
        <span
          key={icon}
          className={`h-9 w-9 justify-self-center ${icon === 'food' ? 'ww-tap bg-[#7a5af8] text-white' : DARK_BTN} grid place-items-center rounded-full`}
        >
          <LineIcon name={icon} className="h-4 w-4" />
        </span>
      ))}
    </div>
  );
}

/** Apple-Watch-style: lavender bands, bezel, dark face, crown, on a pale blob. */
function Watch({ i }: { i: number }) {
  return (
    <div
      dir="ltr"
      lang="en"
      className="relative mx-auto flex h-[13.6rem] w-full max-w-[14rem] items-center justify-center"
      aria-hidden="true"
    >
      <span className="absolute inset-x-3 inset-y-4 rounded-[45%_55%_50%_50%/55%_45%_55%_45%] bg-accent-wash" />
      <div className="relative flex flex-col items-center">
        <span className="h-7 w-[4.2rem] rounded-t-xl bg-accent/30" />
        <div className="relative -my-px">
          <div className="h-[8.2rem] w-[7rem] rounded-[2rem] bg-[#8d8a9c] p-[3px] shadow-[var(--w-shadow-md)]">
            <div className="h-full w-full rounded-[1.8rem] bg-[#16151c] p-1 text-white">
              <div className="h-full overflow-hidden rounded-[1.55rem] bg-black px-2 py-2">
                <InView loop className="h-full">
                  <WatchFace i={i} />
                </InView>
              </div>
            </div>
          </div>
          <span className="absolute top-10 -right-[3px] h-5 w-[5px] rounded-full bg-[#6f6c7d]" />
        </div>
        <span className="h-7 w-[4.2rem] rounded-b-xl bg-accent/30" />
      </div>
    </div>
  );
}

export function WearablesBand({ t }: { t: T }) {
  return (
    <section
      id="wearables"
      aria-labelledby="wearables-title"
      className="on-light scroll-mt-20 py-8 lg:py-10"
    >
      <div className="mx-auto w-full max-w-[73rem] px-5 sm:px-8">
        <Kicker>{t.eyebrow}</Kicker>
        <h2
          id="wearables-title"
          className="display mt-2 text-balance text-[2rem] text-ink sm:text-[2.8rem]"
        >
          {t.title}
        </h2>
        <p className="mt-2.5 max-w-2xl text-[0.98rem] leading-[1.6] text-ink-2">{t.lead}</p>

        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {t.examples.map((ex, i) => (
            <li
              key={ex.title}
              className="relative rounded-3xl bg-surface p-4 shadow-[var(--w-shadow-card)]"
            >
              <span className="absolute start-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-accent-wash text-accent">
                <LineIcon name={CARD_ICONS[i] ?? 'list'} className="h-[1.15rem] w-[1.15rem]" />
              </span>
              <Watch i={i} />
              <h3 className="mt-2 text-[1.05rem] font-bold text-ink">{ex.title}</h3>
              <p className="mt-1.5 text-[0.88rem] leading-[1.55] text-ink-2">
                <bdi>{ex.body}</bdi>
              </p>
            </li>
          ))}
        </ul>

        <ul className="mt-4 grid divide-y divide-line rounded-3xl bg-surface p-2 shadow-[var(--w-shadow-card)] md:grid-cols-3 md:divide-x md:divide-y-0">
          {t.points.map((p) => (
            <li key={p.title} className="flex items-start gap-3 p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-wash text-accent">
                <LineIcon name="check" className="h-4 w-4" strokeWidth={2.4} />
              </span>
              <div>
                <h3 className="text-[0.95rem] font-bold text-ink">{p.title}</h3>
                <p className="mt-1 text-[0.84rem] leading-[1.5] text-ink-2">{p.body}</p>
              </div>
            </li>
          ))}
        </ul>

        <p className="mt-4 flex items-center gap-2 text-[0.88rem] font-medium text-accent">
          <span
            className="grid h-5 w-5 place-items-center rounded-full bg-accent text-[0.7rem] font-bold text-accent-ink"
            aria-hidden="true"
          >
            i
          </span>
          {t.soonNote}
        </p>
      </div>
    </section>
  );
}
