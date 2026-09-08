'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, type FormEvent, type ReactNode } from 'react';

import { Icon } from './icons';
import { locate, Sidebar } from './Sidebar';

/**
 * The chrome around every page except the login screen.
 *
 * A Client Component for three reasons, all of which need the current path or
 * local state: it hides itself on `/login`, it names the section in the top
 * bar, and it owns the rail's collapsed/expanded flag. The pages it wraps stay
 * Server Components — they arrive as `children`, already rendered, and never
 * join this file's client bundle.
 *
 * The collapse state deliberately lives here rather than in `localStorage`.
 * This component sits in the root layout, so App Router keeps it mounted
 * across navigations and the choice survives every link in the console; what
 * it does not survive is a reload, and a persisted value read in an effect
 * would mean the rail visibly snaps shut after paint on every cold load. One
 * of those is a better trade than the other for a console one person opens.
 */
export function Shell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);

  // The login page renders its own centred card and must not gain a rail.
  if (path === '/login') return <>{children}</>;

  const here = locate(path);

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = String(form.get('q') ?? '').trim();
    // The reference has a search pill and it searches nothing. The one index
    // this console can actually search is the user directory, so that is where
    // it goes rather than pretending to be global.
    router.push(query ? `/users?name=${encodeURIComponent(query)}` : '/users');
  }

  return (
    <div className="wrapper" data-collapsed={collapsed ? 'true' : 'false'}>
      {/* Six sections of rail stand between the top of the document and the
          page, on every page. This is the way past them. */}
      <a className="skip-link" href="#content">
        Skip to content
      </a>
      <Sidebar />

      <div className="main">
        <div className="topbar">
          <button
            type="button"
            className="icon-button"
            onClick={() => setCollapsed((open) => !open)}
            aria-expanded={!collapsed}
            aria-controls="console-rail"
            aria-label={collapsed ? 'Expand the section rail' : 'Collapse the section rail'}
          >
            {Icon.menu}
          </button>

          {/* Not a `<nav aria-label="Breadcrumb">`: there is no trail to walk
              back up, only a statement of where you are. */}
          <p className="crumb">
            {here.section} <span aria-hidden>›</span> <b>{here.label}</b>
          </p>

          <span className="topbar-spacer" />

          <form className="searchbox" onSubmit={search} role="search">
            <label htmlFor="console-search" className="sr-only">
              Search people by name or email
            </label>
            <input id="console-search" type="search" name="q" placeholder="Search people…" />
            {Icon.search}
          </form>
        </div>

        <div id="content" className="content-slot" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
}
