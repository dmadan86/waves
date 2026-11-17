'use client';

import { useEffect, useRef } from 'react';

/**
 * Stamps `data-play` on its wrapper while it is on screen (`loop`) or from the
 * first time it is (default). The CSS in companies.css starts every animation
 * off that attribute, so off-screen motion costs nothing. The markup without the
 * attribute is already the finished state, which is what reduced motion sees.
 */
export function InView({
  children,
  className = '',
  loop = false,
  replay = false,
}: {
  children: React.ReactNode;
  className?: string;
  loop?: boolean;
  /** Restart the animations when the pointer or keyboard focus enters. */
  replay?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.dataset.play = '';
          if (!loop) io.disconnect();
        } else if (loop) {
          delete el.dataset.play;
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    const again = () => {
      if (!('play' in el.dataset)) return;
      delete el.dataset.play;
      void el.offsetWidth; // flush so the animations restart
      el.dataset.play = '';
    };
    if (replay) {
      el.addEventListener('pointerenter', again);
      el.addEventListener('focusin', again);
    }
    return () => {
      io.disconnect();
      el.removeEventListener('pointerenter', again);
      el.removeEventListener('focusin', again);
    };
  }, [loop, replay]);

  return (
    <div ref={ref} className={`cm-iv ${className}`}>
      {children}
    </div>
  );
}
