import Link from 'next/link';

import { ArrowRight } from './icons';

export function Container({
  className = '',
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={`mx-auto w-full max-w-[73rem] px-5 sm:px-8 ${className}`}>{children}</div>;
}

/** Small uppercase label above a section heading. */
export function Kicker({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-[0.72rem] font-semibold tracking-[0.12em] rtl:tracking-normal text-accent uppercase ${className}`}
    >
      {children}
    </p>
  );
}

export function SectionTitle({
  children,
  className = '',
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <h2
      id={id}
      className={`text-balance text-[1.85rem] leading-[1.1] font-bold tracking-[-0.03em] text-ink sm:text-[2.25rem] ${className}`}
    >
      {children}
    </h2>
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
      ? 'bg-accent text-accent-ink shadow-[0_8px_20px_rgb(122_90_248_/_0.22)] hover:bg-brand-600'
      : variant === 'secondary'
        ? 'bg-surface text-ink shadow-[var(--w-shadow-sm)] hover:bg-raise'
        : 'text-ink-2 hover:text-ink hover:bg-chip';
  const classes = `group inline-flex select-none items-center justify-center gap-2 rounded-md font-medium tracking-[-0.008em] transition-[background-color,color,transform,box-shadow] duration-150 ease-[var(--ease-out)] active:translate-y-px ${sizing} ${skin} ${className}`;
  const inner = (
    <>
      <span>{children}</span>
      {arrow ? (
        <ArrowRight className="h-4 w-4 opacity-75 transition-transform duration-150 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" />
      ) : null}
    </>
  );
  if (external)
    return (
      <a href={href} className={classes} rel="noreferrer">
        {inner}
      </a>
    );
  return (
    <Link href={href} className={classes}>
      {inner}
    </Link>
  );
}
