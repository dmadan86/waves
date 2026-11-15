'use client';

import { useEffect, useRef } from 'react';

import { captureAttribution, withAttribution } from '@/lib/attribution';
import { trackMarketingEvent } from '@/lib/marketing-events';

/**
 * An outbound link to the web app (`web`) or a store listing (`store`) that
 * carries the visitor's campaign tags. The server-rendered href is the plain
 * destination; tags are added after mount, so crawlers see the clean URL.
 */
export function AttributedLink({
  href,
  kind,
  placement,
  onClick,
  ...rest
}: Omit<React.ComponentProps<'a'>, 'href'> & {
  href: string;
  kind: 'web' | 'store';
  placement: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // Set on the element, not in state: React never re-renders an unchanged href over it.
    if (ref.current) {
      ref.current.href = withAttribution(href, captureAttribution(window.location.search), kind);
    }
  }, [href, kind]);

  return (
    <a
      {...rest}
      ref={ref}
      href={href}
      onClick={(e) => {
        onClick?.(e);
        trackMarketingEvent(kind === 'store' ? 'store_click' : 'web_app_click', placement);
      }}
    />
  );
}
