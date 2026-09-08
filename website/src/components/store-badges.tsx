import { site } from '@/lib/site';
import { Apple, Android } from './icons';

/**
 * Store links, and only when there is somewhere to send people.
 *
 * The official App Store and Google Play badge artwork is deliberately not
 * reproduced here: both vendors require their own asset, unaltered, at a
 * minimum height with a fixed clear space around it, and a hand-drawn
 * lookalike breaches those guidelines. When the listings exist, set
 * `NEXT_PUBLIC_IOS_URL` and `NEXT_PUBLIC_ANDROID_URL` and drop the two SVGs in
 * — until then this renders nothing rather than a badge that goes nowhere.
 */
export function StoreBadges({
  t,
  className = '',
  linksOnly = false,
}: {
  t: { ios: string; android: string; soon: string };
  className?: string;
  /** Suppress the "not in the stores yet" line where it would only repeat. */
  linksOnly?: boolean;
}) {
  const links = [
    { href: site.iosUrl, label: t.ios, Icon: Apple },
    { href: site.androidUrl, label: t.android, Icon: Android },
  ].filter((link): link is { href: string; label: string; Icon: typeof Apple } =>
    Boolean(link.href),
  );

  if (links.length === 0) {
    if (linksOnly) return null;
    return (
      <p className={`font-mono text-[0.75rem] text-ink-3 ${className}`}>
        <span aria-hidden="true" className="me-1.5 text-accent">
          ·
        </span>
        {t.soon}
      </p>
    );
  }

  return (
    <ul className={`flex flex-wrap items-center gap-2.5 ${className}`}>
      {links.map(({ href, label, Icon }) => (
        <li key={label}>
          <a
            href={href}
            rel="noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-md border border-line px-3.5 text-sm text-ink transition-colors duration-150 hover:border-line-strong hover:bg-chip"
          >
            <Icon className="h-[1.15rem] w-[1.15rem]" />
            {label}
          </a>
        </li>
      ))}
    </ul>
  );
}
