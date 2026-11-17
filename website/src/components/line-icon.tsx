/** Marketing line icons (24 grid, 1.75 stroke) and the lavender badge they sit on. */
export const PATHS = {
  vendor:
    'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M17.5 10a2.5 2.5 0 1 0 0-5M18 14.2c1.8.6 3 2.2 3 4.3',
  clients:
    'M12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM7 20c0-2.8 2.2-5 5-5s5 2.2 5 5M5.5 11a2.2 2.2 0 1 1 0-4.4M18.5 11a2.2 2.2 0 1 0 0-4.4M3 17.5c0-1.6 1-3 2.6-3.4M21 17.5c0-1.6-1-3-2.6-3.4',
  wallet:
    'M4 7a2 2 0 0 1 2-2h11v3M4 7v10a2 2 0 0 0 2 2h13a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6a2 2 0 0 1-2-1ZM16 13.5h2',
  upload:
    'M7 18a4 4 0 0 1-.6-7.95A5.5 5.5 0 0 1 17 9.5a4.2 4.2 0 0 1 0 8.5M12 20v-7M9 15.5l3-3 3 3',
  export:
    'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 17v-5M9.5 14l2.5-2.5 2.5 2.5',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7.5V12l3 2',
  image:
    'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM21 16l-5-5-9 9',
  sparkles:
    'M10 4l1.8 4.7 4.7 1.8-4.7 1.8L10 17l-1.8-4.7L3.5 10.5l4.7-1.8zM18 3v4M16 5h4M18 15v4M16 17h4',
  building:
    'M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16M14 10h5a1 1 0 0 1 1 1v10M2 21h20M8 8h2M8 12h2M8 16h2M17 14h.01M17 17h.01',
  personPlus:
    'M10 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 21c0-3.9 3.1-7 7-7 1.2 0 2.3.3 3.2.8M18 14v6M15 17h6',
  checkCircle: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM8 12.5l2.7 2.7L16 9.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM6 11a6 6 0 0 0 12 0M12 17v4',
  plusMinus: 'M7 4v8M3 8h8M14 17h7',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  home: 'M4 11l8-7 8 7M6 10v10h12V10',
  food: 'M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2.5 6 0 8v10',
  car: 'M5 16V11l2-5h10l2 5v5M3 16h18M7.5 16.5v2M16.5 16.5v2',
  camera: 'M4 8h3l1.5-2h7L17 8h3v11H4zM12 16.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
} as const;

export type IconName = keyof typeof PATHS;

export function LineIcon({
  name,
  className = 'h-5 w-5',
  strokeWidth = 1.75,
}: {
  name: IconName;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Soft lavender circle with a violet line icon. */
export function IconBadge({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <span
      className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-wash text-accent ${className}`}
    >
      <LineIcon name={name} />
    </span>
  );
}
