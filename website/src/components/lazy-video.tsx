'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * A silent looping film. Nothing is downloaded beyond the poster until the
 * video is near the viewport; it plays only while on screen and never by
 * itself when the visitor asked for reduced motion (the poster stays). A
 * play/pause button is always present so motion can be stopped or started.
 * Files live in the public R2 bucket under videos/ as `<name>.mp4` and
 * `<name>.jpg` (the poster); upload with infra/art/publish.sh.
 */
const BASE = 'https://assets.wavs.co.in/videos';

const buttonLabels: Record<string, { play: string; pause: string }> = {
  en: { play: 'Play video', pause: 'Pause video' },
  ta: { play: 'வீடியோவை இயக்கு', pause: 'வீடியோவை இடைநிறுத்து' },
  hi: { play: 'वीडियो चलाएँ', pause: 'वीडियो रोकें' },
  ar: { play: 'تشغيل الفيديو', pause: 'إيقاف الفيديو مؤقتًا' },
};

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
  // null = automatic (visible and motion allowed); true/false = the visitor chose.
  const choice = useRef<boolean | null>(null);
  const sync = useRef<() => void>(() => {});
  const [playing, setPlaying] = useState(false);
  const [lang, setLang] = useState('en');

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    setLang(document.documentElement.lang.split('-')[0]);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    let loaded = false;
    sync.current = () => {
      const want = visible && (choice.current ?? !reduce.matches);
      if (want) {
        if (!loaded) {
          loaded = true;
          video.src = `${BASE}/${name}.mp4`; // MP4 only: WebM copies failed to decode in Chrome
        }
        video.play().catch(() => {}); // refused (e.g. Low Power Mode): the button can retry
      } else video.pause();
    };
    const near = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loaded && (choice.current ?? !reduce.matches)) {
          loaded = true;
          video.src = `${BASE}/${name}.mp4`;
        }
      },
      { rootMargin: '300px' },
    );
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        sync.current();
      },
      { threshold: 0.25 },
    );
    near.observe(video);
    io.observe(video);
    const onChange = () => sync.current();
    reduce.addEventListener('change', onChange);
    return () => {
      near.disconnect();
      io.disconnect();
      reduce.removeEventListener('change', onChange);
    };
  }, [name]);

  const text = buttonLabels[lang] ?? buttonLabels.en;

  return (
    <div className="relative">
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="none"
        poster={`${BASE}/${name}.jpg`}
        aria-label={label}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className={`block w-full rounded-2xl bg-chip object-cover shadow-[var(--w-shadow-card)] ${className}`}
      />
      <button
        type="button"
        aria-label={playing ? text.pause : text.play}
        onClick={() => {
          choice.current = !playing;
          const video = ref.current;
          if (choice.current && video && !video.currentSrc) video.src = `${BASE}/${name}.mp4`;
          if (choice.current) video?.play().catch(() => {});
          else video?.pause();
        }}
        className="absolute end-3 bottom-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          {playing ? <path d="M6 5h4v14H6zM14 5h4v14h-4z" /> : <path d="M8 5v14l11-7z" />}
        </svg>
      </button>
    </div>
  );
}
