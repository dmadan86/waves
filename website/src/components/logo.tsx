/**
 * The mark: the Shared Crest, a white crest-wave and dot on a violet tile.
 * Drawn as paths so it stays crisp at favicon size and needs no raster file.
 */
export function WaveMark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 1024 1024" className={className} aria-hidden="true">
      <rect width="1024" height="1024" rx="232" fill="#6C4EE3" />
      <path
        d="M262 420C285 640 385 700 450 590C505 495 565 480 600 580C640 695 715 650 772 400"
        fill="none"
        stroke="#fff"
        strokeWidth="88"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="790" cy="290" r="46" fill="#fff" />
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
