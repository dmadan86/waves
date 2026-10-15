/**
 * The mark: two crests of one wave, blue into violet, drawn as a monoline so it
 * stays crisp at favicon size and needs no raster file.
 */
export function WaveMark({ className = 'h-[1.35rem] w-[1.9rem]' }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 22" fill="none" className={className} aria-hidden="true">
      <path
        d="M2 8.5c2.4 0 2.4-4.5 5-4.5s2.6 4.5 5.2 4.5 2.6-4.5 5.2-4.5 2.6 4.5 5.2 4.5"
        stroke="#2f6bf6"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2 17c2.4 0 2.4-4.5 5-4.5s2.6 4.5 5.2 4.5 2.6-4.5 5.2-4.5 2.6 4.5 5.2 4.5"
        stroke="#6a4bf5"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The brand name is never translated, so it is safe to pin to the Latin face. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 text-ink ${className}`}>
      <WaveMark />
      <span className="text-[1.2rem] leading-none font-bold tracking-[-0.02em]">Waves</span>
    </span>
  );
}
