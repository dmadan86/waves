'use client';

import { useEffect, useId, useState } from 'react';

import { LazyVideo } from './lazy-video';

type Film = { id: string; tab: string; caption: string; alt: string; video: string };

/** `square`: 1:1 loops (the personal page) sit beside their caption instead of filling the width. */

/** One film at a time. `#film-<id>` in the URL (from the feature rows) opens that tab. */
export function FilmTabs({
  films,
  label,
  square = false,
}: {
  films: Film[];
  label: string;
  square?: boolean;
}) {
  const [i, setI] = useState(0);
  const id = useId();

  useEffect(() => {
    const fromHash = () => {
      const n = films.findIndex((f) => `#film-${f.id}` === window.location.hash);
      if (n < 0) return;
      setI(n);
      document.getElementById('films')?.scrollIntoView();
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, [films]);

  const onKey = (e: React.KeyboardEvent) => {
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl' ? -1 : 1;
    let next = i;
    if (e.key === 'ArrowRight') next = i + rtl;
    else if (e.key === 'ArrowLeft') next = i - rtl;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = films.length - 1;
    else return;
    e.preventDefault();
    next = (next + films.length) % films.length;
    setI(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  };

  const film = films[i];
  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={onKey}
        className="flex max-w-full gap-1 overflow-x-auto rounded-full bg-chip p-1 sm:inline-flex"
      >
        {films.map((f, n) => (
          <button
            key={f.id}
            id={`${id}-tab-${n}`}
            role="tab"
            type="button"
            aria-selected={n === i}
            aria-controls={`${id}-panel`}
            tabIndex={n === i ? 0 : -1}
            onClick={() => setI(n)}
            className={`h-10 flex-1 rounded-full px-3 text-[0.86rem] font-semibold whitespace-nowrap transition-colors sm:flex-none sm:px-4 ${
              n === i ? 'bg-accent text-accent-ink' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {f.tab}
          </button>
        ))}
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${i}`}
        className={`mt-4 ${square ? 'grid items-center gap-4 sm:grid-cols-[minmax(0,26rem)_1fr] sm:gap-8' : ''}`}
      >
        <LazyVideo
          key={film.video}
          name={film.video}
          label={film.alt}
          className={square ? 'aspect-square' : 'aspect-video'}
        />
        <p className={`max-w-2xl text-[0.92rem] leading-[1.6] text-ink-2 ${square ? '' : 'mt-3'}`}>
          {film.caption}
        </p>
      </div>
    </div>
  );
}
