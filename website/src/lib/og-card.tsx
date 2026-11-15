import { ImageResponse } from 'next/og';

import { site } from './site';

export const ogSize = { width: 1200, height: 630 };

/**
 * The share card, in the Orbit palette (website/design.md). Text stays in
 * English in every locale on purpose: the renderer only has a Latin face
 * loaded, and a card of tofu boxes is worse than a card in the wrong language.
 */
export function ogCard({ start, accent, sub }: { start: string; accent: string; sub: string }) {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 80,
        background: 'linear-gradient(160deg, #0E0B2A 0%, #150F45 60%, #1B1150 100%)',
        color: 'white',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <div style={{ width: 68, height: 68, borderRadius: 16, background: '#6C4EE3' }} />
        <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: -1.5 }}>Waves</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Satori needs an explicit display on every node with several children. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 72,
            fontWeight: 300,
            letterSpacing: -2,
            lineHeight: 1.05,
          }}
        >
          <span>{start}</span>
          <span style={{ color: '#FF7A59' }}>{accent}</span>
        </div>
        <div style={{ fontSize: 30, color: '#C9C3E6' }}>{sub}</div>
      </div>

      <div style={{ display: 'flex', fontSize: 26, color: '#9C95C2' }}>{site.domain}</div>
    </div>,
    ogSize,
  );
}
