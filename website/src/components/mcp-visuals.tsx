import Image from 'next/image';

import { ArrowRight, Check } from './icons';
import { ClientMark } from './client-icons';
import { WaveMark } from './logo';

/**
 * The small drawn pictures on the MCP page. They are HTML and CSS rather than
 * images so the words in them are translated, selectable and sharp, and so a
 * screenshot of one never goes stale next to the page's own copy.
 */

type P = { className?: string };

function Svg({ className = 'h-5 w-5', children }: P & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** A circle with a bar: the "never" mark. */
export const Ban = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m5.7 5.7 12.6 12.6" />
  </Svg>
);

export const Gear = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7" />
  </Svg>
);

export const Shield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3 5 6v5.5c0 4.2 2.8 7.6 7 9.5 4.2-1.9 7-5.3 7-9.5V6l-7-3Z" />
    <path d="m9 12 2.2 2.2L15.2 10" />
  </Svg>
);

export const LinkIcon = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1" />
  </Svg>
);

export const Sparkle = (p: P) => (
  <Svg {...p}>
    <path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7Z" />
  </Svg>
);

const cursorPointer = (
  <svg viewBox="0 0 20 24" className="h-6 w-5 drop-shadow" aria-hidden="true">
    <path
      d="M2 1.5v17l4.6-4.2 3 7 3.2-1.4-3-6.9H16L2 1.5Z"
      fill="#3a2a9d"
      stroke="#fff"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

const pane =
  'relative mt-4 flex h-44 items-center justify-center overflow-hidden rounded-xl bg-[linear-gradient(160deg,var(--w-accent-wash),transparent_130%)] p-3';

/** Step 1: the server address, in a pill. */
export function AddressVisual({ address }: { address: string }) {
  return (
    <div className={pane} aria-hidden="true">
      <div
        dir="ltr"
        className="flex max-w-full items-center gap-2 rounded-xl bg-surface px-3 py-2.5 shadow-[var(--w-shadow-card)]"
      >
        <LinkIcon className="h-4 w-4 shrink-0 text-accent" />
        <code className="truncate font-mono text-[0.72rem] text-ink">{address}</code>
      </div>
    </div>
  );
}

/** Step 2: a browser window with the approval button. */
export function ApproveVisual({ approve }: { approve: string }) {
  return (
    <div className={pane} aria-hidden="true">
      <div className="w-full max-w-[13rem] rounded-lg bg-surface shadow-[var(--w-shadow-card)]">
        <div dir="ltr" className="flex items-center gap-1 border-b border-line/70 px-2.5 py-2">
          <i className="h-1.5 w-1.5 rounded-full bg-[#ff6159]" />
          <i className="h-1.5 w-1.5 rounded-full bg-[#ffbd2e]" />
          <i className="h-1.5 w-1.5 rounded-full bg-[#28c940]" />
        </div>
        <div className="relative flex flex-col items-center gap-3 px-4 py-4">
          <span
            dir="ltr"
            className="inline-flex items-center gap-1.5 text-[0.8rem] font-bold text-ink"
          >
            <WaveMark className="h-4 w-4" />
            Waves
          </span>
          <span className="inline-flex h-8 w-full items-center justify-center rounded-lg bg-accent text-[0.8rem] font-semibold text-accent-ink">
            {approve}
          </span>
          <span className="absolute end-5 bottom-1 rtl:-scale-x-100">{cursorPointer}</span>
        </div>
      </div>
    </div>
  );
}

/** Step 3: a request in a chat bubble, and the answer. */
export function ChatVisual({ ask, done, doneSub }: { ask: string; done: string; doneSub: string }) {
  return (
    <div className={`${pane} flex-col justify-center gap-2.5`} aria-hidden="true">
      <div className="flex w-full items-start gap-2 rounded-xl rounded-ss-sm bg-accent-wash px-3 py-2.5 text-[0.8rem] leading-[1.4] font-medium text-ink shadow-[var(--w-shadow-sm)]">
        <Sparkle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        {ask}
      </div>
      <div className="flex w-full items-center gap-2.5 rounded-xl bg-surface px-3 py-2.5 shadow-[var(--w-shadow-card)]">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#22a06b] text-white">
          <Check className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0">
          <span className="block text-[0.8rem] font-semibold text-ink">{done}</span>
          <span className="block truncate text-[0.7rem] text-ink-3">{doneSub}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * The hero illustration: the robot (a raster crop) with a real card over its
 * lower corner, so the amount and the words are live text.
 */
export function HeroArt({ card }: { card: [string, string, string] }) {
  return (
    <div className="relative mx-auto w-full max-w-[26rem]">
      <Image
        src="/mcp/robot.webp"
        alt=""
        width={301}
        height={262}
        priority
        sizes="(min-width: 1024px) 416px, 90vw"
        className="h-auto w-full [mask-image:radial-gradient(ellipse_60%_64%_at_50%_46%,#000_55%,transparent_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute -right-2 -bottom-3 flex min-h-[47%] w-[62%] -rotate-3 flex-col justify-center rounded-2xl bg-surface p-3.5 shadow-[var(--w-shadow-lg)]"
      >
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#fdeee7]">
            <ClientMark id="claude" className="h-4.5 w-4.5" />
          </span>
          <span className="text-[0.95rem] font-bold text-ink">{card[0]}</span>
        </div>
        <p className="mt-2 ps-[2.625rem] text-[0.8rem] font-medium text-ink">{card[1]}</p>
        <p className="mt-1.5 flex items-center gap-2.5 text-[0.75rem] text-ink-2">
          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#22a06b] text-white">
            <Check className="h-3.5 w-3.5" />
          </span>
          {card[2]}
        </p>
      </div>
    </div>
  );
}

export const FlowArrow = () => <ArrowRight className="h-5 w-5 text-accent rtl:-scale-x-100" />;
