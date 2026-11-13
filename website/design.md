# Waves website — redesign concepts (Nov 2026)

- Design canvas (8 artboards): https://claude.ai/artifact/LDprrYYf5G51agUzY4RE2j
- Live animated hero (Orbit, code-drawn moving background): https://claude.ai/artifact/Fi7Zq6PSqC1jyqTKDxHjuz
- Video preview: `waves-orbit-hero.mp4`, a 10 s seamless loop at 1080p (delivered in chat 12 Nov 2026). Source `waves-orbit-hero.html` is a canvas 2D animation with a `window.__wavesSetTime(t)` hook for frame-exact recording (Playwright + ffmpeg).

**Decision (12 Nov 2026): Concept C "Orbit".**

## Brief

Redesign wavs.co.in in the spirit of the Nymera Digital Agency shot on Dribbble: black canvas, luminous glow, thin display type, floating white cards, centred pill nav and a big highlighted statement line. It should be innovative and attractive, with a slowly moving background like Nymera's jellyfish video, but in Waves' context.

## Current site (reviewed 12 Nov 2026)

Light off-white, lavender `#7A5AF8` accent, "grotesk" + IBM Plex Mono, conventional SaaS layout.

Strong content to keep:

- the live split example (Dinner ₹1,665 → ₹555 each → "Ravi pays you ₹555" → Settle with UPI)
- 4-language voice (EN/HI/TA/AR + Hinglish)
- offline-first sync
- the MCP assistant
- ₹0 / ₹79 Pro pricing
- AGPL open source

## Orbit, the chosen direction

### Palette

| Role                            | Colour                                    |
| ------------------------------- | ----------------------------------------- |
| Indigo ground (gradient)        | `#0E0B2A` → `#150F45` → `#1B1150`         |
| Coral, primary CTA              | `#FF7A59`, with dark text `#1B1530` on it |
| Coral light, eyebrows and links | `#FFB199`                                 |
| Amber                           | `#F5B544`                                 |
| Violet                          | `#7A5AF8` / `#C4B5FD`                     |
| Mint, settled                   | `#6EE7B7` / `#A7F3D0`                     |
| White cards                     | `#FBFAFF`, ink `#1B1530`, muted `#5B546F` |
| Numbers on white                | deep coral `#C2410C`                      |

### Type

- Onest 200 for display headlines, 300 for coral highlights, 400–600 for body and UI.
- IBM Plex Mono for eyebrows, amounts and status chips.

### Hero

- Headline: "Money between friends, without the awkward bit."
- Orbit diagram: centre "Goa Trip ₹12,480"; avatars on a ring with owes / paid / settled chips; a glowing ₹555 → Ravi arc with a travelling spark; an invite-by-link slot.
- Moments chips, and a statement line at the bottom.

### Background motion: "luminous currents"

- Slow sine ribbons (coral → magenta → violet) with a travelling highlight, breathing glows, drifting particles, grain, and scrims behind the copy.
- 10 s perfect loop.
- Lightweight: the soft layer is drawn at 1/4 resolution and upscaled. `?lite` skips shadow blur. Respects `prefers-reduced-motion`.

### Below the fold (C-Sections artboard)

1. Who it's for, as a bento: friends/trips with debt simplification ("9 bills → 2 transfers"), families budget, companies approvals, MCP assistant (white tile).
2. How it works: 3 steps on a dashed path.
3. AI voice cards in 4 scripts.
4. Offline timeline.
5. Pricing: Free as glass, Pro as white with a coral glow.
6. CTA band.
7. Footer.

Mobile hero artboard (390×844) is done.

## Other concepts kept on the canvas for reference

- **A · Deep Current**: the direct Nymera translation (black, magenta/violet current, Outfit 200, white stat cards; full below-the-fold page too).
- **B · The Ledger**: typographic and precise (Manrope 200 + Instrument Serif italic, ledger panel, voice-command ticker, stat strip).

## Next steps

- Real app screenshots in the white cards.
- Build in Next.js with the existing i18n (EN/TA/HI/AR); check RTL for Arabic.
- Use the canvas background live on the site; fall back to the MP4/poster where canvas is too heavy.
- Extend Orbit styling to the /personal, /companies and /mcp pages.

## Status

- 13 Nov 2026: the Orbit hero is live on the home page (`website/src/components/hero.tsx`, `orbit-bg.tsx`). It replaced the animated split example in the hero.
- 13 Nov 2026: Orbit is the default theme on every page. The `--w-*` tokens carry the Orbit palette (indigo ground, coral accent, mint/peach for up/down), headings use Onest 200 via `.display`, and the header toggle switches between Orbit and the old light theme (`theme-light`). Not yet done: the bento, dashed-path steps and glass/white pricing cards from the C-Sections artboard; sections keep their existing layouts.
