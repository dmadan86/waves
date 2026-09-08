import Link from 'next/link';

import { ArrowRight } from './icons';

export function Container({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-5 sm:px-8 ${className}`}>{children}</div>;
}

/**
 * Sections carry their own ground. The page alternates between the base ground
 * and `paper` — a raised neutral band — which is the whole of its pacing: ten
 * sections on one flat colour is what made the old page read as long and
 * undifferentiated. `paper` works in both themes because it is a token, not a
 * literal: a lifted grey at night, plain white by day.
 */
export function Section({
  id,
  ground = 'base',
  className = '',
  children,
}: {
  id?: string;
  ground?: 'base' | 'paper';
  className?: string;
  children: React.ReactNode;
}) {
  const skin = ground === 'paper' ? 'border-y border-line bg-paper' : 'bg-bg';

  return (
    <section id={id} className={`relative scroll-mt-24 py-20 sm:py-28 ${skin} ${className}`}>
      {children}
    </section>
  );
}

/**
 * The label above a section title. Set in the mono, uppercase, with a leading
 * index — it reads as a ledger column head rather than a decorative pill, and
 * the index tells you where you are in the page.
 */
export function Eyebrow({ index, children }: { index?: string; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 font-mono text-[0.6875rem] tracking-[0.14em] text-ink-3 uppercase">
      {index ? (
        <span aria-hidden="true" className="text-accent">
          {index}
        </span>
      ) : null}
      <span>{children}</span>
    </p>
  );
}

/**
 * The one heading style the page uses. The emphasised phrase arrives as a
 * prop rather than as markup inside a translated string, so a translator can
 * move the emphasis to wherever their sentence puts it.
 */
export function SectionTitle({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`text-balance text-[1.85rem] leading-[1.08] font-semibold tracking-[-0.03em] text-ink sm:text-[2.5rem] md:text-[3rem] ${className}`}
    >
      {children}
    </h2>
  );
}

export function Lede({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`max-w-2xl text-pretty text-[1.0625rem] leading-[1.6] text-ink-2 ${className}`}>
      {children}
    </p>
  );
}

type ButtonProps = {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'quiet';
  size?: 'md' | 'lg';
  external?: boolean;
  arrow?: boolean;
  className?: string;
};

/**
 * Press is the interaction the page is built on: the button takes a real
 * downward step rather than a hover lift, which reads as a physical control
 * instead of a floating card. Everything is at least 44 px tall.
 */
export function Button({
  href,
  children,
  variant = 'primary',
  size = 'md',
  external = false,
  arrow = true,
  className = '',
}: ButtonProps) {
  const sizing = size === 'lg' ? 'h-12 px-6 text-[0.9375rem]' : 'h-11 px-5 text-sm';

  const skin =
    variant === 'primary'
      ? 'bg-ink text-bg hover:bg-ink/90'
      : variant === 'secondary'
        ? 'bg-surface text-ink shadow-[var(--w-shadow-sm)] hover:bg-raise'
        : 'text-ink-2 hover:text-ink hover:bg-chip';

  const classes = `group inline-flex select-none items-center justify-center gap-2 rounded-md font-medium tracking-[-0.005em] transition-[background-color,color,transform] duration-150 ease-[var(--ease-out)] active:translate-y-px ${sizing} ${skin} ${className}`;

  const inner = (
    <>
      {children}
      {arrow ? (
        <ArrowRight className="h-4 w-4 opacity-70 transition-transform duration-150 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
      ) : null}
    </>
  );

  if (external) {
    return (
      <a href={href} className={classes} rel="noreferrer">
        {inner}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {inner}
    </Link>
  );
}
