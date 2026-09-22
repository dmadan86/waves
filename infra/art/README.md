# Remote artwork (`waves-art` bucket)

Illustrations the app fetches at runtime rather than ships. They live here so
the source of truth is versioned, and in a **public** Cloudflare R2 bucket so a
phone can fetch one without a credential. They are deliberately **outside
`apps/mobile/`**: anything under the app directory risks being swept into the
binary by `assetBundlePatterns`, and the whole point is that an install does not
carry them.

The app reads them through `apps/mobile/src/lib/art.ts`. Every screen that draws
one also draws something without it — the feedback cards fall back to a glyph —
so a phone that never reaches the bucket still gets a working screen.

## Licence and attribution

Source: **[Storyset](https://storyset.com/)** (Freepik), `rafiki` style, free
licence **with attribution**. The credit is shown in two places in the app, and
both are required, not decorative:

- under the card grid on the feedback screen (`feedbackArtCredit`), and
- in Settings → Licenses, under _Artwork_.

Storyset's licence permits recolouring, and these are recoloured: the blue
family (hue 205–240, saturation above 0.12) is rotated onto the Waves brand
purple, leaving skin tones, greys and the warm accents alone. Then each one is
trimmed to its alpha bounding box, scaled to 440px on its long edge and saved as
WebP — ~20–35 KB each, about 200 KB for the set.

| File             | Storyset illustration    |
| ---------------- | ------------------------ |
| `splitting.webp` | cash-payment (rafiki)    |
| `receipts.webp`  | receipt (rafiki)         |
| `voice.webp`     | voice-assistant (rafiki) |
| `groups.webp`    | group (rafiki)           |
| `speed.webp`     | fast-loading (rafiki)    |
| `design.webp`    | design-tools (rafiki)    |
| `bug.webp`       | bug-fixing (rafiki)      |
| `idea.webp`      | new-idea (rafiki)        |

## Publishing

The bucket holds **public, non-sensitive** artwork only. It is not the image
bucket: receipts, avatars and group photos live in the private bucket reached
through the `r2-sign` edge function, and nothing in this directory ever goes
near a private object.

```sh
wrangler login                                   # once
wrangler r2 bucket create waves-art              # once
pnpm art:publish                                 # uploads everything here
```

The bucket is served from a custom domain, which is the default in
`lib/art.ts`:

    https://assets.wavs.co.in

A custom domain rather than the bucket's `pub-<hash>.r2.dev` address, because
an r2.dev URL names a bucket on a particular vendor and would be baked into
every build that ever shipped; this one can be pointed elsewhere without a
release. (`wrangler r2 bucket dev-url enable waves-art` turns the r2.dev
address on as well, and `wrangler r2 bucket dev-url get waves-art` prints it.)

`EXPO_PUBLIC_ART_BASE_URL` overrides the default — for a staging bucket or a
local server. Changing either reaches phones without another native build.

Re-running the publish overwrites in place, so a redrawn illustration reaches
every phone as soon as its cache expires — no app release involved.

## The brand mark (`brand/`)

`brand/waves-mark-yellow.svg` and `brand/waves-icon-1024.png` are the supplied
originals of the app mark — the ink "wi" wave, `#2B2B20` on `#F5D800`. They are
kept here as the source the launcher icons are cut from, not as anything the app
loads.

**The square must stay yellow.** It is a build input, not a shipped surface.
`render-splash-mark.py` reads it at build time and recolours it on the fly, and
to do that it declares the two colours it expects to find (`SOURCE_FIELD` and
`SOURCE_INK`) and recovers each pixel's ink coverage from how far it has
travelled between them. Recolour the square and that subtraction reads garbage,
and the icons come out wrong on the next run.

**The brand the app wears is no longer that yellow.** The field is the brand
purple, `#6C4EE3` — `brand600` in `packages/ui/src/tokens.ts` — and the mark on
it is white. Everything that paints the launch carries that purple and must
carry the same value: `adaptiveIcon.backgroundColor` and the splash plugin in
`app.json`, and `SPLASH_BG` in `AnimatedSplash.tsx`. The last pair is the one
that shows if it drifts — the native splash and the JS one paint the same flat
field back to back, and the handoff is invisible only while they agree.
`apps/mobile/test/splashColour.test.ts` pins them together.

The launcher icons under `apps/mobile/assets/images/` are derived from that 1024
square and are regenerated from it by `render-splash-mark.py`, which recolours
as it goes: the yellow original in, the purple icons out. (Not everything in
that directory comes from the square — the splash mark does not. See below.)

Two flat colours is what makes the cut clean — every pixel of the original sits
somewhere on the line from the field to the ink, so how far it has travelled can
be read back out of it and the mark laid down again in another pair of colours
with its anti-aliased edge intact. Swapping one colour for the other instead
would leave the old yellow smeared around every curve.

What that script writes, and from where:

| File                          | Cut from                         |
| ----------------------------- | -------------------------------- |
| `icon.png`                    | the 1024 square, recoloured      |
| `favicon.png`                 | `icon.png`, resampled to 48      |
| `android-icon-background.png` | the flat field, 432 square       |
| `android-icon-foreground.png` | the monochrome layer's alpha     |
| `android-icon-monochrome.png` | never written — Android tints it |
| `splash-mark-ink.png`         | `assets/brand/wave-mark.json`    |

The foreground borrows its silhouette from the monochrome layer rather than
being cut from the square again, because a launcher draws whichever of the two
it asks for and they have to agree to the pixel. That also keeps, for free, the
60%-of-canvas sizing that holds the mark inside the 66% the launcher promises
not to crop.

The splash mark is the odd one out: it comes from the geometry in
`apps/mobile/assets/brand/wave-mark.json`, not from the square, because the
animated splash has to draw the stroke on rather than reveal a raster. The two
curves are not the same drawing: overlaid, the rebuilt one is noticeably taller
for its width, with its dot further off the end of the stroke — bounding-box
aspect 1.305 against the square's 1.629. That difference is exactly why the
launcher icons are still cut from the picture rather than redrawn from the
geometry: recolouring the picture moves them onto the new brand without the mark
also changing proportion, size and position inside the icon.
