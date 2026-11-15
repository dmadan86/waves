'use client';

import { useEffect, useRef } from 'react';

/**
 * "Luminous currents" behind the Orbit hero (website/design.md): slow coral →
 * magenta → violet ribbons on a 10 s loop. The canvas is drawn at a quarter of
 * the CSS size and stretched, so the upscale does the blur for free. It stops
 * when the hero is off screen or the tab is hidden, and draws a single still
 * frame for prefers-reduced-motion.
 */
export function OrbitBg() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    const x = c?.getContext('2d');
    if (!c || !x) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = (t: number) => {
      const W = Math.max(1, Math.round(c.clientWidth / 4));
      const H = Math.max(1, Math.round(c.clientHeight / 4));
      if (c.width !== W || c.height !== H) {
        c.width = W;
        c.height = H;
      }
      x.clearRect(0, 0, W, H);
      const T = (t / 10) * Math.PI * 2;
      x.globalCompositeOperation = 'lighter';
      const ribbons: [string, number, number][] = [
        ['255,122,89', 0.7, 0],
        ['224,69,155', 0.78, 1.3],
        ['122,90,248', 0.86, 2.6],
      ];
      ribbons.forEach(([rgb, yf, ph], i) => {
        // A highlight travels along each ribbon once per loop.
        const hx = (((t / 10 + i / 3) % 1) * 1.4 - 0.2) * W;
        const g = x.createLinearGradient(0, 0, W, 0);
        g.addColorStop(0, `rgba(${rgb},0.1)`);
        g.addColorStop(Math.min(1, Math.max(0, hx / W)), `rgba(${rgb},0.3)`);
        g.addColorStop(1, `rgba(${rgb},0.1)`);
        x.strokeStyle = g;
        x.lineWidth = Math.max(4, H * (0.06 - i * 0.012));
        x.beginPath();
        for (let px = -8; px <= W + 8; px += 4) {
          const y =
            H * yf +
            Math.sin((px / W) * 5 + T + ph) * H * 0.08 +
            Math.sin((px / W) * 2 - T) * H * 0.055;
          if (px < 0) x.moveTo(px, y);
          else x.lineTo(px, y);
        }
        x.stroke();
      });
      // A breathing glow behind the orbit.
      const r = W * (0.32 + Math.sin(T) * 0.02);
      const rg = x.createRadialGradient(W * 0.74, H * 0.48, 0, W * 0.74, H * 0.48, r);
      rg.addColorStop(0, 'rgba(122,90,248,0.32)');
      rg.addColorStop(1, 'rgba(122,90,248,0)');
      x.fillStyle = rg;
      x.fillRect(0, 0, W, H);
      x.globalCompositeOperation = 'source-over';
    };

    if (still) {
      draw(0);
      return;
    }
    let raf = 0;
    let on = true;
    const t0 = performance.now();
    const loop = () => {
      draw(((performance.now() - t0) / 1000) % 10);
      raf = requestAnimationFrame(loop);
    };
    const sync = () => {
      cancelAnimationFrame(raf);
      if (on && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const io = new IntersectionObserver(([e]) => {
      on = e.isIntersecting;
      sync();
    });
    io.observe(c);
    document.addEventListener('visibilitychange', sync);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className="absolute inset-0 -z-10 h-full w-full" />;
}
