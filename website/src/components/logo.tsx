/**
 * The mark is the name: three crests that also read as the rise and fall of a
 * balance. It is drawn in `currentColor` as a monoline rather than filled into
 * a gradient tile, so it inverts with the theme, prints, and survives being
 * scaled down to a favicon.
 */
export function WaveMark({ className = 'h-[1.125rem] w-[1.6rem]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 18" fill="none" className={className} aria-hidden="true">
      <path
        d="M1 12.2c1.9 0 1.9-4.1 3.8-4.1s1.9 4.1 3.8 4.1 1.9-4.1 3.8-4.1 1.9 4.1 3.8 4.1 1.9-4.1 3.8-4.1 1.9 4.1 3.8 4.1"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* One crest carries the accent — the balance that is yours. */}
      <path
        d="M12.6 8.1c1.9 0 1.9 4.1 3.8 4.1"
        stroke="var(--w-accent)"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The wordmark is set in the pixel face. It is the one place on the site that
 * is allowed to be lo-fi, and because a brand name is never translated it is
 * safe to pin to a Latin-only font.
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-ink ${className}`}>
      <WaveMark />
      <span className="font-pixel text-[1.0625rem] leading-none tracking-[0.02em]">waves</span>
    </span>
  );
}
