type IconProps = { className?: string };

const base = 'h-5 w-5';

/**
 * One stroke weight, one cap style, one 24-grid — a set that looks drawn by the
 * same hand. Arrows are the only directional glyphs here, and every place that
 * uses one flips it under `dir="rtl"` (see the `rtl:` variant in globals.css):
 * an icon is content, and RTL does not mirror content for you.
 */
function Svg({ className, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? base}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const ArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const Check = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Svg>
);

export const Chevron = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);

export const Globe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 21.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
  </Svg>
);

export const Split = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h5l6 12h5M20 6h-5" />
    <path d="m17 3 3 3-3 3M17 15l3 3-3 3" />
  </Svg>
);

export const OfflineBolt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 2 4.5 13.5H11L10 22l8.5-11.5H12L13 2Z" />
  </Svg>
);

export const Compass = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5.2-5.2 2 2-5.2 5.2-2Z" />
  </Svg>
);

export const Scan = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M4 12h16" />
  </Svg>
);

export const Handshake = (p: IconProps) => (
  <Svg {...p}>
    <path d="m3 11 4-4 4 3 2-1 4 4-2 2-3-2" />
    <path d="m21 13-4 4-3-2M7 7 3 11l4 4" />
  </Svg>
);

export const Lock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="10" width="16" height="10" rx="2.5" />
    <path d="M8 10V7.5a4 4 0 0 1 8 0V10" />
  </Svg>
);

export const Wallet = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="6" width="18" height="13" rx="3" />
    <path d="M3 10h18M16.5 14.5h.01" />
  </Svg>
);

export const Users = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c0-3 2.7-4.8 6-4.8s6 1.8 6 4.8" />
    <path d="M16 5.4a3.2 3.2 0 0 1 0 5.2M17.5 14.6c2 .7 3.5 2.2 3.5 4.4" />
  </Svg>
);

export const Home = (p: IconProps) => (
  <Svg {...p}>
    <path d="m4 10.5 8-6.5 8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19v-8.5Z" />
    <path d="M10 20.5V14h4v6.5" />
  </Svg>
);

export const Heart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20s-7-4.4-7-9.2A3.9 3.9 0 0 1 12 8.4a3.9 3.9 0 0 1 7 2.4C19 15.6 12 20 12 20Z" />
  </Svg>
);

export const Receipt = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h12v18l-3-1.6L12 21l-3-1.6L6 21V3Z" />
    <path d="M9.5 8.5h5M9.5 12.5h5" />
  </Svg>
);

export const Menu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
);

export const Close = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const Sun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const Moon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.2 8.2 0 1 0 20 14.2Z" />
  </Svg>
);

/** The "follow the system" state of the theme control. */
export const System = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="19" height="13" rx="2" />
    <path d="M8.5 21h7" />
  </Svg>
);

export const Plus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const Minus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);

/* Platform glyphs. These are our own line drawings used beside a word, not a
   reproduction of either vendor's badge artwork — see store-badges.tsx. */
export const Apple = (p: IconProps) => (
  <Svg {...p}>
    <path d="M16.2 12.4c0-2.3 1.9-3.4 2-3.4-1.1-1.6-2.8-1.8-3.4-1.9-1.4-.1-2.8.9-3.5.9s-1.8-.8-3-.8c-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .7 1.1 1.6 2.3 2.8 2.3 1.1 0 1.5-.7 2.9-.7s1.7.7 2.9.7 2-1.1 2.7-2.1c.9-1.2 1.2-2.4 1.2-2.4s-2-.8-2-3.9Z" />
    <path d="M14 5.2c.6-.7 1-1.7.9-2.7-.9 0-2 .6-2.6 1.3-.6.6-1.1 1.7-1 2.6 1 .1 2-.5 2.7-1.2Z" />
  </Svg>
);

export const Android = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 10.5h14v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 17.5v-7Z" />
    <path d="M5 10.5a7 7 0 0 1 14 0M8.5 6.2 7.2 4M15.5 6.2 16.8 4" />
    <path d="M2.6 11.7v3.6M21.4 11.7v3.6M9 19v2M15 19v2" />
  </Svg>
);

export const Search = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);

export const Eye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);

export const EyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4l16 16" />
    <path d="M9.7 5.9A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3.3 4M6.4 7.9A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1 0 1.9-.2 2.7-.5" />
  </Svg>
);

export const Alert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 8.5v5M12 17h.01" />
    <circle cx="12" cy="12" r="9" />
  </Svg>
);
