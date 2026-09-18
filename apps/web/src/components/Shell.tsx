'use client';

/**
 * The frame every signed-in page sits in.
 *
 * A dark rail on the left carrying the brand and the destinations, a light
 * canvas beside it, and a top bar with search, the one primary action, the
 * theme switch and the account. Below 1024px the rail is replaced by a bottom
 * tab bar — the same shape the phone uses, and the width most invite links are
 * opened at.
 *
 * Two things this file used to get wrong, both worth naming so they do not come
 * back:
 *
 * **The icons were emoji.** 👥, 📈, 🙂, 🔑. They render differently on every
 * operating system, cannot take the row's colour, and sit off the baseline.
 * They are stroked icons now, sized on the design system's icon scale and
 * inheriting `currentColor`, so the rail reads as one object.
 *
 * **The top bar repeated the page's name** while the stylesheet hid the page's
 * own `<h1>`. The heading belongs to the page — it is the top of its hierarchy
 * and the thing a screen reader lands on — so the bar carries the brand and the
 * tools instead, and every page says its own name.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowLeftRight,
  KeyRound,
  LayoutGrid,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
  UserRound,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { useStrings } from '@/i18n-context';
import { useTheme, type ThemeChoice } from '@/lib/theme';

export enum Section {
  Overview = 'overview',
  Groups = 'groups',
  Activity = 'activity',
  Friends = 'friends',
  Settle = 'settle',
  Developers = 'developers',
  Settings = 'settings',
}

/** The icon scale from the design system, so a glyph is never a bare number. */
const RAIL_ICON = 20;
const BAR_ICON = 18;
const TAB_ICON = 22;

interface Destination {
  key: Section;
  label: string;
  href: string;
  Icon: LucideIcon;
}

export function Shell({
  current,
  query,
  onQuery,
  userName,
  avatarUrl,
  isGuest,
  onSignOut,
  children,
}: {
  current: Section;
  query: string;
  onQuery: (value: string) => void;
  userName: string;
  avatarUrl: string | null;
  isGuest: boolean;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const { t } = useStrings();

  const nav: Destination[] = [
    { key: Section.Overview, label: t.dash.nav.overview, href: '/', Icon: LayoutGrid },
    { key: Section.Groups, label: t.groups.title, href: '/groups', Icon: Users },
    { key: Section.Activity, label: t.dash.nav.activity, href: '/activity', Icon: Activity },
    { key: Section.Friends, label: t.dash.nav.friends, href: '/friends', Icon: UserRound },
    { key: Section.Settle, label: t.dash.nav.settle, href: '/settle', Icon: ArrowLeftRight },
    { key: Section.Developers, label: t.developers.title, href: '/developers', Icon: KeyRound },
    { key: Section.Settings, label: t.settings.title, href: '/settings', Icon: SettingsIcon },
  ];

  // The five the bottom bar has room for. Settle and Developers are reached
  // from the account menu at those widths, so nothing becomes unreachable.
  const tabs = nav.filter((item) => item.key !== Section.Settle && item.key !== Section.Developers);
  const spare = nav.filter(
    (item) => item.key === Section.Settle || item.key === Section.Developers,
  );

  return (
    <div className="app">
      {/*
        The first thing a keyboard reaches, on every page.

        Without it, somebody tabbing lands in the sidebar and has to walk the
        whole of it — every section, the search box, the add button, the theme
        switch, the account menu — before touching the page they opened. That
        is the cost on *every* navigation, not once.

        A plain anchor rather than a button, because moving focus to a landmark
        is what a fragment link already does; `#main` is the landmark the shell
        now names. It is invisible until focused, so the only person who ever
        sees it is the one it is for.
      */}
      <a className="skip-link" href="#main">
        {t.a11y.skipToContent}
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="side-brand">
            <span className="brand-mark" aria-hidden>
              ₹
            </span>
            Waves
          </div>

          <nav className="side-nav">
            {nav.map(({ key, label, href, Icon }) => (
              <Link
                key={key}
                href={href}
                className="side-link"
                aria-current={key === current ? 'page' : undefined}
              >
                <span className="side-ico" aria-hidden>
                  <Icon size={RAIL_ICON} strokeWidth={1.75} />
                </span>
                {label}
              </Link>
            ))}
          </nav>
        </aside>

        <div className="main-col">
          <header className="topbar">
            {/* The brand only appears here once the rail has gone, so the bar
                is not saying the app's name twice on a desktop. */}
            <span className="brand only-narrow" aria-hidden>
              <span className="brand-mark">₹</span>
            </span>

            <label className="search">
              <Search size={BAR_ICON} strokeWidth={1.75} aria-hidden />
              <input
                type="search"
                value={query}
                placeholder={t.dash.searchPlaceholder}
                onChange={(event) => onQuery(event.target.value)}
                aria-label={t.dash.searchPlaceholder}
              />
            </label>

            {/* The one action a splitting app is for, on every page — no need to
                open a group first, since the picker at /add does that. */}
            <Link href="/add" className="btn brand topbar-add">
              <Plus size={BAR_ICON} strokeWidth={2.25} aria-hidden />
              <span className="topbar-add-label">{t.dash.addExpense}</span>
            </Link>

            <ThemeSwitch />

            <Account
              userName={userName}
              avatarUrl={avatarUrl}
              isGuest={isGuest}
              spare={spare}
              onSignOut={onSignOut}
            />
          </header>

          {/* The landmark every page was missing. Screen-reader users could
              reach the navigation and the header by name and then had nothing
              to jump to — the content was a div like any other. */}
          <main id="main">{children}</main>
        </div>
      </div>

      <nav className="bottombar">
        {tabs.map(({ key, label, href, Icon }) => (
          <Link
            key={key}
            href={href}
            className="tab-link"
            aria-current={key === current ? 'page' : undefined}
          >
            <Icon size={TAB_ICON} strokeWidth={1.75} aria-hidden />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

/**
 * Light, dark, or the machine's own setting — cycled in that order by one
 * button, because three radio buttons in a top bar is three too many. The glyph
 * is what the *next* press gives you, and the label says so out loud.
 */
function ThemeSwitch() {
  const { t } = useStrings();
  const { choice, setChoice } = useTheme();

  const order = ['system', 'light', 'dark'] as const satisfies readonly ThemeChoice[];
  const next = order[(order.indexOf(choice) + 1) % order.length] ?? 'system';
  const Icon = choice === 'light' ? Sun : choice === 'dark' ? Moon : Monitor;
  const label =
    choice === 'light' ? t.theme.light : choice === 'dark' ? t.theme.dark : t.theme.system;

  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setChoice(next)}
      aria-label={`${t.theme.label}: ${label}`}
      title={`${t.theme.label}: ${label}`}
    >
      <Icon size={BAR_ICON} strokeWidth={1.75} aria-hidden />
    </button>
  );
}

function Account({
  userName,
  avatarUrl,
  isGuest,
  spare,
  onSignOut,
}: {
  userName: string;
  avatarUrl: string | null;
  isGuest: boolean;
  spare: Destination[];
  onSignOut: () => void;
}) {
  const { t } = useStrings();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = userName.trim().charAt(0).toUpperCase() || '?';

  return (
    <div ref={root} className="acct">
      <button
        type="button"
        className="acct-button"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={userName}
      >
        <span className="avatar" aria-hidden>
          {avatarUrl ? (
            // Google's avatar CDN, a small round photo — next/image would need
            // every provider host allow-listed to render one <img>.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" />
          ) : (
            initial
          )}
        </span>
      </button>

      {open ? (
        <div role="menu" className="acct-menu">
          <div className="acct-who">
            <span className="acct-name">{userName}</span>
            {isGuest ? <span className="acct-role">{t.dash.guestLabel}</span> : null}
          </div>

          {spare.map(({ key, label, href, Icon }) => (
            <Link
              key={key}
              href={href}
              role="menuitem"
              className="acct-item only-narrow"
              onClick={() => setOpen(false)}
            >
              <Icon size={BAR_ICON} strokeWidth={1.75} aria-hidden />
              {label}
            </Link>
          ))}

          <button
            type="button"
            className="acct-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <LogOut size={BAR_ICON} strokeWidth={1.75} aria-hidden />
            {t.dash.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}
