'use client';

import { useEffect, useRef } from 'react';

/**
 * A silent looping film that plays only while it is on screen and never when
 * the visitor asked for reduced motion (the poster stays). Files live in the
 * public R2 bucket under videos/ as `<name>.mp4`, `<name>.webm` and `<name>.jpg`
 * (the poster); upload with infra/art/publish.sh.
 */
const BASE = 'https://assets.wavs.co.in/videos';

export function LazyVideo({
  name,
  label,
  className = '',
}: {
  name: string;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const sync = () => {
      // Autoplay can be refused (iPhone Low Power Mode): show controls so it can be tapped.
      if (visible && !reduce.matches) video.play().catch(() => (video.controls = true));
      else video.pause();
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        sync();
      },
      { threshold: 0.25 },
    );
    io.observe(video);
    reduce.addEventListener('change', sync);
    return () => {
      io.disconnect();
      reduce.removeEventListener('change', sync);
    };
  }, []);

  return (
    <video
      ref={ref}
      autoPlay
      muted
      loop
      playsInline
      preload="metadata"
      poster={`${BASE}/${name}.jpg`}
      aria-label={label}
      className={`w-full rounded-2xl bg-chip object-cover shadow-[var(--w-shadow-card)] ${className}`}
    >
      <source src={`${BASE}/${name}.webm`} type="video/webm" />
      <source src={`${BASE}/${name}.mp4`} type="video/mp4" />
    </video>
  );
}
