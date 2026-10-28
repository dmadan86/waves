import type { Dictionary } from '@/i18n/dictionaries';
import { site } from '@/lib/site';
import { Apple, GooglePlay } from './icons';

/**
 * Black store badges. They link to the listings when `NEXT_PUBLIC_IOS_URL` /
 * `NEXT_PUBLIC_ANDROID_URL` are set. Until a listing exists the badge is shown
 * as inert and labelled "coming soon": a badge that goes nowhere would be a
 * false promise. These are drawn lookalikes; swap in the vendors' official
 * artwork (they require it, unaltered) when the listings go live.
 */
export function StoreBadges({
  t,
  className = '',
}: {
  t: Dictionary['stores'];
  className?: string;
}) {
  const badges = [
    { href: site.iosUrl, Icon: Apple, small: t.downloadOn, name: t.appStore, mark: 'h-7 w-7' },
    {
      href: site.androidUrl,
      Icon: GooglePlay,
      small: t.getItOn,
      name: t.googlePlay,
      mark: 'h-6 w-6',
    },
  ];
  const cls =
    'inline-flex h-11 min-w-[8.75rem] items-center gap-2.5 rounded-lg border border-white/15 bg-black px-3.5 text-white shadow-[0_6px_16px_rgb(10_8_24_/_0.22)]';

  return (
    <ul aria-label={t.label} className={`flex flex-wrap items-center gap-2.5 ${className}`}>
      {badges.map(({ href, Icon, small, name, mark }) => {
        const inner = (
          <>
            <Icon className={`${mark} shrink-0`} />
            <span className="flex flex-col text-start leading-none">
              <span className="text-[0.55rem] tracking-wide uppercase opacity-85">
                {href ? small : t.soon}
              </span>
              <span className="mt-1 text-[1.02rem] font-semibold tracking-[-0.01em]">{name}</span>
            </span>
          </>
        );
        return (
          <li key={name}>
            {href ? (
              <a
                href={href}
                rel="noreferrer"
                className={`${cls} transition-transform hover:-translate-y-0.5`}
              >
                {inner}
              </a>
            ) : (
              <span className={`${cls} cursor-default opacity-60 saturate-50`} title={t.soon}>
                {inner}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
