'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { languageNames, locales, type Locale } from '@/i18n/config';
import { site } from '@/lib/site';
import { Check, Chevron, Close, Globe, Menu } from './icons';
import { Wordmark } from './logo';
import { ThemeToggle } from './theme-toggle';

type Nav = {
  features: string;
  how: string;
  currencies: string;
  pricing: string;
  faq: string;
  openApp: string;
  getApp: string;
  menu: string;
  close: string;
  language: string;
  theme: string;
  themeSystem: string;
  themeLight: string;
  themeDark: string;
  skip: string;
};

export function SiteHeader({ locale, nav, appUrl }: { locale: Locale; nav: Nav; appUrl: string }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpenOn, setMenuOpenOn] = useState<string | null>(null);
  const [langOpenOn, setLangOpenOn] = useState<string | null>(null);
  const menuOpen = menuOpenOn === pathname;
  const langOpen = langOpenOn === pathname;

  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return;
    if (menuOpen && !node.open) node.showModal();
    if (!menuOpen && node.open) node.close();
  }, [menuOpen]);

  useEffect(() => {
    if (!langOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLangOpenOn(null);
        langRef.current?.querySelector('button')?.focus();
      }
    };
    const onDown = (event: PointerEvent) => {
      if (!langRef.current?.contains(event.target as Node)) setLangOpenOn(null);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [langOpen]);

  const links = [
    { href: '#features', label: nav.features },
    { href: '#how', label: nav.how },
    { href: '#currencies', label: nav.currencies },
    { href: '#pricing', label: nav.pricing },
    { href: '#faq', label: nav.faq },
  ];

  const localeHref = (next: Locale) => {
    const rest = pathname.split('/').slice(2).join('/');
    const hash = typeof window === 'undefined' ? '' : window.location.hash;
    return `/${next}${rest ? `/${rest}` : ''}${hash}`;
  };

  const closeMenu = () => {
    setMenuOpenOn(null);
    menuButtonRef.current?.focus();
  };

  return (
    <>
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-[60] focus-visible:inline-flex focus-visible:h-11 focus-visible:items-center focus-visible:rounded-md focus-visible:bg-ink focus-visible:px-4 focus-visible:text-sm focus-visible:font-medium focus-visible:text-bg"
      >
        {nav.skip}
      </a>

      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-200 ${scrolled
          ? 'px-3 pt-3 sm:px-5 bg-transparent'
          : 'px-0 pt-0'}`}
      >
        <div className={`mx-auto flex h-14 max-w-7xl items-center gap-3 px-5 transition-all sm:h-16 sm:px-8 ${scrolled
          ? 'rounded-2xl border border-white/12 bg-[color:var(--w-paper)]/88 shadow-[var(--w-shadow-md)] backdrop-blur-xl'
          : 'bg-transparent'}`}>
          <Link href={`/${locale}`} aria-label={site.name} className="shrink-0 rounded-sm">
            <Wordmark />
          </Link>

          <nav className="ms-5 hidden items-center gap-1 lg:flex" aria-label="Primary">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="inline-flex h-10 items-center rounded-lg px-3 text-[0.86rem] text-ink-2 transition-colors hover:bg-chip hover:text-ink"
              >
                {link.label}
              </a>
            ))}
          </nav>

          <div className="ms-auto flex items-center gap-1">
            <ThemeToggle
              label={nav.theme}
              names={{ system: nav.themeSystem, light: nav.themeLight, dark: nav.themeDark }}
            />

            <div className="relative hidden sm:block" ref={langRef}>
              <button
                type="button"
                onClick={() => setLangOpenOn(langOpen ? null : pathname)}
                aria-expanded={langOpen}
                aria-label={`${nav.language}: ${languageNames[locale].english}`}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-sm text-ink-2 transition-colors hover:bg-chip hover:text-ink"
              >
                <Globe className="h-[1.05rem] w-[1.05rem]" />
                <span className="font-mono text-xs tracking-[0.04em] uppercase">{locale}</span>
                <Chevron className={`h-3.5 w-3.5 transition-transform ${langOpen ? 'rotate-180' : ''}`} />
              </button>

              {langOpen ? (
                <ul
                  aria-label={nav.language}
                  className="panel absolute end-0 z-10 mt-2 w-60 overflow-hidden p-1.5 shadow-[var(--w-shadow-lg)]"
                >
                  {locales.map((l) => (
                    <li key={l}>
                      <Link
                        href={localeHref(l)}
                        hrefLang={l}
                        aria-current={l === locale ? 'page' : undefined}
                        onClick={() => setLangOpenOn(null)}
                        className={`flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 transition-colors ${
                          l === locale ? 'bg-accent-wash text-accent' : 'text-ink-2 hover:bg-chip hover:text-ink'
                        }`}
                      >
                        <span lang={l}>{languageNames[l].endonym}</span>
                        <span className="flex items-center gap-2">
                          <span lang="en" className="font-mono text-[0.6875rem] text-ink-3">{languageNames[l].english}</span>
                          {l === locale ? <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" /> : <span className="h-3.5 w-3.5" aria-hidden="true" />}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <a
              href={appUrl}
              className="ms-1 hidden h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink shadow-[0_7px_18px_rgb(122_90_248_/_0.2)] transition-transform active:translate-y-px sm:inline-flex"
            >
              {nav.getApp}
            </a>

            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setMenuOpenOn(pathname)}
              aria-expanded={menuOpen}
              aria-haspopup="dialog"
              aria-label={nav.menu}
              className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink hover:bg-chip lg:hidden"
            >
              <Menu />
            </button>
          </div>
        </div>
      </header>

      <dialog
        ref={dialogRef}
        aria-label={nav.menu}
        onCancel={(event) => {
          event.preventDefault();
          closeMenu();
        }}
        onClick={(event) => {
          if (event.target === dialogRef.current) closeMenu();
        }}
        className="m-0 max-h-none w-full max-w-none bg-transparent p-0 backdrop:bg-[#0a0712]/60 lg:hidden"
      >
        <div className="min-h-dvh w-full bg-bg">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-5 sm:h-16 sm:px-8">
            <Wordmark />
            <button type="button" onClick={closeMenu} aria-label={nav.close} className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-ink hover:bg-chip">
              <Close />
            </button>
          </div>
          <div className="mx-auto max-w-7xl px-5 pb-10 sm:px-8">
            <nav aria-label="Mobile" className="border-t border-line">
              {links.map((link) => (
                <a key={link.href} href={link.href} onClick={closeMenu} className="flex min-h-15 items-center border-b border-line text-[1.0625rem] text-ink">
                  {link.label}
                </a>
              ))}
            </nav>
            <p className="mt-8 font-mono text-[0.6875rem] tracking-[0.14em] text-ink-3 uppercase">{nav.language}</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {locales.map((l) => (
                <Link
                  key={l}
                  href={localeHref(l)}
                  lang={l}
                  hrefLang={l}
                  aria-current={l === locale ? 'page' : undefined}
                  className={`flex min-h-11 items-center justify-center rounded-lg text-sm ${l === locale ? 'bg-accent-wash text-accent' : 'bg-chip text-ink-2'}`}
                >
                  {languageNames[l].endonym}
                </Link>
              ))}
            </div>
            <a href={appUrl} className="mt-8 flex h-12 items-center justify-center rounded-lg bg-accent text-sm font-medium text-accent-ink">
              {nav.getApp}
            </a>
            <a href={appUrl} className="mt-2 flex h-12 items-center justify-center rounded-lg text-sm font-medium text-ink-2">
              {nav.openApp}
            </a>
          </div>
        </div>
      </dialog>
    </>
  );
}
