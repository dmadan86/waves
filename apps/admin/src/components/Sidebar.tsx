'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { Icon } from './icons';

/**
 * The rail.
 *
 * Light rather than the dark slab it used to be, because the reference's
 * hierarchy comes from the 4px accent bar and a colour change on the label —
 * not from a wall of contrast down the left of the screen. A dark rail beside
 * a light page is a second theme to keep in step; this is one.
 *
 * A Client Component only because the active row is decided from the current
 * path. The pages it sits beside stay Server Components.
 */

export type NavItem = { href: string; label: string; icon: ReactNode };
export type NavSection = { heading: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    heading: 'Overview',
    items: [{ href: '/', label: 'Dashboard', icon: Icon.grid }],
  },
  {
    heading: 'People',
    items: [{ href: '/users', label: 'Users', icon: Icon.users }],
  },
  {
    heading: 'Growth',
    items: [
      { href: '/promotions', label: 'Promotions', icon: Icon.tag },
      { href: '/campaigns', label: 'Campaigns', icon: Icon.send },
    ],
  },
  {
    heading: 'Configuration',
    items: [
      { href: '/flags', label: 'Experiments', icon: Icon.flag },
      { href: '/config', label: 'Limits', icon: Icon.sliders },
      { href: '/services', label: 'Services', icon: Icon.server },
      { href: '/releases', label: 'Releases', icon: Icon.smartphone },
      { href: '/notices', label: 'Status messages', icon: Icon.alert },
      { href: '/countries', label: 'Countries', icon: Icon.globe },
      { href: '/rate-limits', label: 'Rate limits', icon: Icon.gauge },
    ],
  },
  {
    heading: 'Marketplace',
    items: [
      { href: '/packs', label: 'Packs', icon: Icon.grid3 },
      { href: '/pack-requests', label: 'Pack requests', icon: Icon.inbox },
    ],
  },
  {
    heading: 'Signals',
    items: [
      { href: '/feedback', label: 'Feedback', icon: Icon.message },
      { href: '/voice-attempts', label: 'Voice attempts', icon: Icon.mic },
      { href: '/agent-writes', label: 'Agent writes', icon: Icon.robot },
    ],
  },
];

/** `/` matches only itself; everything else matches its own subtree. */
export function isCurrent(href: string, path: string): boolean {
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

/** The section + page a path sits in, for the topbar crumb and the title. */
export function locate(path: string): { section: string; label: string } {
  for (const section of NAV) {
    for (const item of section.items) {
      if (isCurrent(item.href, path)) return { section: section.heading, label: item.label };
    }
  }
  // A path the rail does not know — a typo, or the 404. Naming the product
  // rather than repeating "Admin" twice down the crumb.
  return { section: 'Waves', label: 'Admin' };
}

const slug = (heading: string) => heading.toLowerCase().replace(/[^a-z]+/g, '-');

export function Sidebar() {
  const path = usePathname();

  return (
    <nav className="rail" id="console-rail" aria-label="Console sections">
      <Link href="/" className="rail-logo">
        {Icon.cube}
        <span>Waves</span>
      </Link>

      {NAV.map((section) => (
        <div key={section.heading}>
          {/* Labelled rather than headed. A real `<h2>` here would put six of
              them ahead of the page's own `<h1>` in the document, which reads
              to a screen reader as a broken outline; `aria-labelledby` gives
              the list its name without inventing that order. */}
          <div className="rail-section" id={`rail-${slug(section.heading)}`}>
            <span>{section.heading}</span>
          </div>
          <ul
            aria-labelledby={`rail-${slug(section.heading)}`}
            style={{ listStyle: 'none', margin: 0, padding: 0 }}
          >
            {section.items.map((item) => {
              const active = isCurrent(item.href, path);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="rail-item"
                    aria-current={active ? 'page' : undefined}
                    // Collapsed, the label is invisible but the link is not —
                    // without this the accessible name goes with the pixels.
                    title={item.label}
                  >
                    {item.icon}
                    <span className="title">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <p className="rail-foot">
        Aggregates only.
        <br />
        Service role · read at a desk.
      </p>
    </nav>
  );
}
