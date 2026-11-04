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
}: {
  children: React.ReactNode;
  className?: string;
  loop?: boolean;
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
    return () => io.disconnect();
  }, [loop]);

  return (
    <div ref={ref} className={`cm-iv ${className}`}>
      {children}
    </div>
  );
}
